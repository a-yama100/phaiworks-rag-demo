import { NAV, type Lang } from "@/lib/content";

export function Footer({ lang }: { lang: Lang }) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-white mt-auto">
      <div className="max-w-4xl mx-auto px-4 py-8 text-center space-y-3">
        {lang === "ja" ? (
          <>
            <p className="text-amber-700 text-sm font-medium">
              このサイトは RAG の技術デモです。資料には説明用の参考値を使っており、医療の専門家の確認は受けていません。医療上の助言ではありません。医療機関や医療製品とは関係がありません。
            </p>
            <p className="text-slate-400 text-sm">
              {"ポートフォリオ用の開発デモ（制作: "}
              <a href={NAV.ja.home} className="hover:text-slate-700 underline">
                PH AI Works
              </a>
              {"） · "}
              {year}
            </p>
          </>
        ) : (
          <>
            <p className="text-amber-700 text-sm font-medium">
              Demonstration only. Uses illustrative reference data and is not medical
              advice. Not affiliated with any clinical provider or product.
            </p>
            <p className="text-slate-400 text-sm">
              A portfolio engineering demo by{" "}
              <a
                href="https://www.phaiworks.com/en"
                className="hover:text-slate-700 underline"
              >
                PH AI Works
              </a>{" "}
              · {year}
            </p>
          </>
        )}
      </div>
    </footer>
  );
}
