"use client";

import Link from "next/link";
import { useState } from "react";
import { MatchList } from "@/components/MatchList";
import { StatsBar } from "@/components/StatsBar";
import { TracePanel } from "@/components/TracePanel";
import { CATEGORIES, CATEGORY_LABELS, MAX_QUESTION_LEN } from "@/lib/config";
import type { AskResponse } from "@/lib/types";

const EXAMPLES: { label: string; question: string; note: string }[] = [
  {
    label: "lay wording",
    question: "I'm always tired and think my iron is low",
    note: "no marker named — the dense retriever earns its place here",
  },
  {
    label: "exact name",
    question: "GGT",
    note: "three liver enzymes are semantically adjacent; BM25 breaks the tie",
  },
  {
    label: "confusable",
    question: "which liver enzyme tells me whether a high ALP is bone or liver",
    note: "four plausible briefs, one right answer",
  },
  {
    label: "out of scope",
    question: "what dose of levothyroxine should I take",
    note: "on-topic vocabulary, uncovered by the briefs — it should decline",
  },
  {
    label: "off topic",
    question: "how do I fix a flat tyre",
    note: "nothing clears the score threshold",
  },
];

const REFUSAL_COPY: Record<string, string> = {
  below_threshold:
    "Nothing in the knowledge base was similar enough to answer from, so the pipeline stopped rather than returning the closest brief it could find.",
  model_declined:
    "Briefs were retrieved, but the model judged that they do not actually answer the question and declined instead of stretching them to fit.",
  no_evidence: "Retrieval returned nothing at all after the rewrite and retry.",
  no_citation: "The model produced an answer without citing any brief, so it was rejected.",
  unparseable_output:
    "The model's structured output could not be parsed, so it was rejected rather than passed through unchecked.",
};

function refusalCopy(reason: string): string {
  if (reason.startsWith("ungrounded_citation")) {
    return `The model cited a brief that was never retrieved (${reason.split(":")[1]}), which is a hallucination. The answer was discarded.`;
  }
  return REFUSAL_COPY[reason] ?? "The pipeline declined to answer.";
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState<"hybrid" | "dense">("hybrid");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);

  async function ask(q: string, overrideMode?: "hybrid" | "dense") {
    const query = q.trim();
    if (!query || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: query,
          category: category || undefined,
          mode: overrideMode ?? mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setResult(null);
      } else {
        setResult(data as AskResponse);
      }
    } catch {
      setError("Network error. Please try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <section className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
          Clinical Knowledge Base — RAG Demo
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-slate-600">
          Hybrid retrieval over 52 schema-validated biomarker briefs, wrapped in a
          LangGraph agent that rewrites and retries before it gives up. Every answer
          cites the briefs it used, and citations are checked against what was actually
          retrieved — so the system can decline, and you can see why.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/evals" className="text-teal-700 underline hover:text-teal-900">
            See the evaluation numbers →
          </Link>
        </p>
      </section>

      <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Demo only.</strong> The briefs use illustrative UK reference values and
        are <strong>not medical advice</strong>. Always consult a healthcare
        professional. Not affiliated with any clinical provider or product.
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={question}
            maxLength={MAX_QUESTION_LEN}
            placeholder="Ask about a blood test or biomarker…"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(question)}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-slate-700 outline-none focus:border-teal-500"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <button
            onClick={() => ask(question)}
            disabled={loading}
            className="rounded-lg bg-teal-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
          >
            {loading ? "Thinking…" : "Ask"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <span className="text-xs text-slate-400">retrieval</span>
          {(["hybrid", "dense"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                (mode === m
                  ? "bg-slate-800 text-white"
                  : "border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100")
              }
            >
              {m === "hybrid" ? "hybrid (dense + BM25)" : "dense only"}
            </button>
          ))}
          <span className="text-xs text-slate-400">
            — switch and re-ask to see the difference on the same question
          </span>
        </div>

        <div className="mt-4 space-y-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.question}
              onClick={() => {
                setQuestion(ex.question);
                ask(ex.question);
              }}
              className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-slate-100 px-3 py-2 text-left transition-colors hover:border-slate-200 hover:bg-slate-50 sm:flex-row sm:items-baseline sm:gap-3"
            >
              <span className="w-24 shrink-0 font-mono text-[11px] text-slate-400">
                {ex.label}
              </span>
              <span className="flex-1 text-sm text-slate-700">{ex.question}</span>
              <span className="hidden text-[11px] text-slate-400 lg:block lg:w-64 lg:shrink-0">
                {ex.note}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {result && !result.refused && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
              {result.answer}
            </p>
            {result.uncovered && (
              <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Not covered by the briefs: {result.uncovered}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-400">cited</span>
              {result.citations.map((c) => (
                <span
                  key={c}
                  className="rounded bg-teal-50 px-2 py-0.5 font-mono text-[11px] text-teal-700 border border-teal-200"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {result && result.refused && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
            <h3 className="font-semibold text-rose-900">No answer given</h3>
            <p className="mt-1 text-sm text-rose-800">
              {refusalCopy(result.refusal_reason)}
            </p>
            <p className="mt-2 font-mono text-[11px] text-rose-400">
              reason: {result.refusal_reason}
            </p>
          </div>
        )}

        {result && (
          <>
            <StatsBar result={result} />
            <TracePanel trace={result.trace} />
            <MatchList matches={result.matches} citations={result.citations} />
          </>
        )}
      </div>

      <section className="mt-14 border-t border-slate-200 pt-8">
        <h2 className="text-lg font-semibold text-slate-900">How it is kept honest</h2>
        <p className="mt-1 text-sm text-slate-500">
          The parts that usually break in a RAG knowledge base, and what stops them here.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            [
              "One schema, enforced in code",
              "Every brief is validated against a Pydantic schema with controlled vocabularies before it is embedded. An invalid brief fails ingest with its filename attached, rather than surfacing later as a confident wrong answer.",
            ],
            [
              "Hard metadata filter, applied first",
              "Unapproved, non-UK or off-category briefs are excluded before similarity runs, on both the vector and keyword sides. They are not outranked — they are never candidates.",
            ],
            [
              "Citations checked, not trusted",
              "The model must cite the source_brief_id of everything it used. Any id that was not in the retrieval result means the answer is discarded — a hallucination becomes a detectable event.",
            ],
            [
              "Refusal is a first-class outcome",
              "A score threshold and an explicit 'the briefs do not cover this' path mean the system declines. The eval scores that behaviour separately, because a system measured only on recall answers everything.",
            ],
          ].map(([title, body]) => (
            <li key={title} className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="font-medium text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-slate-500">
          Stack: Next.js proxy (no provider keys) · FastAPI · LangChain retrieval ·
          LangGraph agent · Pinecone serverless · OpenAI embeddings. Source and the full
          write-up are in the repository.
        </p>
      </section>
    </div>
  );
}
