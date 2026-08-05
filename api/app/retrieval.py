"""
Retrieval: dense vectors, BM25 keywords, and reciprocal rank fusion over both.

Why hybrid. Dense embeddings handle "I'm always tired, which iron test matters?" —
no lexical overlap with "Ferritin", but semantically close. BM25 handles the opposite
failure: a user types "GGT" or "HbA1c" verbatim and cosine similarity buries it under
five neighbouring biomarkers that are all *about* the same organ. Each retriever covers
the other's blind spot. Whether that shows up as a real gain is what the eval measures;
`RETRIEVAL_MODE=dense` runs the same pipeline without fusion so the two are comparable.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass, field

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone

from app.bm25 import FilteredBM25Retriever
from app.corpus import matches_filter, retrievable_documents
from app.settings import (
    ALLOWED_LANGUAGE,
    BM25_WEIGHT,
    CANDIDATE_K,
    EMBED_MODEL,
    EMBED_PROVIDER,
    INDEX_NAME,
    NAMESPACE,
    REQUIRED_STATUS,
    RRF_K,
    TEXT_KEY,
    TOP_K,
    require,
)


@dataclass
class Hit:
    """One retrieved brief plus everything the trace panel needs to explain it."""

    doc: Document
    dense_score: float | None = None
    dense_rank: int | None = None
    sparse_rank: int | None = None
    fused_score: float = 0.0
    retrievers: list[str] = field(default_factory=list)

    @property
    def brief_id(self) -> str:
        return str(self.doc.metadata.get("source_brief_id", ""))

    @property
    def name(self) -> str:
        return str(self.doc.metadata.get("biomarker_name", ""))

    def to_dict(self) -> dict:
        md = self.doc.metadata
        return {
            "biomarker": self.name,
            "category": md.get("category"),
            "source": self.brief_id,
            "dense_score": round(self.dense_score, 4) if self.dense_score is not None else None,
            "dense_rank": self.dense_rank,
            "sparse_rank": self.sparse_rank,
            "fused_score": round(self.fused_score, 5),
            "retrievers": self.retrievers,
            "answer": md.get("answer_text", ""),
        }


# --- clients -----------------------------------------------------------------


@functools.lru_cache(maxsize=1)
def get_embeddings() -> Embeddings:
    """
    Both sides return a LangChain Embeddings, so nothing downstream knows or cares which
    provider produced the vectors. Switching is one environment variable plus a new
    index, because the dimensions differ.
    """
    if EMBED_PROVIDER == "openai":
        from langchain_openai import OpenAIEmbeddings

        return OpenAIEmbeddings(model=EMBED_MODEL, api_key=require("OPENAI_API_KEY"))
    if EMBED_PROVIDER == "google":
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        return GoogleGenerativeAIEmbeddings(
            model=f"models/{EMBED_MODEL}", google_api_key=require("GOOGLE_API_KEY")
        )
    raise RuntimeError(f"Unknown EMBED_PROVIDER {EMBED_PROVIDER!r}. Use 'google' or 'openai'.")


@functools.lru_cache(maxsize=1)
def get_vector_store() -> PineconeVectorStore:
    pc = Pinecone(api_key=require("PINECONE_API_KEY"))
    if INDEX_NAME not in pc.list_indexes().names():
        raise RuntimeError(f"Pinecone index {INDEX_NAME!r} does not exist. Run: python ingest.py")
    return PineconeVectorStore(
        index=pc.Index(INDEX_NAME),
        embedding=get_embeddings(),
        namespace=NAMESPACE,
        text_key=TEXT_KEY,
    )


@functools.lru_cache(maxsize=1)
def get_bm25() -> FilteredBM25Retriever:
    """
    BM25 over the same corpus, in process. The corpus is a few dozen briefs, so there is
    no reason to pay for a second hosted service to do keyword matching.
    """
    return FilteredBM25Retriever(documents=retrievable_documents(), k=CANDIDATE_K)


# --- individual retrievers ---------------------------------------------------


def _pinecone_filter(category: str | None) -> dict:
    """
    Applied by Pinecone BEFORE similarity, not after. Unapproved, non-UK or off-category
    content is not outranked — it is not a candidate at all.
    """
    flt: dict = {
        "status": {"$eq": REQUIRED_STATUS},
        "language": {"$eq": ALLOWED_LANGUAGE},
    }
    if category:
        flt["category"] = {"$eq": category}
    return flt


def dense_search(question: str, category: str | None, k: int = CANDIDATE_K) -> list[Hit]:
    store = get_vector_store()
    results = store.similarity_search_with_score(question, k=k, filter=_pinecone_filter(category))
    return [
        Hit(doc=doc, dense_score=float(score), dense_rank=rank, retrievers=["dense"])
        for rank, (doc, score) in enumerate(results, start=1)
    ]


def sparse_search(question: str, category: str | None, k: int = CANDIDATE_K) -> list[Hit]:
    """Same hard filter as the dense side, applied before ranking rather than after."""
    ranked = get_bm25().search(question, predicate=lambda d: matches_filter(d, category), k=k)
    return [
        Hit(doc=doc, sparse_rank=rank, retrievers=["sparse"])
        for rank, doc in enumerate(ranked, start=1)
    ]


# --- fusion ------------------------------------------------------------------


def _doc_key(hit: Hit) -> str:
    return hit.doc.id or hit.brief_id


def reciprocal_rank_fusion(
    runs: list[list[Hit]],
    k: int = RRF_K,
    weights: list[float] | None = None,
) -> list[Hit]:
    """
    RRF: score = sum over retrievers of weight / (k + rank).

    Rank-based, so it needs no score normalisation between a cosine similarity and a
    BM25 score. Those two numbers are not on comparable scales, and blending them
    directly needs a magic constant that has to be re-tuned whenever the corpus changes.

    `weights` exists because equal weighting turned out to be the wrong default here —
    see BM25_WEIGHT in settings and the weight sweep in the eval harness. A weight of 0
    reduces this to dense-only.
    """
    if weights is None:
        weights = [1.0] * len(runs)

    merged: dict[str, Hit] = {}

    for run, weight in zip(runs, weights):
        for hit in run:
            key = _doc_key(hit)
            existing = merged.get(key)
            if existing is None:
                existing = Hit(doc=hit.doc)
                merged[key] = existing

            rank = hit.dense_rank if hit.dense_rank is not None else hit.sparse_rank
            if rank is None:
                continue
            existing.fused_score += weight / (k + rank)

            if hit.dense_rank is not None:
                existing.dense_rank = hit.dense_rank
                existing.dense_score = hit.dense_score
            if hit.sparse_rank is not None:
                existing.sparse_rank = hit.sparse_rank
            for name in hit.retrievers:
                if name not in existing.retrievers:
                    existing.retrievers.append(name)

    return sorted(merged.values(), key=lambda h: h.fused_score, reverse=True)


# --- public entry point ------------------------------------------------------


def retrieve(
    question: str,
    category: str | None = None,
    mode: str = "hybrid",
    top_k: int = TOP_K,
) -> list[Hit]:
    """
    mode="hybrid" -> dense + BM25 fused with RRF
    mode="dense"  -> dense only (the baseline the eval compares against)
    """
    if mode == "dense":
        return dense_search(question, category)[:top_k]

    dense = dense_search(question, category)
    sparse = sparse_search(question, category)
    return reciprocal_rank_fusion([dense, sparse], weights=[1.0, BM25_WEIGHT])[:top_k]


def best_dense_score(hits: list[Hit]) -> float:
    """
    Evidence strength for the refusal decision. Deliberately the raw cosine score and not
    the fused score: RRF output is a rank artefact with no absolute meaning, so it cannot
    answer "is this actually similar enough to be worth answering from?".
    """
    scores = [h.dense_score for h in hits if h.dense_score is not None]
    return max(scores) if scores else 0.0
