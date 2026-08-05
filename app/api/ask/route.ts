import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { BACKEND_URL, CATEGORIES, MAX_QUESTION_LEN } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A proxy, not a pipeline. Retrieval, the agent and generation all live in the Python
// backend, so this deployment holds no provider key and the browser never learns the
// backend URL. What stays here is what belongs at the edge: throttling and input
// validation, both cheaper to do before crossing the network.

const TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(ip).ok) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again shortly." },
      { status: 429 }
    );
  }

  let body: { question?: string; category?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "Please enter a question." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LEN) {
    return NextResponse.json(
      { error: `Question too long (max ${MAX_QUESTION_LEN} characters).` },
      { status: 400 }
    );
  }

  const category =
    body.category && (CATEGORIES as readonly string[]).includes(body.category)
      ? body.category
      : undefined;
  const mode = body.mode === "dense" || body.mode === "hybrid" ? body.mode : undefined;

  // Without a timeout a hung backend holds the serverless function open until the
  // platform kills it, and the user watches a spinner for the whole duration.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.BACKEND_API_KEY) headers["X-API-Key"] = process.env.BACKEND_API_KEY;

    const res = await fetch(`${BACKEND_URL}/ask`, {
      method: "POST",
      headers,
      body: JSON.stringify({ question, category, mode }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      // The backend's message can name an index or a missing key. Log it, return a
      // generic one — a deployment detail is not something to show a visitor.
      console.error("backend error", res.status, await res.text().catch(() => ""));
      return NextResponse.json(
        { error: "The retrieval service is unavailable. Please try again shortly." },
        { status: 502 }
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.error("proxy error", err);
    return NextResponse.json(
      {
        error: aborted
          ? "The request took too long. Please try again."
          : "Could not reach the retrieval service.",
      },
      { status: aborted ? 504 : 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
