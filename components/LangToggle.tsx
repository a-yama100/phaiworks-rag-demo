"use client";

import { usePathname } from "next/navigation";
import type { Lang } from "@/lib/content";

// 今のページの、もう一方の言語の同じパスへ移るリンク（/evals ⇔ /en/evals）
export function LangToggle({ lang, label }: { lang: Lang; label: string }) {
  const pathname = usePathname() || "/";
  const rest = lang === "en" ? pathname.replace(/^\/en(?=\/|$)/, "") || "/" : pathname;
  const href = lang === "ja" ? (rest === "/" ? "/en" : "/en" + rest) : rest;
  return (
    <a
      href={href}
      hrefLang={lang === "ja" ? "en" : "ja"}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 transition-colors"
    >
      {label}
    </a>
  );
}
