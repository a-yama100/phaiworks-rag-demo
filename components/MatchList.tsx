"use client";

import { useState } from "react";
import type { Match } from "@/lib/types";

// Which retriever found a document, and where each ranked it. This is the difference
// between "the search works" and being able to say why a particular brief came back
// third — the latter is what you need when a client reports a bad answer.
function RetrieverTags({ match }: { match: Match }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {match.dense_rank !== null && (
        <span className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-teal-700 border border-teal-200">
          dense #{match.dense_rank}
          {match.dense_score !== null && ` · ${match.dense_score.toFixed(3)}`}
        </span>
      )}
      {match.sparse_rank !== null && (
        <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-indigo-700 border border-indigo-200">
          bm25 #{match.sparse_rank}
        </span>
      )}
      <span className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-slate-500 border border-slate-200">
        rrf {match.fused_score.toFixed(4)}
      </span>
    </div>
  );
}

export function MatchList({ matches, citations }: { matches: Match[]; citations: string[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (matches.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">
        Retrieved briefs{" "}
        <span className="font-normal text-slate-400">
          — {matches.length} candidate{matches.length === 1 ? "" : "s"} passed to the model
        </span>
      </h3>
      {matches.map((m) => {
        const cited = citations.includes(m.source);
        const open = expanded === m.source;
        return (
          <div
            key={m.source}
            className={
              "rounded-lg border bg-white " +
              (cited ? "border-teal-300 ring-1 ring-teal-100" : "border-slate-200")
            }
          >
            <button
              onClick={() => setExpanded(open ? null : m.source)}
              className="flex w-full flex-col gap-2 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{m.biomarker}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                  {m.category}
                </span>
                {cited && (
                  <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    cited
                  </span>
                )}
              </div>
              <RetrieverTags match={m} />
            </button>
            {open && (
              <div className="border-t border-slate-100 px-4 py-3">
                <div className="mb-2 font-mono text-[11px] text-slate-400 break-all">
                  {m.source}
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-700">
                  {m.answer}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
