import type { MetadataRoute } from "next";

// 検索エンジン向けのページ一覧（/sitemap.xml）
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://rag-demo.phaiworks.com/", lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
    { url: "https://rag-demo.phaiworks.com/evals", lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
  ];
}
