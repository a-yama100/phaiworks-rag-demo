import type { Metadata } from "next";
import { META, PATHS, SITE_URL, type Lang, type PageKey } from "@/lib/content";

// ページの題名・説明・正規の URL・言語の対応（hreflang）・SNS の情報
export function pageMetadata(lang: Lang, page: PageKey): Metadata {
  const m = META[lang][page];
  const url = SITE_URL + PATHS[lang][page];
  return {
    metadataBase: new URL(SITE_URL),
    title: m.title,
    description: m.description,
    robots: { index: true, follow: true },
    alternates: {
      canonical: url,
      languages: {
        ja: SITE_URL + PATHS.ja[page],
        en: SITE_URL + PATHS.en[page],
        "x-default": SITE_URL + PATHS.ja[page],
      },
    },
    openGraph: {
      type: "website",
      url,
      siteName: META[lang].siteName,
      locale: lang === "ja" ? "ja_JP" : "en_US",
      title: m.title,
      description: m.ogDescription,
    },
    icons: { icon: "/favicon.svg" },
  };
}
