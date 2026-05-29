export const EMBED_MODEL = "text-embedding-3-small";
export const MAX_QUESTION_LEN = 200;
export const TOP_K = 3;

// Cosine score below which we return "no approved answer" instead of guessing.
export const MIN_SCORE = Number(process.env.MIN_SCORE ?? 0.33);

export const PINECONE_INDEX = process.env.PINECONE_INDEX || "clinical-kb-demo";

// Controlled vocabulary, mirrors the ingestion schema (schema/biomarker.py).
export const CATEGORIES: string[] = [
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
];
