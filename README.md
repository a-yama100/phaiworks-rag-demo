# rag-demo — Clinical Knowledge Base RAG Retrieval Demo

A public, read-only demo of a strict-schema RAG retrieval pipeline, deployed as a
subdomain of phaiworks.com (e.g. `rag-demo.phaiworks.com`). It is a portfolio piece
showing disciplined data structuring + Pinecone + OpenAI embeddings.

**Deliberately neutral branding.** This demo is generic ("Clinical Knowledge Base")
and is not named after, or affiliated with, any client or product.

## What it does

- User asks a question → **Pinecone integrated inference** embeds it server-side
  with the index's hosted model (`llama-text-embed-v2`).
- Pinecone query with a **hard metadata filter** (`status=clinically_approved`,
  `language=en-GB`, optional `category`) before vector similarity.
- Returns the **verbatim approved `answer_text`** from matching entries. No LLM
  generates the response, so it cannot invent medical claims.
- Matches below `MIN_SCORE` are dropped → the assistant declines instead of guessing.

## Why no OpenAI key

Embeddings are produced by Pinecone's hosted model (integrated inference), at both
ingest and query time. The public endpoint therefore needs **only a Pinecone key** —
there is no OpenAI key to leak, budget-cap, or rotate.

## Security / cost model (read before going public)

- Retrieval is **embeddings-only** (no chat/generation), so cost per query is a
  fraction of a cent.
- Per-IP rate limiting is in `lib/ratelimit.ts` (best-effort; per-instance on
  serverless). Input is length-capped (200 chars) and category is validated against
  a fixed allow-list. Only the read endpoint is exposed — there is no public ingest.

## Environment variables

Copy `.env.example` to `.env.local` (local) or set in Vercel project settings:

| Var | Notes |
|---|---|
| `PINECONE_API_KEY` | The only secret this app needs |
| `PINECONE_INDEX` | Integrated-inference index (default `clinical-kb`); created by `npm run ingest` |
| `MIN_SCORE` | Similarity threshold below which results are dropped (default `0.05`) |

## Populate the index

Ingest is self-contained — it lives in this project and also uses integrated
inference (no OpenAI). It creates the index if it doesn't exist, then upserts the
briefs in `data/*.json`:

```powershell
npm run ingest     # reads .env.local for PINECONE_API_KEY
```

## Local dev

```powershell
npm install
npm run ingest     # one-time: create + populate the index
npm run dev        # http://localhost:3000
```

## Deploy (Vercel + subdomain)

1. `git init` here and push to a new repo (this folder is its own project, like the
   other apps under `D:\サイト管理\PHAIWorks`).
2. Import the repo into Vercel as a new project.
3. Add the env vars above in **Settings → Environment Variables**.
4. **Settings → Domains → Add** `rag-demo.phaiworks.com`. Vercel shows the DNS record
   (a CNAME to `cname.vercel-dns.com`) to add at your DNS provider for `phaiworks.com`.
5. Redeploy. The demo is live at the subdomain.

## Structure

| Path | Role |
|---|---|
| `app/page.tsx` | Demo UI (search, examples, results, engineering notes) |
| `app/api/ask/route.ts` | Read-only retrieval endpoint (validate → filtered text search) |
| `scripts/ingest.mjs` | One-time ingest: create index + upsert `data/*.json` (integrated inference) |
| `data/*.json` | The 5 clinically-structured biomarker briefs |
| `lib/clients.ts` | Pinecone singleton + namespace handle |
| `lib/ratelimit.ts` | Best-effort per-IP throttle |
| `lib/config.ts` | Categories, thresholds, model + index names |
