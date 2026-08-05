import Link from "next/link";
import type { Metadata } from "next";
import raw from "@/public/eval-results.json";
import type { EvalResults } from "@/lib/types";

export const metadata: Metadata = {
  title: "Evaluation — Clinical Knowledge Base RAG Demo",
  description:
    "Measured retrieval quality for the demo: dense-only vs hybrid on a 60-case gold set, with the failure list and the threshold sweep.",
};

// Statically imported rather than read at runtime. The artefact only changes when the
// eval is re-run and redeployed, so bundling it removes a filesystem dependency that
// behaves differently on Vercel than it does locally.
const results = raw as unknown as EvalResults | { status: "not_run"; note: string };

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function NotRun({ note }: { note: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-900">Evaluation</h1>
      <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
        <p className="font-medium">The eval has not been run against a live index yet.</p>
        <p className="mt-2">{note}</p>
      </div>
      <p className="mt-6 text-sm text-slate-500">
        The harness and the gold set are in the repository under{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">api/eval/</code>. Cases are
        tagged by the failure they are designed to catch — lay wording, exact names,
        confusable clusters, and out-of-scope questions that must be refused.
      </p>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-teal-700 underline hover:text-teal-900">
          ← Back to the demo
        </Link>
      </p>
    </div>
  );
}

function MetricCard({
  label,
  primary,
  comparison,
}: {
  label: string;
  primary: string;
  comparison?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 font-mono text-2xl text-slate-900">{primary}</div>
      <div className="mt-1 font-mono text-xs text-slate-400">
        {comparison ? `hybrid: ${comparison}` : " "}
      </div>
    </div>
  );
}

export default function EvalsPage() {
  if ("status" in results && results.status === "not_run") {
    return <NotRun note={results.note} />;
  }

  const r = results as EvalResults;
  const { hybrid, dense } = r.modes;
  const k = r.config.top_k;
  const recallKey = `recall_at_${k}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">Evaluation</h1>
      <p className="mt-3 max-w-2xl text-slate-600">
        Measured on a {r.gold_set_size}-case gold set. The headline figures are the
        shipped configuration — dense retrieval — with hybrid shown alongside as the
        comparison it lost. Out-of-scope cases are scored separately on refusal: a
        pipeline tuned only for recall answers every question, including the ones it
        should decline.
      </p>
      <p className="mt-2 font-mono text-xs text-slate-400">
        {r.config.embed_model} · top_k={k} · min_score={r.config.min_score} · run{" "}
        {r.generated_at}
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="top-1 accuracy"
          primary={pct(dense.top1)}
          comparison={pct(hybrid.top1)}
        />
        <MetricCard
          label={`recall@${k}`}
          primary={pct(dense[recallKey] as number)}
          comparison={pct(hybrid[recallKey] as number)}
        />
        <MetricCard
          label="MRR"
          primary={dense.mrr.toFixed(3)}
          comparison={hybrid.mrr.toFixed(3)}
        />
        <MetricCard
          label="refusal, retrieval only"
          primary={pct(dense.refusal_accuracy)}
        />
      </div>

      {r.generation && (
        <section className="mt-10 rounded-xl border border-teal-200 bg-teal-50/50 p-5">
          <h2 className="text-lg font-semibold text-slate-900">End to end, through the agent</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            The retrieval threshold above refuses{" "}
            {pct(dense.refusal_accuracy)} of out-of-scope questions. It cannot do better,
            because the ones it lets through are squarely on topic — asking for a
            diagnosis, a drug dose, a product recommendation. A cosine score has no way to
            tell those apart from a legitimate question about the same biomarker. The
            generation stage does, and catches all of them.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["out-of-scope refused", pct(r.generation.out_of_scope_refused)],
              ["in-scope answered", pct(r.generation.in_scope_answered)],
              ["cited the right brief", pct(r.generation.cited_the_expected_brief)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">
                  {label}
                </div>
                <div className="mt-1 font-mono text-2xl text-slate-900">{value}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-xs text-slate-400">
            {r.generation.chat_model} · zero hallucinated citations: the harness asserts
            every cited id was in the retrieval result
          </p>
          {r.generation.notable && r.generation.notable.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-slate-600">
                The in-scope cases it declined are all requests for a personal diagnosis.
                The retrieval label is right — HbA1c <em>is</em> the brief for &ldquo;am I
                prediabetic&rdquo; — but declining to diagnose is also right, so these are
                counted as misses by a gold set that only labels retrieval:
              </p>
              <ul className="mt-2 space-y-1">
                {r.generation.notable.map((n) => (
                  <li key={n.id} className="text-sm text-slate-500">
                    <span className="font-mono text-[11px] text-slate-400">{n.id}</span>{" "}
                    {n.question} —{" "}
                    <span className="font-mono text-[11px]">{n.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {r.weight_sweep && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">
            Why hybrid retrieval was dropped
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Hybrid search is the standard recommendation and was the original design here.
            Sweeping the weight BM25 carries in the fusion shows it never helps on this
            corpus and degrades monotonically: BM25 latches onto a domain word many briefs
            share — &ldquo;cholesterol&rdquo; — and floats all of them above the one that
            answers the question. Kept in the code, off by default.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-medium">BM25 weight</th>
                  <th className="py-2 pr-4 font-medium">top-1</th>
                  <th className="py-2 pr-4 font-medium">MRR</th>
                </tr>
              </thead>
              <tbody>
                {r.weight_sweep.map((row) => (
                  <tr
                    key={String(row.bm25_weight)}
                    className={
                      "border-b border-slate-100 " +
                      (row.bm25_weight === "dense-only" ? "bg-teal-50" : "")
                    }
                  >
                    <td className="py-2 pr-4 font-mono text-slate-700">
                      {String(row.bm25_weight)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-900">{pct(row.top1)}</td>
                    <td className="py-2 pr-4 font-mono text-slate-500">
                      {row.mrr.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-slate-900">By case type</h2>
        <p className="mt-1 text-sm text-slate-500">
          Broken down by the failure each case type is designed to catch. The `exact`
          row is the one that settled the hybrid question: keyword search exists to rescue
          verbatim names, and dense retrieval already gets every one of them.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-medium">case type</th>
                <th className="py-2 pr-4 font-medium">n</th>
                <th className="py-2 pr-4 font-medium">dense (shipped)</th>
                <th className="py-2 pr-4 font-medium">hybrid</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(hybrid.by_tag).map((tag) => (
                <tr key={tag} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-mono text-xs text-slate-700">{tag}</td>
                  <td className="py-2 pr-4 text-slate-500">{hybrid.by_tag[tag].n}</td>
                  <td className="py-2 pr-4 font-mono text-slate-900">
                    {pct(dense.by_tag[tag]?.accuracy ?? 0)}
                  </td>
                  <td className="py-2 pr-4 font-mono text-slate-500">
                    {pct(hybrid.by_tag[tag].accuracy)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {r.threshold_sweep && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">Threshold sweep</h2>
          <p className="mt-1 text-sm text-slate-500">
            Why min_score is {r.config.min_score} and not a rounder number. Raising it
            refuses more out-of-scope questions and starts declining ones it could have
            answered; the chosen value is the peak of the combined column.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-medium">threshold</th>
                  <th className="py-2 pr-4 font-medium">answered correctly</th>
                  <th className="py-2 pr-4 font-medium">correctly refused</th>
                  <th className="py-2 pr-4 font-medium">combined</th>
                </tr>
              </thead>
              <tbody>
                {r.threshold_sweep.map((row) => (
                  <tr
                    key={row.threshold}
                    className={
                      "border-b border-slate-100 " +
                      (row.threshold === r.config.min_score ? "bg-teal-50" : "")
                    }
                  >
                    <td className="py-2 pr-4 font-mono text-slate-700">
                      {row.threshold.toFixed(2)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-500">
                      {pct(row.answered_correctly)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-500">
                      {pct(row.correctly_refused)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-900">
                      {pct(row.combined)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dense.failures.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">
            Remaining failures{" "}
            <span className="font-normal text-slate-400">({dense.failures.length})</span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Published rather than trimmed. A gold set with no failures left has usually
            been edited to match the system rather than the other way round.
          </p>
          <ul className="mt-4 space-y-2">
            {dense.failures.map((f) => (
              <li key={f.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11px] text-slate-400">{f.id}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                    {f.tag}
                  </span>
                  <span className="text-sm text-slate-700">{f.question}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  expected <span className="font-mono">{f.expect ?? "a refusal"}</span> ·
                  got <span className="font-mono">{f.got.join(", ") || "nothing"}</span> ·
                  best cosine <span className="font-mono">{f.best_dense_score}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-sm">
        <Link href="/" className="text-teal-700 underline hover:text-teal-900">
          ← Back to the demo
        </Link>
      </p>
    </div>
  );
}
