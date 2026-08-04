"""
Corpus loading: data/*.json -> validated briefs -> LangChain Documents.

The validation gate is the point. A brief that fails the Pydantic schema never becomes
a Document, so it can never be embedded, indexed or retrieved. Malformed content fails
at ingest time with a filename attached, not at query time as a confusing wrong answer.
"""

from __future__ import annotations

import functools
from pathlib import Path

from langchain_core.documents import Document

from app.settings import ALLOWED_LANGUAGE, DATA_DIR, REQUIRED_STATUS
from schema.biomarker import BiomarkerBrief, load_brief


class CorpusError(RuntimeError):
    """Raised with the offending filename so a bad brief is trivial to find."""


def load_briefs(data_dir: Path | None = None) -> list[BiomarkerBrief]:
    directory = Path(data_dir or DATA_DIR)
    files = sorted(directory.glob("*.json"))
    if not files:
        raise CorpusError(f"No briefs found in {directory}")

    briefs: list[BiomarkerBrief] = []
    for path in files:
        try:
            briefs.append(load_brief(str(path)))
        except Exception as exc:  # noqa: BLE001 - we want the filename in the message
            raise CorpusError(f"{path.name} failed schema validation: {exc}") from exc

    _assert_unique_ids(briefs)
    return briefs


def _assert_unique_ids(briefs: list[BiomarkerBrief]) -> None:
    """
    Two briefs colliding on vector_id would silently overwrite each other at upsert
    time and quietly shrink the index. Catch it here instead.
    """
    seen: dict[str, str] = {}
    for brief in briefs:
        vid = brief.vector_id()
        if vid in seen:
            raise CorpusError(
                f"vector id collision: {brief.biomarker_name!r} and {seen[vid]!r} both map to {vid}"
            )
        seen[vid] = brief.biomarker_name


def brief_to_document(brief: BiomarkerBrief) -> Document:
    """
    page_content is embedding_text() — semantic content only. Governance fields live in
    metadata so they can be hard-filtered without polluting the vector.
    """
    return Document(
        id=brief.vector_id(),
        page_content=brief.embedding_text(),
        metadata=brief.to_metadata(),
    )


def load_documents(data_dir: Path | None = None) -> list[Document]:
    return [brief_to_document(b) for b in load_briefs(data_dir)]


@functools.lru_cache(maxsize=1)
def retrievable_documents() -> list[Document]:
    """
    The subset a user may ever see: approved, in the served language. Cached because
    BM25 rebuilds its index from this list on every process start.
    """
    return [
        d
        for d in load_documents()
        if d.metadata.get("status") == REQUIRED_STATUS
        and d.metadata.get("language") == ALLOWED_LANGUAGE
    ]


def matches_filter(doc: Document, category: str | None) -> bool:
    """Same predicate the Pinecone metadata filter applies, for the local BM25 side."""
    md = doc.metadata
    if md.get("status") != REQUIRED_STATUS:
        return False
    if md.get("language") != ALLOWED_LANGUAGE:
        return False
    if category and md.get("category") != category:
        return False
    return True
