// 日本語（/・/evals）と英語（/en・/en/evals）の文の置き場所。ページの題名・説明・h1 はここにまとめる。
export type Lang = "ja" | "en";
export type PageKey = "home" | "evals";

export const SITE_URL = "https://rag-demo.phaiworks.com";

export function asLang(v: unknown): Lang {
  return v === "ja" ? "ja" : "en";
}

// 言語ごとのページのパス
export const PATHS: Record<Lang, Record<PageKey, string>> = {
  ja: { home: "/", evals: "/evals" },
  en: { home: "/en", evals: "/en/evals" },
};

// h1（ページの見出し）。仮の案。差し替えるときはここだけを直す
export const H1: Record<Lang, Record<PageKey, string>> = {
  ja: { home: "血液検査を題材にした RAG デモ", evals: "検索精度と回答見送りの評価" },
  en: { home: "Clinical Knowledge Base — RAG Demo", evals: "Evaluation" },
};

export const META: Record<Lang, { siteName: string } & Record<PageKey, { title: string; description: string; ogDescription: string }>> = {
  ja: {
    siteName: "PH AI Works — RAG デモ",
    home: {
      title: "血液検査を題材にした RAG デモ | 出典の確認と回答の見送り",
      description:
        "血液検査の52件の資料を、Pinecone のベクトル検索で探す RAG のデモです。LangGraph のエージェントが、必要なときに質問を書き換えて再検索し、回答に引用した資料が検索結果にあるかを確かめます。処理の記録と、ハイブリッド検索（ベクトル検索と BM25 の組み合わせ）と比べた評価の結果も公開しています。",
      ogDescription:
        "ベクトル検索と LangGraph のエージェントを使った RAG のデモです。質問を書き換えて再検索し、回答の出典を検索結果と照合します。評価の結果も公開しています。",
    },
    evals: {
      title: "検索精度と回答見送りの評価 | 血液検査を題材にした RAG デモ",
      description:
        "60件のテスト用の質問で、ベクトル検索とハイブリッド検索を比べた結果です。質問ごとに、見つけるべき資料か、回答を見送るべきかを決めてあります。失敗した質問の一覧と、しきい値ごとの結果も載せています。",
      ogDescription:
        "60件のテスト用の質問で、検索の精度と回答の見送りを評価した結果です。失敗した質問の一覧も公開しています。",
    },
  },
  en: {
    siteName: "PH AI Works — RAG Demo",
    home: {
      title: "Clinical Knowledge Base — RAG Demo",
      description:
        "Dense vector retrieval (Pinecone) over schema-validated biomarker briefs, wrapped in a LangGraph agent that rewrites and retries, checks every citation against what was retrieved, and shows its trace. Includes published eval numbers comparing dense and hybrid (dense + BM25) retrieval.",
      ogDescription:
        "Dense vector retrieval, a LangGraph rewrite-and-retry agent, and answers whose citations are checked against what was retrieved. Eval numbers published.",
    },
    evals: {
      title: "Evaluation — Clinical Knowledge Base RAG Demo",
      description:
        "Measured retrieval quality for the demo: dense-only vs hybrid on a 60-case gold set, with the failure list and the threshold sweep.",
      ogDescription:
        "Measured retrieval quality for the demo: dense-only vs hybrid on a 60-case gold set, with the failure list and the threshold sweep.",
    },
  },
};

export const NAV: Record<Lang, { home: string; badge: string; demo: string; evals: string; toggle: string }> = {
  ja: { home: "https://www.phaiworks.com", badge: "RAG デモ", demo: "デモ", evals: "評価", toggle: "English" },
  en: { home: "https://www.phaiworks.com/en", badge: "RAG Demo", demo: "Demo", evals: "Evaluation", toggle: "日本語" },
};

// 分類の表示名（値は API に渡すコードのまま）
export const CATEGORY_LABELS_JA: Record<string, string> = {
  metabolic: "代謝",
  lipid: "脂質",
  thyroid: "甲状腺",
  inflammation: "炎症",
  liver: "肝臓",
  kidney: "腎臓",
  haematology: "血液",
  vitamin_mineral: "ビタミンとミネラル",
  hormone: "ホルモン",
  cardiac: "心臓",
};

// API の誤りの文
export const API_ERRORS: Record<
  Lang,
  {
    tooMany: string;
    invalid: string;
    empty: string;
    tooLong: (max: number) => string;
    unavailable: string;
    timeout: string;
    unreachable: string;
  }
> = {
  ja: {
    tooMany: "短時間に送れる質問の回数を超えました。少し時間をおいて、もう一度お試しください。",
    invalid: "リクエストの形式が正しくありません。",
    empty: "質問を入力してください。",
    tooLong: (max) => `質問が長すぎます（${max}文字まで）。`,
    unavailable: "検索サービスを利用できません。少し時間をおいて、もう一度お試しください。",
    timeout: "処理が制限時間内に終わりませんでした。もう一度お試しください。",
    unreachable: "検索サービスに接続できませんでした。",
  },
  en: {
    tooMany: "Too many requests. Please slow down and try again shortly.",
    invalid: "Invalid request.",
    empty: "Please enter a question.",
    tooLong: (max) => `Question too long (max ${max} characters).`,
    unavailable: "The retrieval service is unavailable. Please try again shortly.",
    timeout: "The request took too long. Please try again.",
    unreachable: "Could not reach the retrieval service.",
  },
};
