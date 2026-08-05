"use client";

import { useState } from "react";
import type { TraceStep } from "@/lib/types";

// The graph's execution, step by step. A rewrite-and-retry looks identical to a plain
// answer from the outside, so without this the interesting behaviour is invisible —
// and an unexplained refusal is indistinguishable from a broken service.

const NODE_COLOURS: Record<string, string> = {
  retrieve: "bg-teal-100 text-teal-800 border-teal-300",
  grade: "bg-amber-100 text-amber-800 border-amber-300",
  rewrite: "bg-indigo-100 text-indigo-800 border-indigo-300",
  generate: "bg-sky-100 text-sky-800 border-sky-300",
  refuse: "bg-rose-100 text-rose-800 border-rose-300",
};

function summarise(step: TraceStep): string {
  switch (step.node) {
    case "retrieve": {
      const n = Array.isArray(step.candidates) ? step.candidates.length : 0;
      return `${step.mode} search for "${step.query}" — ${n} candidate${n === 1 ? "" : "s"}, best cosine ${step.best_dense_score}`;
    }
    case "grade":
      return step.passed
        ? `${step.best_dense_score} ≥ ${step.threshold} — evidence is strong enough to answer from`
        : `${step.best_dense_score} < ${step.threshold} — not enough evidence`;
    case "rewrite":
      return `rewrote "${step.from}" → "${step.to}"`;
    case "generate":
      return step.grounded
        ? `answered, citing ${(step.citations as string[])?.join(", ")}`
        : `refused to answer (${step.refusal_reason})`;
    case "refuse":
      return `declined — ${step.reason}`;
    default:
      return "";
  }
}

export function TracePanel({ trace }: { trace: TraceStep[] }) {
  const [open, setOpen] = useState(false);
  if (trace.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">
          Agent trace{" "}
          <span className="font-normal text-slate-400">— {trace.length} steps</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="hidden sm:flex items-center gap-1">
            {trace.map((s, i) => (
              <span
                key={i}
                className={
                  "rounded border px-1.5 py-0.5 font-mono text-[10px] " +
                  (NODE_COLOURS[s.node] ?? "bg-slate-100 text-slate-600 border-slate-300")
                }
              >
                {s.node}
              </span>
            ))}
          </span>
          <span className="text-slate-400">{open ? "−" : "+"}</span>
        </span>
      </button>

      {open && (
        <ol className="border-t border-slate-100">
          {trace.map((step, i) => (
            <li
              key={i}
              className="flex flex-col gap-1 border-b border-slate-50 px-4 py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-3"
            >
              <span
                className={
                  "w-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] " +
                  (NODE_COLOURS[step.node] ?? "bg-slate-100 text-slate-600 border-slate-300")
                }
              >
                {step.node}
              </span>
              <span className="flex-1 text-sm text-slate-600">{summarise(step)}</span>
              <span className="shrink-0 font-mono text-[11px] text-slate-400">{step.ms} ms</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
