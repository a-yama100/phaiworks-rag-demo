import { NextRequest, NextResponse } from "next/server";
import { getOpenAI, getIndex } from "@/lib/clients";
import { rateLimit } from "@/lib/ratelimit";
import {
  CATEGORIES,
  EMBED_MODEL,
  MAX_QUESTION_LEN,
  MIN_SCORE,
  TOP_K,
} from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Match = {
  biomarker: string;
  category: string;
  source: string;
  score: number;
  answer: string;
};

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = rateLimit(ip);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again shortly." },
      { status: 429 }
    );
  }

  let body: { question?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  const category =
    body.category && CATEGORIES.includes(body.category)
      ? body.category
      : undefined;

  if (!question) {
    return NextResponse.json(
      { error: "Please enter a question." },
      { status: 400 }
    );
  }
  if (question.length > MAX_QUESTION_LEN) {
    return NextResponse.json(
      { error: `Question too long (max ${MAX_QUESTION_LEN} characters).` },
      { status: 400 }
    );
  }

  try {
    const openai = getOpenAI();
    const emb = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: question,
    });
    const vector = emb.data[0].embedding;

    const filter: Record<string, unknown> = {
      status: { $eq: "clinically_approved" },
      language: { $eq: "en-GB" },
    };
    if (category) filter.category = { $eq: category };

    const index = getIndex();
    const res = await index.query({
      vector,
      topK: TOP_K,
      includeMetadata: true,
      filter,
    });

    const matches: Match[] = (res.matches ?? [])
      .filter((m) => (m.score ?? 0) >= MIN_SCORE)
      .map((m) => ({
        biomarker: String(m.metadata?.biomarker_name ?? ""),
        category: String(m.metadata?.category ?? ""),
        source: String(m.metadata?.source_brief_id ?? ""),
        score: Number((m.score ?? 0).toFixed(3)),
        answer: String(m.metadata?.answer_text ?? ""),
      }));

    return NextResponse.json({
      question,
      category: category ?? null,
      matches,
    });
  } catch (err) {
    console.error("retrieval error", err);
    return NextResponse.json(
      { error: "Retrieval failed. Please try again later." },
      { status: 500 }
    );
  }
}
