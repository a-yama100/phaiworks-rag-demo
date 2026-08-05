import type { AskResponse } from "@/lib/types";

// Latency, tokens and cost for the query you just ran. Shown by default rather than
// hidden behind a toggle: "it's fast and cheap" is a claim, these are the numbers.
export function StatsBar({ result }: { result: AskResponse }) {
  const { cost, timing } = result;
  const cells: [string, string][] = [
    ["latency", `${timing.total_ms} ms`],
    ["tokens", `${cost.input_tokens} in / ${cost.output_tokens} out`],
    ["this query", cost.usd_total === null ? "—" : `$${cost.usd_total.toFixed(6)}`],
    [
      "per 1k queries",
      cost.usd_per_1k_queries === null ? "—" : `$${cost.usd_per_1k_queries.toFixed(2)}`,
    ],
    ["retrieval passes", String(result.queries.length)],
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
      {cells.map(([label, value]) => (
        <div key={label} className="bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-0.5 font-mono text-sm text-slate-800 break-all">{value}</div>
        </div>
      ))}
    </div>
  );
}
