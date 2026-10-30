"""
FastAPI service in front of the agent.

This holds every provider key. The Next.js app proxies to it and holds none — so the
public deployment has no OpenAI or Pinecone credential to leak, and rotating a key never
touches the frontend.
"""

from __future__ import annotations

import hmac
import os
import threading
import time
from collections import deque

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from rag.cost import query_cost
from rag.corpus import retrievable_documents
from rag.graph import ask
from rag.settings import (
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

# Every route carries this prefix, in both deployment shapes.
#
# On Vercel, api/index.py is the catch-all for /api/* that Next.js has not already
# claimed, and the path the function receives is the full one — so FastAPI has to declare
# it. Locally under uvicorn the prefix is simply part of the path. Keeping it identical in
# both means the proxy builds one URL and never branches on environment.
API_PREFIX = "/api/py"

app = FastAPI(
    title="Clinical KB RAG API",
    description="Retrieval + LangGraph agent with citation-enforced generation.",
    version="2.0.0",
    docs_url=f"{API_PREFIX}/docs",
    openapi_url=f"{API_PREFIX}/openapi.json",
    # Off: it defaults to an unprefixed /redoc, which would be routed by Next.js and 404
    # in production while working locally — a confusing thing to leave lying around.
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """
    Shared secret between the Next.js proxy and this service.

    Opt-in: with BACKEND_API_KEY unset this is a no-op, so local development needs no
    setup. Set it in both places in production and the backend URL stops being useful to
    anyone who finds it — otherwise the rate limit in the proxy is trivially bypassed by
    calling this service directly, and it is the only thing standing between a public
    URL and the provider bill.

    compare_digest rather than ==, so a wrong key cannot be recovered one character at a
    time from response timings.
    """
    expected = os.getenv("BACKEND_API_KEY")
    if not expected:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# 回数制限（このサーバー1台の記憶で数える）。Next.js の受け口（app/api/ask）でも数えているが、
# この /api/py/ask は同じドメインで公開されているので、直接呼ばれると前段の制限を通らない。
# 正しい X-API-Key が付いた呼び出し（前段の受け口から）は前段で数え済みなので、ここでは数えない。
# BACKEND_API_KEY を設定していないときは、前段からの呼び出しも同じ IP にまとまるので、前段より広めにとる。
RATE_WINDOW_SEC = 60
RATE_MAX_PER_MINUTE = int(os.getenv("RATE_MAX_PER_MINUTE", "20"))
RATE_MAX_PER_DAY = int(os.getenv("RATE_MAX_PER_DAY", "300"))
_rate_lock = threading.Lock()
_rate_hits: dict[str, deque[float]] = {}
_rate_day: dict[str, tuple[float, int]] = {}


def _client_ip(request: Request) -> str:
    h = request.headers
    return (
        h.get("x-real-ip")
        or (h.get("x-forwarded-for") or "").split(",")[0].strip()
        or (request.client.host if request.client else "")
        or "unknown"
    )


def rate_limit(request: Request, x_api_key: str | None = Header(default=None)) -> None:
    expected = os.getenv("BACKEND_API_KEY")
    if expected and x_api_key and hmac.compare_digest(x_api_key, expected):
        return
    ip = _client_ip(request)
    now = time.time()
    with _rate_lock:
        recent = _rate_hits.setdefault(ip, deque())
        while recent and now - recent[0] >= RATE_WINDOW_SEC:
            recent.popleft()
        day_start, day_count = _rate_day.get(ip, (now, 0))
        if now - day_start >= 86_400:
            day_start, day_count = now, 0
        if len(recent) >= RATE_MAX_PER_MINUTE or day_count >= RATE_MAX_PER_DAY:
            raise HTTPException(status_code=429, detail="Too many requests")
        recent.append(now)
        _rate_day[ip] = (day_start, day_count + 1)
        if len(_rate_hits) > 5000:
            for k in [k for k, v in _rate_hits.items() if not v and now - _rate_day.get(k, (0, 0))[0] >= 86_400]:
                _rate_hits.pop(k, None)
                _rate_day.pop(k, None)


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=MAX_QUESTION_LEN)
    category: str | None = None
    # Exposed so the UI can demo dense-only next to hybrid on the same question.
    mode: str | None = None


@app.get(f"{API_PREFIX}/health")
def health() -> dict:
    return {"ok": True, "briefs": len(retrievable_documents())}


@app.get(f"{API_PREFIX}/meta")
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


@app.post(f"{API_PREFIX}/ask", dependencies=[Depends(require_api_key), Depends(rate_limit)])
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
