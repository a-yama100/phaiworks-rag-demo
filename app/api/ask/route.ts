import { NextRequest, NextResponse } from "next/server";
import { getNamespace } from "@/lib/clients";
import { rateLimit } from "@/lib/ratelimit";
import { CATEGORIES, MAX_QUESTION_LEN, MIN_SCORE, TOP_K } from "@/lib/config";

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
    // Hard metadata filter is applied BEFORE similarity, so unapproved, non-UK, or
    // off-category content can never surface — the anti-hallucination guarantee.
    const filter: Record<string, unknown> = {
      status: { $eq: "clinically_approved" },
      language: { $eq: "en-GB" },
    };
    if (category) filter.category = { $eq: category };

    // Pinecone embeds `question` with the index's hosted model and runs the search.
    const ns = getNamespace();
    const res = await ns.searchRecords({
      query: { topK: TOP_K, inputs: { text: question }, filter },
      fields: ["biomarker_name", "category", "source_brief_id", "answer_text"],
    });

    const hits = res.result?.hits ?? [];
    const matches: Match[] = hits
      .filter((h) => (h._score ?? 0) >= MIN_SCORE)
      .map((h) => {
        const f = (h.fields ?? {}) as Record<string, unknown>;
        return {
          biomarker: String(f.biomarker_name ?? ""),
          category: String(f.category ?? ""),
          source: String(f.source_brief_id ?? ""),
          score: Number((h._score ?? 0).toFixed(3)),
          answer: String(f.answer_text ?? ""),
        };
      });

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
