"""
FastAPI service in front of the agent.

This holds every provider key. The Next.js app proxies to it and holds none — so the
public deployment has no OpenAI or Pinecone credential to leak, and rotating a key never
touches the frontend.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.cost import query_cost
from app.corpus import retrievable_documents
from app.graph import ask
from app.settings import (
    ALLOWED_ORIGINS,
    CATEGORIES,
    CHAT_MODEL,
    EMBED_MODEL,
    MAX_QUESTION_LEN,
    MAX_REWRITES,
    MIN_SCORE,
    RETRIEVAL_MODE,
    TOP_K,
)

app = FastAPI(
    title="Clinical KB RAG API",
    description="Hybrid retrieval + LangGraph agent with citation-enforced generation.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=MAX_QUESTION_LEN)
    category: str | None = None
    # Exposed so the UI can demo dense-only next to hybrid on the same question.
    mode: str | None = None


@app.get("/health")
def health() -> dict:
    return {"ok": True, "briefs": len(retrievable_documents())}


@app.get("/meta")
def meta() -> dict:
    """Configuration the frontend renders, so the two never drift apart in the copy."""
    return {
        "categories": CATEGORIES,
        "brief_count": len(retrievable_documents()),
        "top_k": TOP_K,
        "min_score": MIN_SCORE,
        "max_rewrites": MAX_REWRITES,
        "retrieval_mode": RETRIEVAL_MODE,
        "chat_model": CHAT_MODEL,
        "embed_model": EMBED_MODEL,
        "max_question_len": MAX_QUESTION_LEN,
    }


@app.post("/ask")
def ask_endpoint(req: AskRequest) -> dict:
    category = req.category if req.category in CATEGORIES else None
    if req.mode not in (None, "hybrid", "dense"):
        raise HTTPException(status_code=400, detail="mode must be 'hybrid' or 'dense'")

    try:
        state = ask(req.question.strip(), category=category, mode=req.mode)
    except RuntimeError as exc:
        # Missing key or missing index — a deployment problem, not a user problem.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    hits = state.get("hits", [])
    queries = state.get("queries", [req.question])
    return {
        "question": req.question,
        "category": category,
        "refused": state.get("refused", False),
        "refusal_reason": state.get("refusal_reason", ""),
        "answer": state.get("answer", ""),
        "citations": state.get("citations", []),
        "uncovered": state.get("uncovered", ""),
        "matches": [h.to_dict() for h in hits],
        "queries": queries,
        "trace": state.get("trace", []),
        "timing": {"total_ms": state.get("total_ms", 0)},
        "cost": query_cost(
            state.get("input_tokens", 0),
            state.get("output_tokens", 0),
            queries,
        ),
    }
