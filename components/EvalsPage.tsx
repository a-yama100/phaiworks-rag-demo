import Link from "next/link";
import raw from "@/public/eval-results.json";
import type { EvalResults } from "@/lib/types";
import { H1, PATHS, type Lang } from "@/lib/content";

// Statically imported rather than read at runtime. The artefact only changes when the
// eval is re-run and redeployed, so bundling it removes a filesystem dependency that
// behaves differently on Vercel than it does locally.
// 評価のデータ（質問・タグ・理由）は英語のまま表示する。
const results = raw as unknown as EvalResults | { status: "not_run"; note: string };

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function NotRun({ note, lang }: { note: string; lang: Lang }) {
  const ja = lang === "ja";
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-900">{H1[lang].evals}</h1>
      <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
        <p className="font-medium">
          {ja
            ? "検索インデックスを使った評価は、まだ実行していません。"
            : "The eval has not been run against a live index yet."}
        </p>
        <p className="mt-2">{note}</p>
      </div>
      {ja ? (
        <p className="mt-6 text-sm text-slate-500">
          {"評価のプログラムとテスト用の質問は、リポジトリの "}
          <code className="rounded bg-slate-100 px-1 py-0.5">api/eval/</code>
          {" にあります。質問には、確かめたい失敗の種類ごとにタグを付けています。日常的な表現、検査項目の名前、紛らわしい質問の組、回答を見送るべき対象外の質問です。"}
        </p>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          The harness and the gold set are in the repository under{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5">api/eval/</code>. Cases are
          tagged by the failure they are designed to catch — lay wording, exact names,
          confusable clusters, and out-of-scope questions that must be refused.
        </p>
      )}
      <p className="mt-6 text-sm">
        <Link href={PATHS[lang].home} className="text-teal-700 underline hover:text-teal-900">
          {ja ? "← デモに戻る" : "← Back to the demo"}
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
        {comparison ? `hybrid: ${comparison}` : " "}
      </div>
    </div>
  );
}

const TEXT = {
  ja: {
    top1: "検索結果1位の正答率",
    mrr: "MRR",
    refusalRetrieval: "見送りの正しさ（検索の段階）",
    endToEnd: "エージェント全体での結果",
    outRefused: "対象外の質問を見送った割合",
    inAnswered: "対象内の質問に答えた割合",
    citedRight: "正しい資料を引用した割合",
    zeroHallucination: " · 検索結果にない資料の引用は0件。引用したすべての ID が検索結果にあることを、評価のプログラムで確かめています",
    weightTitle: "ベクトル検索を標準にした理由",
    bm25Weight: "BM25 の重み",
    byTag: "質問の種類ごとの結果",
    caseType: "質問の種類",
    denseShipped: "dense（標準）",
    sweepTitle: "しきい値ごとの結果",
    threshold: "しきい値",
    answered: "正しく回答",
    refused: "正しく見送り",
    combined: "合計",
    failuresTitle: "失敗した質問",
    expected: "期待した結果",
    aRefusal: "回答の見送り",
    got: "実際の結果",
    nothing: "なし",
    bestCosine: "最も高いコサイン類似度",
    back: "← デモに戻る",
  },
  en: {
    top1: "top-1 accuracy",
    mrr: "MRR",
    refusalRetrieval: "refusal, retrieval only",
    endToEnd: "End to end, through the agent",
    outRefused: "out-of-scope refused",
    inAnswered: "in-scope answered",
    citedRight: "cited the right brief",
    zeroHallucination: " · zero hallucinated citations: the harness asserts every cited id was in the retrieval result",
    weightTitle: "Why hybrid retrieval was dropped",
    bm25Weight: "BM25 weight",
    byTag: "By case type",
    caseType: "case type",
    denseShipped: "dense (shipped)",
    sweepTitle: "Threshold sweep",
    threshold: "threshold",
    answered: "answered correctly",
    refused: "correctly refused",
    combined: "combined",
    failuresTitle: "Remaining failures",
    expected: "expected",
    aRefusal: "a refusal",
    got: "got",
    nothing: "nothing",
    bestCosine: "best cosine",
    back: "← Back to the demo",
  },
};

export function EvalsPage({ lang }: { lang: Lang }) {
  if ("status" in results && results.status === "not_run") {
    return <NotRun note={results.note} lang={lang} />;
  }

  const ja = lang === "ja";
  const t = TEXT[lang];
  const r = results as EvalResults;
  const { hybrid, dense } = r.modes;
  const k = r.config.top_k;
  const recallKey = `recall_at_${k}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">{H1[lang].evals}</h1>
      {ja ? (
        <p className="mt-3 max-w-2xl text-slate-600">
          {`正解を決めてある${r.gold_set_size}件のテスト用の質問（正解セット）で試した結果です。主な数値は、標準で使っている dense（ベクトル）検索のものです。結果が下回ったハイブリッド検索の数値も、比べられるよう並べています。対象外の質問は、正しく見送ったかどうかで別に採点しています。答えを見つけることだけを指標にすると、見送るべき質問にまで答えるシステムのほうが高く評価されてしまうためです。`}
        </p>
      ) : (
        <p className="mt-3 max-w-2xl text-slate-600">
          Tested on {r.gold_set_size} sample questions with known correct answers (a
          &ldquo;gold set&rdquo;). The main figures are for the setup in use, dense
          retrieval. Hybrid search, which scored lower, is shown beside them for
          comparison. Out-of-scope questions are scored separately on whether they were
          refused: a system tuned only to find answers will answer everything, even
          questions it should decline.
        </p>
      )}
      <p className="mt-2 font-mono text-xs text-slate-400">
        {r.config.embed_model} · top_k={k} · min_score={r.config.min_score} · run{" "}
        {r.generated_at}
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={t.top1}
          primary={pct(dense.top1)}
          comparison={pct(hybrid.top1)}
        />
        <MetricCard
          label={`recall@${k}`}
          primary={pct(dense[recallKey] as number)}
          comparison={pct(hybrid[recallKey] as number)}
        />
        <MetricCard
          label={t.mrr}
          primary={dense.mrr.toFixed(3)}
          comparison={hybrid.mrr.toFixed(3)}
        />
        <MetricCard
          label={t.refusalRetrieval}
          primary={pct(dense.refusal_accuracy)}
        />
      </div>

      {r.generation && (
        <section className="mt-10 rounded-xl border border-teal-200 bg-teal-50/50 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t.endToEnd}</h2>
          {ja ? (
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              {`類似度のしきい値だけで見送れる対象外の質問は ${pct(dense.refusal_accuracy)} です。しきい値を上げればこの割合は上がりますが、答えるべき質問まで見送るようになります（下の「しきい値ごとの結果」）。すり抜ける質問は、診断や薬の投与量、製品のおすすめを求めるもので、話題としては明らかに血液検査の範囲内だからです。類似度では、同じ血液マーカーについての正当な質問と見分けられません。回答を作る段階ではこれを見分けられ、今回のテストではすべて見送りました。`}
            </p>
          ) : (
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              The score threshold alone refuses {pct(dense.refusal_accuracy)} of
              out-of-scope questions. A higher threshold refuses more of them, but it
              also starts declining questions it should answer (see the threshold sweep
              below). The ones that get through are clearly on topic: they ask for a
              diagnosis, a drug dose or a product recommendation. A similarity score
              can&apos;t tell these apart from a fair question about the same blood marker.
              The answer-writing step can, and in this test it declined all of them.
            </p>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              [t.outRefused, pct(r.generation.out_of_scope_refused)],
              [t.inAnswered, pct(r.generation.in_scope_answered)],
              [t.citedRight, pct(r.generation.cited_the_expected_brief)],
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
            {r.generation.chat_model}
            {t.zeroHallucination}
          </p>
          {r.generation.notable && r.generation.notable.length > 0 && (
            <div className="mt-4">
              {ja ? (
                <p className="text-sm text-slate-600">
                  {"対象内なのに見送った質問は、どれも個人の診断を求めるものでした。検索は正しい資料を見つけており（「前糖尿病かどうか」の質問に対する HbA1c の資料）、診断を見送るのも正しい判断です。それでも失敗に数えられるのは、正解セットが回答ではなく検索の結果を確かめているためです。"}
                </p>
              ) : (
                <p className="text-sm text-slate-600">
                  The in-scope questions it declined all ask for a personal diagnosis. The
                  search found the right brief (HbA1c <em>is</em> the brief for &ldquo;am I
                  prediabetic&rdquo;), and declining to diagnose is also the right call.
                  They count as misses only because the gold set checks retrieval, not
                  answers:
                </p>
              )}
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
          <h2 className="text-lg font-semibold text-slate-900">{t.weightTitle}</h2>
          {ja ? (
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              {"ハイブリッド検索は一般によく勧められる方法で、このデモも最初はハイブリッド検索で作りました。しかし、キーワード検索（BM25）の重みを変えて試すと、試したどの重みでも結果は良くならず、重みを増やすほど悪くなりました。このデモの資料では、BM25 が「コレステロール」のように多くの資料に共通する語に強く反応し、それらの資料を、質問に答える資料より上に押し上げていました。ハイブリッド検索は画面で切り替えて試せますが、標準では使っていません。"}
            </p>
          ) : (
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Hybrid search is the usual recommendation, and this demo was first built
              with it. But testing different weights for the keyword part (BM25) showed it
              never helped here: the more weight it got, the worse the results. BM25 locks
              onto a word that many briefs share, such as &ldquo;cholesterol&rdquo;, and
              pushes all of them above the one that answers the question. The code is still
              there, but it is off by default.
            </p>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-medium">{t.bm25Weight}</th>
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
        <h2 className="text-lg font-semibold text-slate-900">{t.byTag}</h2>
        {ja ? (
          <p className="mt-1 text-sm text-slate-500">
            {"質問の種類ごとの結果です。種類ごとに、確かめたい失敗が異なります。ハイブリッド検索を標準にしなかった判断は、"}
            <code className="font-mono text-xs">exact</code>
            {" の行の結果によります。キーワード検索は正確な名前の検索に強いとされますが、dense 検索だけで、すでにすべて正しく見つけていました。"}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Results by question type. Each type is designed to catch a different kind of
            failure. The <code className="font-mono text-xs">exact</code> row settled the
            hybrid question: keyword search is meant to help with exact names, but dense
            retrieval already finds every one of them.
          </p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-medium">{t.caseType}</th>
                <th className="py-2 pr-4 font-medium">n</th>
                <th className="py-2 pr-4 font-medium">{t.denseShipped}</th>
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
          <h2 className="text-lg font-semibold text-slate-900">{t.sweepTitle}</h2>
          {ja ? (
            <p className="mt-1 text-sm text-slate-500">
              {`類似度のしきい値（min_score）を、切りのいい数字ではなく ${r.config.min_score} にした理由です。しきい値を上げると対象外の質問をより多く見送れますが、答えられたはずの質問まで見送り始めます。選んだ値は、正しく回答した質問と正しく見送った質問を合わせた割合が最も高くなる値です。`}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              Why min_score is {r.config.min_score} and not a rounder number. A higher
              threshold refuses more out-of-scope questions, but it also starts declining
              questions it could have answered. The chosen value gives the best combined
              score.
            </p>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-medium">{t.threshold}</th>
                  <th className="py-2 pr-4 font-medium">{t.answered}</th>
                  <th className="py-2 pr-4 font-medium">{t.refused}</th>
                  <th className="py-2 pr-4 font-medium">{t.combined}</th>
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
            {t.failuresTitle}{" "}
            <span className="font-normal text-slate-400">({dense.failures.length})</span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {ja
              ? "失敗した質問も、隠さずにすべて載せています。失敗が0件の評価は、テストのほうをシステムに合わせて直した結果であることも多いためです。"
              : "Shown in full, not hidden. A test set with zero failures has usually been edited to fit the system, not the other way round."}
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
                  {t.expected} <span className="font-mono">{f.expect ?? t.aRefusal}</span> ·{" "}
                  {t.got} <span className="font-mono">{f.got.join(", ") || t.nothing}</span> ·{" "}
                  {t.bestCosine} <span className="font-mono">{f.best_dense_score}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-sm">
        <Link href={PATHS[lang].home} className="text-teal-700 underline hover:text-teal-900">
          {t.back}
        </Link>
      </p>
    </div>
  );
}
