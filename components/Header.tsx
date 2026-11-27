import { NAV, PATHS, type Lang } from "@/lib/content";
import { LangToggle } from "./LangToggle";

export function Header({ lang }: { lang: Lang }) {
  const t = NAV[lang];
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <a
            href={t.home}
            className="shrink-0 font-bold text-slate-900 hover:text-teal-600 transition-colors"
          >
            PH AI Works
          </a>
          <span className="hidden min-[420px]:block truncate text-xs font-semibold uppercase tracking-wide text-teal-700 bg-teal-50 border border-teal-200 rounded px-2 py-0.5">
            {t.badge}
          </span>
        </div>
        <nav className="flex shrink-0 items-center gap-3 sm:gap-4 text-sm">
          <a href={PATHS[lang].home} className="hidden sm:inline text-slate-500 hover:text-slate-900 transition-colors">
            {t.demo}
          </a>
          <a href={PATHS[lang].evals} className="text-slate-500 hover:text-slate-900 transition-colors">
            {t.evals}
          </a>
          <a
            href={t.home}
            className="hidden sm:inline text-slate-400 hover:text-slate-900 transition-colors"
          >
            phaiworks.com
          </a>
          <LangToggle lang={lang} label={t.toggle} />
        </nav>
      </div>
    </header>
  );
}
