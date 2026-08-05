# Clinical Knowledge Base — a RAG system that can say no

A working retrieval system over 52 schema-validated clinical briefs, built to demonstrate
the part of RAG that is actually hard: not getting an answer out, but knowing when the
answer should not be given.

Measured on a 60-case gold set: **96%** top-1 retrieval, **100%** recall@5, and **100%**
of out-of-scope questions refused end to end — with **zero** hallucinated citations. The
numbers, the method and the remaining failures are all on [/evals](https://rag-demo.phaiworks.com/evals).

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
FastAPI (api/) ─────────── holds PINECONE_API_KEY + the provider key
   │
   └── LangGraph agent
         │
         ├─ retrieve ───── Pinecone dense vectors
         │                 (BM25 + RRF fusion implemented, measured, off by default)
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

### Hybrid retrieval — built, measured, and then switched off

This started as a hybrid system, for the reason everyone builds one. Dense embeddings
handle *"I'm always tired and think my iron is low"* — no word in that sentence appears in
the Ferritin brief. BM25 is supposed to cover the opposite failure: a user types `GGT` and
cosine similarity buries it under four other liver enzymes that are all semantically about
the liver.

The two runs are fused with reciprocal rank fusion — `score = Σ w/(k + rank)` — rather than
a weighted blend of raw scores, because a cosine similarity and a BM25 score are not on
comparable scales and blending them needs a constant that must be re-tuned whenever the
corpus changes. RRF only needs the ordering.

Then it was measured, and it lost:

| BM25 weight | top-1 | MRR |
|---|---|---|
| dense only | **96%** | **0.979** |
| 0.1 | 96% | 0.979 |
| 0.2 | 94% | 0.969 |
| 0.4 | 90% | 0.944 |
| 1.0 (equal weighting) | 90% | 0.938 |

Monotonic. The premise was wrong for this corpus: exact-name queries score **12/12 on
dense alone**, because a 3072-dimension embedding has no difficulty with `GGT` or `A1c`.
What BM25 contributes instead is noise — it latches onto a domain word many briefs share
and floats all of them at once. *"Muscle aches since starting my cholesterol tablets"*
retrieves Creatine Kinase correctly on dense, and drops to rank 4 under equal-weighted
fusion because three cholesterol briefs match the word "cholesterol".

The hybrid path is still in the code and the eval still scores it, so this stays a
measurement rather than a belief — flip `RETRIEVAL_MODE=hybrid` and it comes back. The
demo page exposes the same toggle.

**The cost of keeping RRF available:** its output is a rank artefact with no absolute
meaning, so it cannot answer *"is anything here actually relevant?"*. The refusal decision
therefore runs on the raw cosine score of the best dense hit, never on the fused score —
see `best_dense_score()` in [`api/app/retrieval.py`](api/app/retrieval.py) and the test
that pins it.

### BM25 written directly on `rank_bm25`

(Still relevant even though BM25 is off by default: the eval that retired it had to be
measuring a correct implementation, or the conclusion would have been about the bug.)

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

### Providers are configuration, not imports

Embeddings and generation are each chosen by an environment variable —
`EMBED_PROVIDER` (google, openai) and `CHAT_PROVIDER` (google, openai, anthropic) — and
the provider package is imported inside the branch that uses it, so the unused ones are
never loaded. Both halves move independently, which is what lets embeddings come from one
vendor and generation from another when the pricing or the model quality warrants it.

This is the claim LangChain is usually bought for and rarely tested against. It is tested
here: the pipeline was built on OpenAI and moved to Gemini, and the change was two
functions plus a new index. The citation contract survived the move intact, because
`with_structured_output` is supported by all three.

**The cost:** the embedding dimension is part of the choice — `gemini-embedding-001`
returns 3072 dimensions and `text-embedding-3-small` returns 1536 — so switching
embedding providers means building a **new** Pinecone index, not re-ingesting into the
existing one. The index name encodes the model for that reason.

### Grading with a threshold, not an LLM judge

Relevance is decided by a score threshold rather than by asking a model whether the
retrieved briefs are relevant. An LLM judge costs an extra round trip on every query and
introduces run-to-run variance into the one decision that most needs to be stable, and
the cosine score it would be second-guessing is already a calibrated number.

The threshold itself is not a guess: `run_eval.py --sweep` replays the recorded scores at
a range of values and reports what each one costs in answers refused and out-of-scope
questions let through, so the chosen value comes off that curve. Swapping in an LLM judge
and measuring it against the same gold set would be the honest way to overturn this
decision — the harness is there for it.

---

## Consistency controls

Consistency is enforced by the pipeline, not by hoping the people writing the content are
careful. Each row is a way a knowledge base rots in production, and where this repository
stops it:

| Risk | Control |
|---|---|
| Inconsistent fields, free-text categories | One Pydantic schema with enums (`api/schema/biomarker.py`). Nothing is embedded unless it validates, and failure names the file. |
| Duplicate or conflicting entries | Vector id is a deterministic hash of the source brief. Re-ingest upserts; it cannot duplicate. |
| Paying to re-embed unchanged content | `content_hash` is compared against the index and unchanged entries are skipped. Editing one brief costs one embedding call, not 52. |
| Unapproved content reaching users | Only `status=clinically_approved` is retrievable. Drafts and deprecated entries are excluded by the filter, on both the vector and keyword sides. |
| Wrong-context retrieval | Hard metadata filter on status, language and optional category runs *before* similarity, so off-category briefs are never candidates. |
| Similarity polluted by metadata | `embedding_text()` vectorises semantic content only; governance fields stay out of the vector. A test asserts they are absent. |
| Hallucinated sources | Cited `source_brief_id`s are checked for membership in the retrieval result. A cited id that was not retrieved discards the answer. |
| Confident answers to uncovered questions | A calibrated score threshold plus an explicit decline path, both scored separately in the eval. |
| Audit and GDPR traceability | Every entry carries `source_brief_id`, `approved_by`, `approval_date` and `schema_version`. An approved entry without a named approver fails validation. |

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
python eval/run_eval.py --sweep --sweep-weights   # retrieval, both modes, both sweeps
python eval/run_eval.py --with-generation         # end to end (costs LLM calls)
```

Every case is retrieved once; modes, fusion weights and thresholds are then all scored
from that cache. A sweep across nine weights costs one embedding call per case, and every
configuration is compared against byte-identical candidates, so a difference between them
is the fusion rather than retrieval jitter.

### Results

| | dense (shipped) | hybrid (w=1.0) |
|---|---|---|
| top-1 | **96%** | 90% |
| recall@5 | **100%** | 100% |
| MRR | **0.979** | 0.938 |
| refusal, retrieval stage | 75% | 75% |
| median latency | 680 ms | 680 ms |

End to end through the agent, on `gemini-2.5-flash`:

| | |
|---|---|
| out-of-scope refused | **100%** |
| in-scope answered | 94% |
| answer cited the expected brief | 94% |
| hallucinated citations | **0** |

By case type, dense: lay wording 16/16, exact names 12/12, confusable clusters 18/20,
out-of-scope 9/12 at the retrieval stage.

### Two refusal mechanisms, because one is not enough

The retrieval threshold refuses only 75% of the out-of-scope set, and it cannot do
better. The three it lets through are *"do I have diabetes, just tell me yes or no"*
(0.701), *"what dose of levothyroxine should I take"* (0.686) and *"which brand of vitamin
D supplement should I buy"* (0.680). Those are squarely on topic — HbA1c, TSH and Vitamin D
really are the right briefs. A cosine score has no way to separate a legitimate question
about a biomarker from a request for a diagnosis, a drug dose or a product recommendation.

The generation stage does, and catches all three, which is how the end-to-end figure
reaches 100%. That is the argument for keeping a model in the loop at all in a system
otherwise designed to distrust it.

### The threshold was wrong, and the eval is what said so

`MIN_SCORE` was 0.35, inherited from a different embedding model. `gemini-embedding-001`
scores *"what is the capital of Australia"* against this corpus at **0.51** — its floor is
far above where the threshold sat, so the first run refused precisely nothing and reported
0% refusal accuracy. That reads like a code bug and was not one.

The sweep now derives its range from the observed scores rather than a hardcoded window,
and 0.655 is the middle of the 0.648–0.663 plateau where combined accuracy peaks, rather
than an edge of it.

### What still fails

Two confusable cases, published rather than trimmed — a gold set with no failures left has
usually been edited to fit the system:

- `conf-05` *"which liver enzyme tells me whether a high ALP is bone or liver"* returns ALP
  first, GGT second. The question is **about** ALP, so ALP is the strongest embedding
  match; the answer is GGT.
- `conf-10` *"the iron test that is not thrown off by inflammation"* returns Serum Iron
  first, Transferrin Saturation second — for the same reason.

Both are recovered downstream: recall@5 is 100%, the model reads all five briefs, and in
both cases it cites the correct one. Top-1 accuracy understates a system that does not
only use the top hit.

Three in-scope cases are counted as misses end to end and arguably should not be:
*"am I prediabetic"*, *"is my thyroid underactive"* and *"my periods have stopped and I get
hot flushes"* all retrieve the right brief and are then declined, because they ask for a
personal diagnosis. The gold set labels retrieval; declining to diagnose is a separate rule
and the right behaviour. The label was left alone rather than moved to flatter the score.

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
cp .env.example .env                  # PINECONE_API_KEY + one provider key
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

Next.js 16 · FastAPI · LangChain · LangGraph · Pinecone serverless · Pydantic · pytest

Providers are swappable. The deployed configuration is Gemini
(`gemini-embedding-001` + `gemini-2.5-flash`); OpenAI (`text-embedding-3-small` +
`gpt-4o-mini`) and Anthropic for generation are supported by the same code paths.

Built by [PH AI Works](https://www.phaiworks.com/).
