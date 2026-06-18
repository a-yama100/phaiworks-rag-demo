"use client";

import { useState } from "react";

type Match = {
  biomarker: string;
  category: string;
  source: string;
  score: number;
  answer: string;
};

const CATEGORY_OPTIONS = [
  { value: "", label: "All categories" },
  { value: "metabolic", label: "Metabolic" },
  { value: "lipid", label: "Lipid" },
  { value: "thyroid", label: "Thyroid" },
  { value: "haematology", label: "Haematology" },
  { value: "vitamin_mineral", label: "Vitamin / Mineral" },
];

const EXAMPLES = [
  "What does a high HbA1c mean?",
  "bad cholesterol and heart risk",
  "is my thyroid underactive?",
  "I'm always tired — which iron test matters?",
  "how do I fix a flat tyre?",
];

export default function Home() {
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ matches: Match[] } | null>(null);

  async function ask(q: string) {
    const query = q.trim();
    if (!query || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query, category: category || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
      } else {
        setResult({ matches: data.matches });
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <section className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">
          Clinical Knowledge Base — RAG Retrieval Demo
        </h1>
        <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
          A live retrieval pipeline over clinically-structured biomarker briefs.
          Your question is embedded by Pinecone&apos;s hosted model, then matched
          against the index behind a hard metadata filter. Answers are returned
          verbatim from approved entries — no language model generates them.
        </p>
      </section>

      <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Demo only.</strong> The underlying entries use illustrative UK
        reference values for demonstration and are <strong>not medical advice</strong>.
        Always consult a healthcare professional. Not affiliated with any clinical
        provider or product.
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={question}
            maxLength={200}
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
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => ask(question)}
            disabled={loading}
            className="rounded-lg bg-teal-600 px-5 py-2.5 font-medium text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setQuestion(ex);
                ask(ex);
              }}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {result && result.matches.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-5 text-slate-600">
            No approved entry confidently matched your question. The assistant says
            it doesn&apos;t know rather than guessing — this is the metadata filter
            and score threshold doing their job.
          </div>
        )}

        {result &&
          result.matches.map((m, i) => (
            <div
              key={m.source + i}
              className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">
                    {m.biomarker}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {m.category}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>score {m.score}</span>
                  <span className="font-mono break-all">{m.source}</span>
                </div>
              </div>
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-700">
                {m.answer}
              </pre>
            </div>
          ))}
      </div>

      <section className="mt-14 border-t border-slate-200 pt-8">
        <h2 className="text-lg font-semibold text-slate-900">
          How consistency is enforced
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          The discipline behind the demo — the part that usually breaks in a RAG
          knowledge base.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["One schema, enforced in code", "Every brief is validated against a Pydantic schema with controlled vocabularies before it is ever embedded. Invalid entries never reach the index."],
            ["Deterministic IDs, no duplicates", "Each entry's vector ID is a hash of its source brief, so re-ingesting upserts in place. A content hash skips unchanged entries to avoid needless re-embedding."],
            ["Hard metadata filter", "Queries filter on approved status, language and optional category before vector similarity — so unapproved or off-category content can't surface."],
            ["Anti-hallucination threshold", "Matches below a cosine score are dropped, so the assistant declines rather than inventing an answer. No LLM generates the response text."],
          ].map(([title, body]) => (
            <li
              key={title}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <h3 className="font-medium text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-slate-500">
          Stack: Next.js · Pinecone serverless with integrated inference
          (<code>llama-text-embed-v2</code>, cosine) — embeddings hosted, no
          third-party LLM key on the public endpoint.
        </p>
      </section>
    </div>
  );
}
