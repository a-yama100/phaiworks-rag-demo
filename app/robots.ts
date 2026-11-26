import type { MetadataRoute } from "next";

// /robots.txt。サイトマップの場所を検索エンジンに知らせる
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://rag-demo.phaiworks.com/sitemap.xml",
  };
}
