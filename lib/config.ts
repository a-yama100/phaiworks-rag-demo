// Kept deliberately thin. Retrieval configuration — thresholds, top-k, model names —
// lives in the Python backend's app/settings.py and is fetched from /meta. Duplicating
// MIN_SCORE here would eventually leave the page describing a threshold the pipeline no
// longer uses, which is worse than not describing it at all.

// Where the Python backend lives. Three cases, in priority order:
//   1. BACKEND_URL set        — a separately hosted backend (container, other project)
//   2. VERCEL_URL present     — co-deployed in this project as api/index.py, so the
//                               backend is this same deployment and needs no config
//   3. neither                — local development, uvicorn on 8000
export const BACKEND_URL =
  process.env.BACKEND_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:8000");

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
