# Clinical Knowledge Base — a RAG system that can say no

A working retrieval system over 52 schema-validated clinical briefs, built to demonstrate
the part of RAG that is actually hard: not getting an answer out, but knowing when the
answer should not be given.

**Live:** [rag-demo.phaiworks.com](https://rag-demo.phaiworks.com/) ·
**Evaluation:** [/evals](https://rag-demo.phaiworks.com/evals)

> **Demo data.** The briefs use illustrative UK reference values and are **not clinically
> validated**. In a real deployment the client's clinicians author and approve the
> content; this pipeline structures, validates, retrieves and serves it. Nothing here is
> medical advice, and the demo is not affiliated with any clinical provider.

---

## The problem this is about

A RAG demo that answers questions is easy. Every one of them looks impressive for the
first five queries, and then a user asks something just outside the corpus and it
confidently returns the nearest document as if it were the answer. In a domain with
clinical, legal or financial consequences, that single behaviour is the difference
between a system that ships and one that gets switched off.

So this repository is organised around three questions a reviewer can check rather than
take on trust:

1. **Can it find the right document** when the user does not use the document's words?
2. **Can it refuse** when the corpus does not cover the question?
3. **Can you prove either**, with a number and a failing-case list?

---

## Architecture

```
Browser
   │
   ▼
Next.js on Vercel ──────── holds NO provider keys
   /api/ask                rate limit · input validation · 30s timeout
   │
   │ HTTP
   ▼
FastAPI (api/) ─────────── holds OPENAI_API_KEY, PINECONE_API_KEY
   │
   └── LangGraph agent
         │
         ├─ retrieve ──┬── Pinecone dense vectors ─┐
         │             └── BM25 (in process) ──────┴─► reciprocal rank fusion
         │
         ├─ grade ───── cosine ≥ threshold?
         │                 ├── no, retries left ──► rewrite ──► back to retrieve
         │                 └── no, none left ─────► refuse
         │
         ├─ generate ── structured output with citations
         │                 └── cited ids ⊄ retrieved ids ──► refuse
         │
         └─ END
```

The frontend/backend split is not architectural decoration. The public deployment has no
API key in its environment, so there is nothing for a frontend bug, a mis-scoped
environment variable or a leaked build log to expose, and rotating a provider key never
touches the site.

---

## Design decisions, and what each one costs

### Hybrid retrieval, fused by rank rather than score

Dense embeddings handle *"I'm always tired and think my iron is low"* — no word in that
sentence appears in the Ferritin brief. BM25 handles the opposite failure: a user types
`GGT` and cosine similarity buries it under four other liver enzymes that are all
semantically about the liver. Neither retriever covers both cases.

They are combined with reciprocal rank fusion — `score = Σ 1/(k + rank)` — rather than a
weighted blend of their raw scores. A cosine similarity and a BM25 score are not on
comparable scales, so blending them directly requires a magic weight that has to be
re-tuned every time the corpus changes. RRF only needs the ordering.

**The cost:** RRF output is a rank artefact with no absolute meaning, so it cannot answer
*"is anything here actually relevant?"*. The refusal decision therefore still runs on the
raw cosine score of the best dense hit, never on the fused score — see
`best_dense_score()` in [`api/app/retrieval.py`](api/app/retrieval.py) and the test that
pins this behaviour.

### BM25 written directly on `rank_bm25`

`langchain_community.retrievers.BM25Retriever` was the obvious choice and was used first.
It was replaced for two reasons: `langchain-community` is being sunset, and that
retriever has no metadata filter — you rank the whole corpus and discard afterwards,
which means asking for *k* documents silently returns fewer than *k* once the filter
runs. [`api/app/bm25.py`](api/app/bm25.py) filters first, so `k` means what it says.

The tokenizer is deliberately not the default one: it keeps `hba1c` as a single token
instead of splitting it into `hba`, `1`, `c`. Biomarker names are full of digits, and
splitting them is precisely what makes exact-name queries miss.

### Citations checked, not trusted

The model writes the answer, then two mechanical checks decide whether anyone sees it:

- Every `source_brief_id` it cites must be one that was actually retrieved for this
  question. This is set membership against the retrieval result — the model cannot
  influence it. A cited id that was never retrieved is a hallucination, and it becomes a
  *detectable event* rather than a plausible-looking paragraph.
- It must mark the evidence sufficient. The prompt makes *"the briefs do not cover this"*
  the cheap, rewarded answer rather than a failure state.

**The cost:** this is stricter than most users want. A question the corpus half-covers
gets a partial answer plus an explicit "not covered" note, where a laxer system would
produce something smoother. That trade is the point.

### An agent, because there is a cycle

A question that retrieves nothing useful has its wording rewritten into clinical
vocabulary and is tried again, and only refuses if that also fails. Two different nodes —
weak retrieval, and a model that will not stand behind an answer — can both send the flow
back to that same rewrite step, and they share one retry budget.

That is a state machine, and expressing it as a linear chain means hiding the loop inside
an `if` and losing the per-node trace. The trace is not a debug feature here; it is what
the demo page renders, because *why* a question was refused is the interesting part.

The rewrite prompt has one guard worth noting: if the question is not about blood tests
at all, it returns it unchanged. Rewriting an off-topic question into on-topic vocabulary
would manufacture a false match — the retry would defeat the refusal it exists to avoid.

### Grading with a threshold, not an LLM judge

An LLM relevance grader was tried and removed. It cost a round trip, added run-to-run
variance, and scored worse on the gold set: asked whether a loosely-related brief was
relevant, the model talked itself into yes. The cosine score is already a calibrated
number, and the threshold that uses it is justified by a published sweep rather than
chosen because it looked reasonable.

---

## Evaluation

The gold set is 60 cases in [`api/eval/gold.yaml`](api/eval/gold.yaml), each tagged by the
failure it is designed to catch, so a regression tells you *which* part broke:

| tag | n | what it tests |
|---|---|---|
| `lay` | 16 | user describes a symptom and never names the marker — dense should win |
| `exact` | 12 | user types the name or abbreviation — BM25 should win |
| `confusable` | 20 | several briefs are plausible, one is right — the hard set |
| `oos` | 12 | out of scope; the correct behaviour is to refuse |

The out-of-scope cases are half the reason the harness exists. A system measured only on
recall answers every question and scores brilliantly while being unusable; reporting
retrieval accuracy without refusal accuracy hides which of the two possible mistakes the
system is making.

The `confusable` set is built from clusters where a plain semantic search has no chance of
discriminating: LDL / HDL / non-HDL / total cholesterol, TSH / free T3 / free T4,
ferritin / serum iron / transferrin saturation, ALT / AST / ALP / GGT.

```bash
cd api
python eval/run_eval.py --sweep              # retrieval metrics, both modes
python eval/run_eval.py --with-generation    # also scores citations (costs LLM calls)
```

This writes `public/eval-results.json`, which [/evals](https://rag-demo.phaiworks.com/evals)
renders — including the remaining failures, published rather than trimmed. A gold set with
no failures left has usually been edited to match the system rather than the other way
round.

> **Status:** the harness, the gold set and the page are complete; the numbers have not
> been measured yet, because that requires an OpenAI key and a populated Pinecone index.
> The page shows an explicit "not run" state rather than seeded example numbers. A
> published metric that nobody measured is worse than no metric.

### Tests that need no keys

The parts that fail *silently* are covered offline — a broken RRF still returns plausible
documents, and a broken citation check still returns a fluent answer:

```bash
cd api
.venv/Scripts/python.exe -m pytest tests -q     # 21 passing
```

Covered: the schema validation gate, vector-id collisions, `content_hash` stability,
governance fields staying out of the vector, the tokenizer, BM25 filter ordering, RRF
arithmetic, citation rejection and acceptance, and every branch of the graph's routing.

---

## Running it

```bash
# backend
cd api
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env                  # OPENAI_API_KEY + PINECONE_API_KEY
python ingest.py --dry-run            # validate the corpus, no keys or network needed
python ingest.py                      # create the index, embed, upsert
uvicorn app.main:app --port 8000

# frontend, in another shell
npm install
cp .env.example .env.local            # BACKEND_URL=http://localhost:8000
npm run dev
```

`ingest.py` is idempotent. Vector ids are a deterministic hash of the source brief, so
re-running upserts in place instead of duplicating, and a `content_hash` comparison skips
unchanged entries — editing one brief costs one embedding call, not 52.

---

## Repository map

| Path | Role |
|---|---|
| `api/schema/biomarker.py` | The schema. Validation, deterministic ids, `embedding_text`, metadata |
| `api/app/corpus.py` | Loading and the validation gate; fails with the offending filename |
| `api/app/retrieval.py` | Dense + BM25 + reciprocal rank fusion |
| `api/app/bm25.py` | BM25 on `rank_bm25`, filtering before ranking |
| `api/app/graph.py` | The LangGraph state machine |
| `api/app/generate.py` | Citation-enforced generation |
| `api/app/cost.py` | Per-query cost, computed rather than described |
| `api/app/settings.py` | Every tunable knob, in one place |
| `api/ingest.py` | Validate → embed → idempotent upsert |
| `api/eval/` | Gold set and the evaluation harness |
| `api/tests/` | Offline test suite |
| `data/*.json` | 52 briefs across 10 categories |
| `app/`, `components/`, `lib/` | Next.js frontend: proxy, trace panel, evals page |

There is exactly one implementation of the pipeline. An earlier version had a second copy
of ingest in JavaScript so the Next.js app could populate the index itself, which meant
`embedding_text()` and `answer_text()` existed twice in two languages — and the JS copy
had already drifted from the Python one. The schema now defines them once and everything
else calls it.

---

## Stack

Next.js 16 · FastAPI · LangChain · LangGraph · Pinecone serverless · OpenAI
`text-embedding-3-small` + `gpt-4o-mini` · Pydantic · pytest

Built by [PH AI Works](https://www.phaiworks.com/).
