// Kept deliberately thin. Retrieval configuration — thresholds, top-k, model names —
// lives in the Python backend's app/settings.py and is fetched from /meta. Duplicating
// MIN_SCORE here would eventually leave the page describing a threshold the pipeline no
// longer uses, which is worse than not describing it at all.

// Where the Python backend lives, in priority order:
//   1. BACKEND_URL                     — set explicitly; a separately hosted backend, or
//                                        the co-deployed one addressed by its real domain
//   2. VERCEL_PROJECT_PRODUCTION_URL   — the project's production domain
//   3. localhost                       — development, uvicorn on 8000
//
// Note what is NOT used: VERCEL_URL. It resolves to the per-deployment *.vercel.app
// hostname, which Deployment Protection answers with a 302 to an auth page — so the
// proxy's own request to the backend gets redirected, `res.ok` is false, and every
// question comes back as "the retrieval service is unavailable" while the backend is
// healthy and directly reachable the whole time. Found in production; the health check
// passed and only the proxied path failed.
export const BACKEND_URL =
  process.env.BACKEND_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:8000");

// Matches API_PREFIX in api/rag/main.py. The Python function is the catch-all for the
// /api/* paths Next.js has not claimed, so its routes carry the full path.
export const BACKEND_PREFIX = "/api/py";

export const MAX_QUESTION_LEN = 200;

// Mirrors the schema enum in api/schema/biomarker.py. Duplicated because the select has
// to render before any request is made; the backend validates the value again anyway.
export const CATEGORIES = [
  "metabolic",
  "lipid",
  "thyroid",
  "inflammation",
  "liver",
  "kidney",
  "haematology",
  "vitamin_mineral",
  "hormone",
  "cardiac",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  metabolic: "Metabolic",
  lipid: "Lipid",
  thyroid: "Thyroid",
  inflammation: "Inflammation",
  liver: "Liver",
  kidney: "Kidney",
  haematology: "Haematology",
  vitamin_mineral: "Vitamin / Mineral",
  hormone: "Hormone",
  cardiac: "Cardiac",
};
