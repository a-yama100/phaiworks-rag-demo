import type { MetadataRoute } from "next";
import { PATHS, SITE_URL, type PageKey } from "@/lib/content";

// 検索エンジン向けのページ一覧（/sitemap.xml）。日本語と英語を対にする
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: { key: PageKey; priority: number }[] = [
    { key: "home", priority: 1 },
    { key: "evals", priority: 0.5 },
  ];
  return pages.flatMap(({ key, priority }) => {
    const languages = {
      ja: SITE_URL + PATHS.ja[key],
      en: SITE_URL + PATHS.en[key],
      "x-default": SITE_URL + PATHS.ja[key],
    };
    return [
      { url: languages.ja, lastModified: new Date(), changeFrequency: "monthly" as const, priority, alternates: { languages } },
      { url: languages.en, lastModified: new Date(), changeFrequency: "monthly" as const, priority: Math.round(priority * 9) / 10, alternates: { languages } },
    ];
  });
}
