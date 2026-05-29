# rag-demo — Clinical Knowledge Base RAG Retrieval Demo

A public, read-only demo of a strict-schema RAG retrieval pipeline, deployed as a
subdomain of phaiworks.com (e.g. `rag-demo.phaiworks.com`). It is a portfolio piece
showing disciplined data structuring + Pinecone + OpenAI embeddings.

**Deliberately neutral branding.** This demo is generic ("Clinical Knowledge Base")
and is not named after, or affiliated with, any client or product.

## What it does

- User asks a question → embedded with OpenAI `text-embedding-3-small`.
- Pinecone query with a **hard metadata filter** (`status=clinically_approved`,
  `language=en-GB`, optional `category`) before vector similarity.
- Returns the **verbatim approved `answer_text`** from matching entries. No LLM
  generates the response, so it cannot invent medical claims.
- Matches below `MIN_SCORE` are dropped → the assistant declines instead of guessing.

## Security / cost model (read before going public)

- **Use a dedicated OpenAI key with a hard monthly budget cap** for this public
  endpoint — not your main key. Set the cap in the OpenAI dashboard.
- Retrieval is **embeddings-only** (no chat/generation), so cost per query is a
  fraction of a cent.
- Per-IP rate limiting is in `lib/ratelimit.ts` (best-effort; per-instance on
  serverless). Input is length-capped (200 chars) and category is validated against
  a fixed allow-list. Only the read endpoint is exposed — there is no public ingest.

## Environment variables

Copy `.env.example` to `.env.local` (local) or set in Vercel project settings:

| Var | Notes |
|---|---|
| `OPENAI_API_KEY` | Dedicated, budget-capped key |
| `PINECONE_API_KEY` | |
| `PINECONE_INDEX` | Must already be populated (default `clinical-kb-demo`) |
| `MIN_SCORE` | Cosine threshold, default `0.33` |

## Populate the index

This app is read-only; it does not ingest. Populate the index from the Python
ingestion project (`D:\作業用\vera-rag-demo`) into a neutrally-named index:

```powershell
cd D:\作業用\vera-rag-demo
.venv\Scripts\activate
$env:PINECONE_INDEX = "clinical-kb-demo"
python ingest.py
```

(You can delete the older `vera-knowledge` index in the Pinecone console once this
neutrally-named one is populated.)

## Local dev

```powershell
npm install
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
| `app/api/ask/route.ts` | Read-only retrieval endpoint (validate → embed → filtered query) |
| `lib/clients.ts` | OpenAI + Pinecone singletons |
| `lib/ratelimit.ts` | Best-effort per-IP throttle |
| `lib/config.ts` | Categories, thresholds, model name |
