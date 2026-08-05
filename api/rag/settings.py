"""
Central configuration. Everything tunable lives here so the eval harness can sweep a
knob without editing pipeline code, and so the README can point at one file when it
says "these are the levers".
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# --- paths -------------------------------------------------------------------
# api/rag/settings.py -> api/app -> api -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("DATA_DIR") or REPO_ROOT / "data")
EVAL_DIR = REPO_ROOT / "api" / "eval"
# The frontend reads this artefact to render /evals, so it lives under public/.
EVAL_RESULTS_PATH = REPO_ROOT / "public" / "eval-results.json"

# --- models ------------------------------------------------------------------
# Provider is a config value, not a hardcoded import. LangChain's abstraction is worth
# very little if the pipeline still has one provider welded into it — and being able to
# move both halves independently is what lets embeddings and generation come from
# different vendors when one of them has better pricing or a better model for the job.
EMBED_PROVIDER = os.getenv("EMBED_PROVIDER", "google")  # google | openai
CHAT_PROVIDER = os.getenv("CHAT_PROVIDER", "google")  # google | openai | anthropic

_EMBED_DEFAULTS = {
    "google": ("gemini-embedding-001", 3072),
    "openai": ("text-embedding-3-small", 1536),
}
_CHAT_DEFAULTS = {
    "google": "gemini-2.5-flash",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-haiku-4-5-20251001",
}

_default_embed_model, _default_embed_dim = _EMBED_DEFAULTS.get(
    EMBED_PROVIDER, _EMBED_DEFAULTS["google"]
)
EMBED_MODEL = os.getenv("EMBED_MODEL", _default_embed_model)
# Must match the Pinecone index. Changing the embedding model means a new index, not a
# re-ingest into the old one — the dimensions will not line up.
EMBED_DIM = int(os.getenv("EMBED_DIM", str(_default_embed_dim)))
CHAT_MODEL = os.getenv("CHAT_MODEL", _CHAT_DEFAULTS.get(CHAT_PROVIDER, "gemini-2.5-flash"))

# USD per 1M tokens, so the UI can show a measured cost rather than calling it cheap.
# These are configured list prices, not something the code discovers: they must be
# updated when a provider changes pricing. A model missing from this table reports no
# cost rather than a made-up one — see rag/cost.py.
PRICE_PER_MTOK = {
    "gpt-4o-mini": {"in": 0.15, "out": 0.60},
    "text-embedding-3-small": {"in": 0.02, "out": 0.0},
    "gemini-2.5-flash": {"in": 0.30, "out": 2.50},
    "gemini-embedding-001": {"in": 0.15, "out": 0.0},
}

# --- vector store ------------------------------------------------------------
INDEX_NAME = os.getenv("PINECONE_INDEX", "clinical-kb-gemini")
PINECONE_CLOUD = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")
NAMESPACE = os.getenv("PINECONE_NAMESPACE", "kb")
# Metadata key LangChain stores page_content under. Ingest and query must agree or
# retrieval silently returns documents with empty page_content.
TEXT_KEY = "chunk_text"

# --- retrieval ---------------------------------------------------------------
TOP_K = int(os.getenv("TOP_K", "5"))
# Candidates pulled from each retriever before fusion. Wider than TOP_K so the
# fusion has something to actually reorder.
CANDIDATE_K = int(os.getenv("CANDIDATE_K", "12"))
# Reciprocal-rank-fusion damping. 60 is the value from the original RRF paper, kept as
# the default rather than tuned — on a corpus this size, tuning it against a 60-case gold
# set would mostly be fitting the gold set.
RRF_K = int(os.getenv("RRF_K", "60"))
# How much the BM25 run counts for, relative to the dense run, inside the fusion.
# Set from `run_eval.py --sweep-weights`, not from taste. Equally-weighted fusion is the
# usual default and it made retrieval measurably worse on this corpus: BM25 latches onto
# a domain word that many briefs share ("cholesterol") and floats them all above the one
# brief that actually answers the question.
BM25_WEIGHT = float(os.getenv("BM25_WEIGHT", "1.0"))
# Cosine score below which a dense hit is treated as "no real evidence" — the number
# that decides refusals, and the most consequential one in this file.
#
# 0.655 comes off the sweep, not from taste: combined accuracy peaks on a plateau from
# 0.648 to 0.663 and this sits in the middle of it rather than on an edge. It was 0.35
# until the sweep ran, inherited from a different embedding model — gemini-embedding-001
# scores an unrelated question ("what is the capital of Australia") at 0.51, so a 0.35
# threshold refused precisely nothing and the refusal rate measured 0%.
MIN_SCORE = float(os.getenv("MIN_SCORE", "0.655"))
# Retrieval mode: "dense" or "hybrid" (dense + BM25 via RRF).
#
# Dense, because that is what the eval says. Hybrid retrieval is the standard advice and
# it was the original design here, but on this corpus BM25 only ever cost accuracy: top-1
# falls from 96% to 90% at equal weighting and degrades monotonically with the BM25
# weight. Exact-name queries — the case BM25 is supposed to rescue — already score 12/12
# on dense alone, because a 3072-dimension embedding has no trouble with "GGT".
# The hybrid path is kept, and the eval keeps measuring it, so this stays a measurement
# rather than a belief.
RETRIEVAL_MODE = os.getenv("RETRIEVAL_MODE", "dense")

# --- graph -------------------------------------------------------------------
# How many times the agent may rewrite the question and retrieve again before giving up.
# 1 by default: each retry costs a model call plus an embedding, and a question that two
# phrasings cannot reach is usually not in the corpus at all.
MAX_REWRITES = int(os.getenv("MAX_REWRITES", "1"))

# --- guardrails --------------------------------------------------------------
MAX_QUESTION_LEN = int(os.getenv("MAX_QUESTION_LEN", "200"))
ALLOWED_LANGUAGE = os.getenv("ALLOWED_LANGUAGE", "en-GB")
REQUIRED_STATUS = "clinically_approved"

CATEGORIES: list[str] = [
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
]

# --- service -----------------------------------------------------------------
# The Next.js app is the only intended caller; it proxies browser traffic so no
# AI provider key ever reaches the frontend deployment.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,https://rag-demo.phaiworks.com",
    ).split(",")
    if o.strip()
]


def require(name: str) -> str:
    """Fail loudly at startup rather than mid-request with a confusing SDK error."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is not set. Copy api/.env.example to api/.env and fill it in.")
    return value
