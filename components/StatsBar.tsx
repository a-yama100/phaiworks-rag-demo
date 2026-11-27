import type { AskResponse } from "@/lib/types";
import type { Lang } from "@/lib/content";

// Latency, tokens and cost for the query you just ran. Shown by default rather than
// hidden behind a toggle: "it's fast and cheap" is a claim, these are the numbers.
export function StatsBar({ result, lang }: { result: AskResponse; lang: Lang }) {
  const { cost, timing } = result;
  const cellsJa: [string, string][] = [
    ["応答時間", `${timing.total_ms} ms`],
    ["トークン数", `入力 ${cost.input_tokens} / 出力 ${cost.output_tokens}`],
    ["この質問の費用", cost.usd_total === null ? "—" : `$${cost.usd_total.toFixed(6)}`],
    [
      "1,000回あたりの費用（推定）",
      cost.usd_per_1k_queries === null ? "—" : `$${cost.usd_per_1k_queries.toFixed(2)}`,
    ],
    ["検索回数", String(result.queries.length)],
  ];
  const cellsEn: [string, string][] = [
    ["latency", `${timing.total_ms} ms`],
    ["tokens", `${cost.input_tokens} in / ${cost.output_tokens} out`],
    ["this query", cost.usd_total === null ? "—" : `$${cost.usd_total.toFixed(6)}`],
    [
      "per 1k queries",
      cost.usd_per_1k_queries === null ? "—" : `$${cost.usd_per_1k_queries.toFixed(2)}`,
    ],
    ["retrieval passes", String(result.queries.length)],
  ];
  const cells = lang === "ja" ? cellsJa : cellsEn;

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
