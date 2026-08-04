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
# api/app/settings.py -> api/app -> api -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("DATA_DIR") or REPO_ROOT / "data")
EVAL_DIR = REPO_ROOT / "api" / "eval"
# The frontend reads this artefact to render /evals, so it lives under public/.
EVAL_RESULTS_PATH = REPO_ROOT / "public" / "eval-results.json"

# --- models ------------------------------------------------------------------
EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")
EMBED_DIM = int(os.getenv("EMBED_DIM", "1536"))  # text-embedding-3-small
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")

# Published so the UI can show cost per query instead of hand-waving about it.
# USD per 1M tokens. Update when provider pricing changes.
PRICE_PER_MTOK = {
    "gpt-4o-mini": {"in": 0.15, "out": 0.60},
    "text-embedding-3-small": {"in": 0.02, "out": 0.0},
}

# --- vector store ------------------------------------------------------------
INDEX_NAME = os.getenv("PINECONE_INDEX", "clinical-kb-v2")
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
# Reciprocal-rank-fusion damping. 60 is the value from the original RRF paper and
# the eval showed no benefit from tuning it on a corpus this size.
RRF_K = int(os.getenv("RRF_K", "60"))
# Cosine score below which a dense hit is treated as "no real evidence".
# Tuned on the gold set: see api/eval/README section in the top-level README.
MIN_SCORE = float(os.getenv("MIN_SCORE", "0.35"))
# Retrieval mode: "hybrid" (dense + BM25 via RRF) or "dense" (dense only).
# The eval harness runs both to produce the before/after comparison.
RETRIEVAL_MODE = os.getenv("RETRIEVAL_MODE", "hybrid")

# --- graph -------------------------------------------------------------------
# How many times the agent may rewrite the question and retrieve again before
# giving up and refusing. 1 is enough on this corpus; 2+ only added latency.
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
