"use client";

import Link from "next/link";
import { useState } from "react";
import { MatchList } from "@/components/MatchList";
import { StatsBar } from "@/components/StatsBar";
import { TracePanel } from "@/components/TracePanel";
import { CATEGORIES, CATEGORY_LABELS, MAX_QUESTION_LEN } from "@/lib/config";
import { CATEGORY_LABELS_JA, H1, PATHS, type Lang } from "@/lib/content";
import type { AskResponse } from "@/lib/types";

// 例の質問は、評価の説明（note）がその英文での結果を表しているため、日本語のページでも英文のまま使う
const EXAMPLES: { label: string; label_ja: string; question: string; note: string; note_ja: string }[] = [
  {
    label: "lay wording",
    label_ja: "日常的な表現",
    question: "I'm always tired and think my iron is low",
    note: "no marker named, and Ferritin still comes first",
    note_ja: "検査項目の名前を書かなくても、フェリチンの資料が1位に出る",
  },
  {
    label: "exact name",
    label_ja: "検査項目の名前",
    question: "GGT",
    note: "all 12 exact-name tests pass without keyword search",
    note_ja: "キーワード検索を使わなくても、検査項目の名前で探す12件のテストにすべて合格",
  },
  {
    label: "confusable",
    label_ja: "紛らわしい質問",
    question: "the iron test that is not thrown off by inflammation",
    note: "four iron briefs look relevant; only one is correct",
    note_ja: "鉄に関する4件の資料のうち、質問に合うのは1件だけ",
  },
  {
    label: "out of scope",
    label_ja: "回答の対象外",
    question: "what dose of levothyroxine should I take",
    note: "finds the TSH brief, but it doesn't cover dosing, so the answer is declined",
    note_ja: "TSH の資料は見つかるが、薬の投与量は扱っていないため回答を見送る",
  },
  {
    label: "off topic",
    label_ja: "血液検査と無関係",
    question: "how do I fix a flat tyre",
    note: "no brief scores high enough, so nothing is returned",
    note_ja: "類似度がしきい値に届く資料がないため、回答を見送る",
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

const REFUSAL_COPY_JA: Record<string, string> = {
  below_threshold:
    "質問との類似度がしきい値に届く資料がなかったため、最も近い資料を無理に使わず、回答を見送りました。",
  model_declined:
    "資料は見つかりましたが、質問に答える情報は含まれていないとモデルが判断したため、回答を見送りました。",
  no_evidence: "質問を書き換えて再検索しましたが、資料が1件も見つかりませんでした。",
  no_citation: "モデルがどの資料も引用せずに回答したため、その回答を採用しませんでした。",
  unparseable_output:
    "モデルの出力が決まった形式になっていなかったため、回答を採用しませんでした。",
};

function refusalCopy(reason: string, lang: Lang): string {
  if (reason.startsWith("ungrounded_citation")) {
    const id = reason.split(":")[1];
    return lang === "ja"
      ? `モデルが、検索結果に含まれていない資料（${id}）を引用したため、回答を破棄しました。`
      : `The model cited a brief that was never retrieved (${id}), which is a hallucination. The answer was discarded.`;
  }
  if (lang === "ja") return REFUSAL_COPY_JA[reason] ?? "回答を見送りました。";
  return REFUSAL_COPY[reason] ?? "The pipeline declined to answer.";
}

const TEXT = {
  ja: {
    heroAlt:
      "採血管と、資料を1つ選び出す虫眼鏡、出典の確認済みの印が付いたチャットの回答を描いたイラスト",
    disclaimerTitle: "RAG の技術デモです。",
    disclaimerBody: (
      <>
        {"資料には説明用の英国の参考基準値を使っており、医療の専門家の確認は受けていません。このデモの回答は"}
        <strong>医療上の助言ではありません</strong>
        {"。健康についてのご相談は、医療の専門家にお願いします。医療機関や医療製品とは関係がありません。資料が英語のため、回答は英語で表示されます。質問は日本語でもできますが、英語をおすすめします。"}
      </>
    ),
    questionLabel: "血液検査・バイオマーカーに関する質問",
    placeholder: "血液検査やバイオマーカーに関する質問を入力してください（英語推奨）",
    categoryLabel: "資料の分類",
    allCategories: "すべての分類",
    thinking: "回答を作成中…",
    ask: "質問する",
    retrieval: "検索方式",
    dense: "ベクトル検索（dense・標準）",
    hybrid: "ハイブリッド検索（dense + BM25）",
    modeNote: "— テストでの1位の正答率は、ハイブリッド検索が90%、ベクトル検索が96%でした。方式を切り替えて同じ質問をすると、違いを比べられます。",
    genericError: "エラーが発生しました。",
    networkError: "通信エラーが発生しました。もう一度お試しください。",
    uncovered: "資料に書かれていない内容: ",
    cited: "引用",
    noAnswer: "回答を見送りました",
    reason: "理由: ",
  },
  en: {
    heroAlt:
      "Illustration of a clinical knowledge base: blood test tubes, a magnifying glass picking the one matching document, and a chat answer with verified source tags",
    disclaimerTitle: "Demo only.",
    disclaimerBody: (
      <>
        {" "}The briefs use illustrative UK reference values and
        are <strong>not medical advice</strong>. Always consult a healthcare
        professional. Not affiliated with any clinical provider or product.
      </>
    ),
    questionLabel: "Question about a blood test or biomarker",
    placeholder: "Ask about a blood test or biomarker…",
    categoryLabel: "Category",
    allCategories: "All categories",
    thinking: "Thinking…",
    ask: "Ask",
    retrieval: "retrieval",
    dense: "dense (default)",
    hybrid: "hybrid (dense + BM25)",
    modeNote: "— hybrid scored lower in testing (90% vs 96%). Switch modes and ask again to compare.",
    genericError: "Something went wrong.",
    networkError: "Network error. Please try again.",
    uncovered: "Not covered by the briefs: ",
    cited: "cited",
    noAnswer: "No answer given",
    reason: "reason: ",
  },
};

const POINTS: Record<Lang, [string, string][]> = {
  ja: [
    [
      "取り込む前に資料の形式を確認",
      "資料を検索インデックスに登録する前に、決まった形式（使える語を固定した Pydantic のスキーマ）に合っているかをコードで確かめます。形式に誤りのある資料があれば、取り込みを止めてファイル名を示します。形式の誤りに気づかないまま、資料が検索の対象になることはありません。",
    ],
    [
      "検索の前に対象を絞り込む",
      "状態が「承認済み」でない資料（下書き・廃止）や、英国以外の資料、指定と違う分類の資料は、類似度で検索する前に除外します。ベクトル検索でもキーワード検索でも同じで、最初から候補になりません。",
    ],
    [
      "引用した資料を検索結果と照合",
      "モデルには、回答に使ったすべての資料の ID（source_brief_id）を示させます。検索結果にない ID を引用した回答は破棄するので、検索で見つかっていない資料を出典に挙げる誤りは、必ず検出されます。",
    ],
    [
      "回答を見送る仕組みと、その評価",
      "類似度の下限（しきい値）と、「資料では扱っていない」と答える選択肢があるので、システムは回答を見送れます。答えを見つけることだけで評価すると、何にでも答えるシステムのほうが良く見えてしまうため、評価では見送りの正しさを別に採点しています。",
    ],
  ],
  en: [
    [
      "Every brief follows one checked format",
      "Before a brief is added to the search index, code checks it against a fixed format (a Pydantic schema with set vocabularies). A brief with an error stops the import and names the file, instead of later producing a confident wrong answer.",
    ],
    [
      "Filters run before the search",
      "Briefs that are unapproved, not UK-based or in the wrong category are removed before any similarity search, on both the vector and keyword side. They are never candidates at all.",
    ],
    [
      "Citations checked, not trusted",
      "The model must list the ID (source_brief_id) of every brief it used. If it cites an ID that the search did not return, the answer is thrown away, so a made-up source becomes an error you can detect.",
    ],
    [
      "Declining to answer is a valid result",
      "A minimum score and an explicit \"the briefs don't cover this\" option let the system decline. The evaluation scores refusals separately, because a system judged only on finding answers will try to answer everything.",
    ],
  ],
};

export function HomePage({ lang }: { lang: Lang }) {
  const t = TEXT[lang];
  const ja = lang === "ja";
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState<"hybrid" | "dense">("dense");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);

  async function ask(q: string, overrideMode?: "hybrid" | "dense") {
    const query = q.trim();
    if (!query || loading) return;
    setLoading(true);
    setError("");
    try {
      // 言語は誤りの文にだけ使う（回答の言語は Python の側で英語に固定）
      const res = await fetch(`/api/ask?lang=${lang}`, {
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
        setError(data.error || t.genericError);
        setResult(null);
      } else {
        setResult(data as AskResponse);
      }
    } catch {
      setError(t.networkError);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <section className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">{H1[lang].home}</h1>
        {/* eslint-disable-next-line @next/next/no-img-element -- 同じ origin の静的ファイル。next/image の最適化は使わない */}
        <img
          src="/media/hero.webp"
          alt={t.heroAlt}
          width={1600}
          height={679}
          className="mt-6 aspect-[1600/679] w-full rounded-xl object-cover"
        />
        {ja ? (
          <>
            <p className="mt-6 text-slate-600">
              {"血液検査について質問してください。このデモは、形式を確認した52件の血液マーカーの要約（以下「資料」）を検索します。類似度がしきい値に届く資料がないときは、LangGraph のエージェントが質問を医学の言葉に書き換えて、もう一度検索します。回答には使った資料の ID が必ず示され、それが実際に検索で見つかった資料かをシステムが確認します。資料から答えられないときは回答を見送り、その理由を表示します。"}
            </p>
            <p className="mt-3 text-sm text-slate-500">
              {"正解を決めてある60件のテスト用の質問で試したところ、正しい資料が検索結果の1位に出た割合は "}
              <strong>96%</strong>
              {"、対象外の質問への回答を正しく見送った割合は "}
              <strong>100%</strong>
              {" でした。"}
            </p>
          </>
        ) : (
          <>
            <p className="mt-6 text-slate-600">
              Ask a question about a blood test. The system searches 52 checked summaries of
              blood markers (&ldquo;biomarker briefs&rdquo;). If the first search misses, a
              LangGraph agent rewrites the question and tries again. Every answer lists the
              briefs it used, and the system checks that each one really came from the
              search. If it can&apos;t answer reliably, it says so and shows you why.
            </p>
            <p className="mt-3 text-sm text-slate-500">
              Tested on 60 sample questions with known answers: the right brief came first{" "}
              <strong>96%</strong> of the time, and <strong>100%</strong> of out-of-scope
              questions were refused.
            </p>
          </>
        )}
        <p className="mt-3 text-sm">
          <Link href={PATHS[lang].evals} className="text-teal-700 underline hover:text-teal-900">
            {ja ? "評価の結果と、失敗した質問を見る →" : "See the evaluation, including what still fails →"}
          </Link>
        </p>
      </section>

      <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>{t.disclaimerTitle}</strong>
        {t.disclaimerBody}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input aria-label={t.questionLabel} name="question" autoComplete="off"
            type="text"
            value={question}
            maxLength={MAX_QUESTION_LEN}
            placeholder={t.placeholder}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(question)}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <select aria-label={t.categoryLabel} name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-slate-700 outline-none focus:border-teal-500"
          >
            <option value="">{t.allCategories}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {ja ? CATEGORY_LABELS_JA[c] : CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <button
            onClick={() => ask(question)}
            disabled={loading}
            className="rounded-lg bg-teal-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
          >
            {loading ? t.thinking : t.ask}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <span className="text-xs text-slate-400">{t.retrieval}</span>
          {(["dense", "hybrid"] as const).map((m) => (
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
              {m === "dense" ? t.dense : t.hybrid}
            </button>
          ))}
          <span className="text-xs text-slate-400">{t.modeNote}</span>
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
                {ja ? ex.label_ja : ex.label}
              </span>
              <span className="flex-1 text-sm text-slate-700">{ex.question}</span>
              <span className="hidden text-[11px] text-slate-400 lg:block lg:w-64 lg:shrink-0">
                {ja ? ex.note_ja : ex.note}
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
                {t.uncovered}
                {result.uncovered}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-400">{t.cited}</span>
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
            <h3 className="font-semibold text-rose-900">{t.noAnswer}</h3>
            <p className="mt-1 text-sm text-rose-800">
              {refusalCopy(result.refusal_reason, lang)}
            </p>
            <p className="mt-2 font-mono text-[11px] text-rose-400">
              {t.reason}
              {result.refusal_reason}
            </p>
          </div>
        )}

        {result && (
          <>
            <StatsBar result={result} lang={lang} />
            <TracePanel trace={result.trace} lang={lang} />
            <MatchList matches={result.matches} citations={result.citations} lang={lang} />
          </>
        )}
      </div>

      <section className="mt-14 border-t border-slate-200 pt-8">
        <h2 className="text-lg font-semibold text-slate-900">
          {ja ? "誤った回答を減らす仕組み" : "How it is kept honest"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {ja
            ? "RAG で起こりやすい問題と、このデモでのそれぞれの対策です。"
            : "The weak points of a typical RAG knowledge base, and how this demo handles each one."}
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {POINTS[lang].map(([title, body]) => (
            <li key={title} className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="font-medium text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
            </li>
          ))}
        </ul>
        {ja ? (
          <p className="mt-6 text-sm text-slate-500">
            {"使用技術: Next.js（API の中継。AI サービスの API キーは持たない）、FastAPI、LangChain（検索）、LangGraph（エージェント）、Pinecone（サーバーレスのベクトルデータベース）、Gemini（埋め込みと回答の生成）。設定を変えるだけで、埋め込みは OpenAI、回答の生成は OpenAI や Anthropic にも切り替えられます。ソースコードと詳しい解説は "}
            <a
              href="https://github.com/a-yama100/phaiworks-rag-demo"
              className="text-teal-700 underline hover:text-teal-900"
            >
              GitHub
            </a>
            {" で公開しています。"}
          </p>
        ) : (
          <p className="mt-6 text-sm text-slate-500">
            Stack: Next.js proxy (no provider keys) · FastAPI · LangChain retrieval ·
            LangGraph agent · Pinecone serverless · Gemini embeddings and generation,
            swappable for OpenAI or Anthropic by config. The source code and a full
            write-up are on{" "}
            <a
              href="https://github.com/a-yama100/phaiworks-rag-demo"
              className="text-teal-700 underline hover:text-teal-900"
            >
              GitHub
            </a>
            .
          </p>
        )}
      </section>
    </div>
  );
}
