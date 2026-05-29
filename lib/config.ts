// Pinecone integrated inference: Pinecone hosts the embedding model and embeds both
// the ingested briefs and the user's question server-side. This app therefore needs
// only PINECONE_API_KEY at runtime — no OpenAI key on the public endpoint.
export const PINECONE_EMBED_MODEL = "llama-text-embed-v2";
export const EMBED_TEXT_FIELD = "chunk_text";
export const PINECONE_NAMESPACE = "kb";

export const MAX_QUESTION_LEN = 200;
export const TOP_K = 3;

// Similarity score below which we return "no approved answer" instead of guessing.
// Tuned against the hosted model so off-topic questions fall below it.
export const MIN_SCORE = Number(process.env.MIN_SCORE ?? 0.35);

export const PINECONE_INDEX = process.env.PINECONE_INDEX || "clinical-kb";

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
