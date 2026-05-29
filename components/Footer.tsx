export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-white mt-auto">
      <div className="max-w-4xl mx-auto px-4 py-8 text-center space-y-3">
        <p className="text-amber-700 text-sm font-medium">
          Demonstration only. Uses illustrative reference data and is not medical
          advice. Not affiliated with any clinical provider or product.
        </p>
        <p className="text-slate-400 text-sm">
          A portfolio engineering demo by{" "}
          <a
            href="https://www.phaiworks.com/"
            className="hover:text-slate-700 underline"
          >
            PH AI Works
          </a>{" "}
          · {year}
        </p>
      </div>
    </footer>
  );
}
