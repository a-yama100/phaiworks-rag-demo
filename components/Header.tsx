export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a
            href="https://www.phaiworks.com/"
            className="font-bold text-slate-900 hover:text-teal-600 transition-colors"
          >
            PH AI Works
          </a>
          <span className="text-xs font-semibold uppercase tracking-wide text-teal-700 bg-teal-50 border border-teal-200 rounded px-2 py-0.5">
            RAG Demo
          </span>
        </div>
        <a
          href="https://www.phaiworks.com/"
          className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          phaiworks.com
        </a>
      </div>
    </header>
  );
}
