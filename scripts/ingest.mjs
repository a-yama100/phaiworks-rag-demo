// One-time ingest for the public demo. Uses Pinecone integrated inference:
// Pinecone embeds the text server-side, so this script needs only PINECONE_API_KEY
// (no OpenAI). Run with:  npm run ingest
//
// It reads the briefs in data/*.json, creates the integrated index if it does not
// exist, and upserts one text record per brief. Vector ids are deterministic, so
// re-running upserts in place instead of duplicating.

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pinecone } from "@pinecone-database/pinecone";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

// Keep these in sync with lib/config.ts.
const INDEX = process.env.PINECONE_INDEX || "clinical-kb";
const NAMESPACE = "kb";
const TEXT_FIELD = "chunk_text";
const MODEL = "llama-text-embed-v2";
const CLOUD = "aws";
const REGION = "us-east-1";

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function vectorId(b) {
  const basis = `${slug(b.source_brief_id)}::${slug(b.biomarker_name)}`;
  const digest = createHash("md5").update(basis, "utf8").digest("hex").slice(0, 12);
  return `bm-${slug(b.biomarker_name)}-${digest}`;
}

// The ONLY text Pinecone embeds: semantic content, no governance fields.
function embeddingText(b) {
  const parts = [
    `Biomarker: ${b.biomarker_name}`,
    b.aliases?.length ? `Also known as: ${b.aliases.join(", ")}` : "",
    `Category: ${b.category}`,
    b.keywords?.length ? `Keywords: ${b.keywords.join(", ")}` : "",
    `What it measures: ${b.what_it_measures}`,
    `Summary: ${b.summary}`,
  ];
  for (const i of b.interpretations ?? []) {
    parts.push(`When ${i.direction}: ${i.meaning}`);
  }
  if (b.when_to_seek_help) parts.push(`When to seek help: ${b.when_to_seek_help}`);
  return parts.filter(Boolean).join("\n");
}

// Pre-rendered, citation-ready answer returned verbatim at query time.
function answerText(b) {
  const lines = [`${b.biomarker_name} (${b.category})`, "", b.summary, ""];
  lines.push("Reference ranges:");
  for (const r of b.reference_ranges ?? []) {
    const bound = [];
    if (r.low != null) bound.push(`>= ${r.low}`);
    if (r.high != null) bound.push(`<= ${r.high}`);
    const ctx = [];
    if (r.sex && r.sex !== "any") ctx.push(r.sex);
    if (r.note) ctx.push(r.note);
    const ctxS = ctx.length ? ` (${ctx.join(", ")})` : "";
    lines.push(`  - ${bound.join(" and ") || "see note"} ${r.unit}${ctxS}`);
  }
  for (const i of b.interpretations ?? []) {
    lines.push("");
    lines.push(`If ${i.direction}: ${i.meaning}`);
    if (i.common_causes?.length) lines.push(`  Common causes: ${i.common_causes.join(", ")}`);
    if (i.typical_next_steps?.length)
      lines.push(`  Typical next steps: ${i.typical_next_steps.join(", ")}`);
  }
  if (b.when_to_seek_help) lines.push("", `When to seek help: ${b.when_to_seek_help}`);
  return lines.join("\n");
}

function toRecord(b) {
  return {
    id: vectorId(b),
    [TEXT_FIELD]: embeddingText(b),
    biomarker_name: b.biomarker_name,
    category: b.category,
    status: b.status,
    language: b.language,
    region: b.region,
    source_brief_id: b.source_brief_id,
    schema_version: b.schema_version,
    keywords: b.keywords ?? [],
    aliases: b.aliases ?? [],
    answer_text: answerText(b),
  };
}

async function main() {
  if (!process.env.PINECONE_API_KEY) {
    console.error("PINECONE_API_KEY is not set. Run via `npm run ingest` (loads .env.local).");
    process.exit(1);
  }

  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  const briefs = files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")));
  console.log(`Loaded ${briefs.length} brief(s): ${briefs.map((b) => b.biomarker_name).join(", ")}`);

  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

  const { indexes = [] } = await pc.listIndexes();
  if (!indexes.some((i) => i.name === INDEX)) {
    console.log(`Creating integrated index "${INDEX}" (${MODEL}, cosine)…`);
    await pc.createIndexForModel({
      name: INDEX,
      cloud: CLOUD,
      region: REGION,
      embed: { model: MODEL, metric: "cosine", fieldMap: { text: TEXT_FIELD } },
      waitUntilReady: true,
    });
  } else {
    console.log(`Index "${INDEX}" already exists.`);
  }

  const ns = pc.index(INDEX).namespace(NAMESPACE);
  const records = briefs.map(toRecord);
  await ns.upsertRecords(records);
  console.log(`Upserted ${records.length} record(s) into namespace "${NAMESPACE}".`);
  console.log("Done. (Indexing may take a few seconds to become searchable.)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
