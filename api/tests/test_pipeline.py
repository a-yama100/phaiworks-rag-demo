"""
Tests that run without any API key.

Everything here is the part of the pipeline that can be wrong on its own: the validation
gate, the fusion arithmetic, the citation check, and the graph's routing. Those are also
the parts where a bug is silent — a broken RRF still returns plausible documents, and a
broken citation check still returns a fluent answer.

    .venv/Scripts/python.exe -m pytest tests -q
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from langchain_core.documents import Document

from app.bm25 import FilteredBM25Retriever, tokenize
from app.corpus import CorpusError, load_briefs, load_documents, matches_filter
from app.retrieval import Hit, best_dense_score, reciprocal_rank_fusion
from app.settings import CATEGORIES

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


# --- the validation gate -----------------------------------------------------


def test_every_brief_validates():
    briefs = load_briefs()
    assert len(briefs) >= 50
    assert all(b.status.value == "clinically_approved" for b in briefs)


def test_categories_match_settings():
    """A brief in a category the API does not expose would be unreachable by filter."""
    used = {b.category.value for b in load_briefs()}
    assert used <= set(CATEGORIES)


def test_vector_ids_are_unique_and_stable():
    briefs = load_briefs()
    ids = [b.vector_id() for b in briefs]
    assert len(ids) == len(set(ids))
    # Stability matters: if vector_id changes, re-ingest orphans every existing vector
    # instead of overwriting it, and the index silently doubles.
    assert briefs[0].vector_id() == briefs[0].vector_id()


def test_content_hash_ignores_last_updated():
    """Touching last_updated should not force a paid re-embed of unchanged content."""
    briefs = load_briefs()
    brief = briefs[0]
    before = brief.content_hash()
    bumped = brief.model_copy(update={"last_updated": brief.last_updated.replace(year=2030)})
    assert bumped.content_hash() == before


def test_invalid_brief_is_rejected(tmp_path):
    bad = json.loads((DATA_DIR / "hba1c.json").read_text(encoding="utf-8"))
    bad["approved_by"] = None  # approved status without a named approver
    (tmp_path / "bad.json").write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(CorpusError, match="bad.json"):
        load_briefs(tmp_path)


def test_governance_fields_stay_out_of_the_vector():
    """Embedding governance metadata pollutes similarity with irrelevant text."""
    brief = next(b for b in load_briefs() if b.biomarker_name == "HbA1c")
    text = brief.embedding_text()
    assert "BRIEF-HBA1C" not in text
    assert "approved_by" not in text
    assert brief.approved_by not in text


# --- BM25 --------------------------------------------------------------------


def test_tokenizer_keeps_alphanumeric_names_intact():
    """Splitting HbA1c into three tokens is what makes exact-name queries miss."""
    assert "hba1c" in tokenize("What does a high HbA1c mean?")
    assert "nt" in tokenize("NT-proBNP") and "probnp" in tokenize("NT-proBNP")


def test_bm25_finds_exact_name_and_alias():
    retriever = FilteredBM25Retriever(documents=load_documents(), k=5)
    assert retriever.search("HbA1c")[0].metadata["biomarker_name"] == "HbA1c"
    # "A1c" appears only in the alias list, not in the prose.
    assert retriever.search("A1c")[0].metadata["biomarker_name"] == "HbA1c"


def test_bm25_filters_before_ranking():
    docs = load_documents()
    retriever = FilteredBM25Retriever(documents=docs, k=5)
    hits = retriever.search("cholesterol", predicate=lambda d: matches_filter(d, "liver"))
    assert all(h.metadata["category"] == "liver" for h in hits)


def test_bm25_returns_nothing_for_unmatched_terms():
    retriever = FilteredBM25Retriever(documents=load_documents(), k=5)
    assert retriever.search("xyzzy plugh frobnicate") == []


# --- fusion ------------------------------------------------------------------


def _hit(name: str, dense_rank=None, sparse_rank=None, dense_score=None) -> Hit:
    doc = Document(id=name, page_content=name, metadata={"biomarker_name": name})
    return Hit(
        doc=doc,
        dense_rank=dense_rank,
        sparse_rank=sparse_rank,
        dense_score=dense_score,
        retrievers=["dense" if dense_rank else "sparse"],
    )


def test_rrf_promotes_documents_both_retrievers_agree_on():
    dense = [_hit("A", dense_rank=1), _hit("B", dense_rank=2), _hit("C", dense_rank=3)]
    sparse = [_hit("C", sparse_rank=1), _hit("B", sparse_rank=2)]
    fused = reciprocal_rank_fusion([dense, sparse], k=60)
    names = [h.name for h in fused]

    # A tops the dense list but no other retriever corroborates it, so agreement beats
    # a single strong opinion — that is the entire behaviour we want from fusion.
    assert names.index("A") == 2
    assert set(names[:2]) == {"B", "C"}
    assert fused[0].retrievers == ["dense", "sparse"]


def test_rrf_keeps_documents_only_one_retriever_found():
    dense = [_hit("A", dense_rank=1)]
    sparse = [_hit("Z", sparse_rank=1)]
    fused = reciprocal_rank_fusion([dense, sparse], k=60)
    assert {h.name for h in fused} == {"A", "Z"}


def test_best_dense_score_ignores_sparse_only_hits():
    """
    The refusal decision must never be made on a document that only BM25 found: BM25
    has no notion of "not similar enough", so a keyword-only match would look like
    evidence.
    """
    hits = [_hit("A", sparse_rank=1), _hit("B", dense_rank=1, dense_score=0.42)]
    assert best_dense_score(hits) == pytest.approx(0.42)
    assert best_dense_score([_hit("A", sparse_rank=1)]) == 0.0


# --- citation enforcement ----------------------------------------------------


def test_generation_rejects_citations_that_were_not_retrieved(monkeypatch):
    from app import generate as gen

    retrieved = Hit(
        doc=Document(
            id="x",
            page_content="",
            metadata={"source_brief_id": "BRIEF-HBA1C-001", "answer_text": "…"},
        )
    )

    class FakeChain:
        def invoke(self, _):
            return {
                "parsed": gen.GroundedAnswer(
                    sufficient=True,
                    answer="Your HbA1c is fine.",
                    citations=["BRIEF-INVENTED-999"],
                ),
                "raw": None,
            }

    monkeypatch.setattr(gen, "build_chain", FakeChain)

    result = gen.generate("anything", [retrieved])
    assert result.grounded is False
    assert result.refusal_reason.startswith("ungrounded_citation")


def test_generation_accepts_citations_that_were_retrieved(monkeypatch):
    """The mirror of the test above: a well-behaved model must not be refused."""
    from app import generate as gen

    retrieved = Hit(
        doc=Document(
            id="x",
            page_content="",
            metadata={"source_brief_id": "BRIEF-HBA1C-001", "answer_text": "…"},
        )
    )

    class FakeChain:
        def invoke(self, _):
            return {
                "parsed": gen.GroundedAnswer(
                    sufficient=True,
                    answer="HbA1c reflects average glucose.",
                    citations=["BRIEF-HBA1C-001"],
                ),
                "raw": None,
            }

    monkeypatch.setattr(gen, "build_chain", FakeChain)

    result = gen.generate("what is HbA1c", [retrieved])
    assert result.grounded is True
    assert result.citations == ["BRIEF-HBA1C-001"]


def test_generation_refuses_when_model_declines(monkeypatch):
    from app import generate as gen

    retrieved = Hit(
        doc=Document(id="x", page_content="", metadata={"source_brief_id": "B1", "answer_text": "…"})
    )

    class FakeChain:
        def invoke(self, _):
            return {"parsed": gen.GroundedAnswer(sufficient=False), "raw": None}

    monkeypatch.setattr(gen, "build_chain", FakeChain)

    result = gen.generate("something uncovered", [retrieved])
    assert result.grounded is False
    assert result.refusal_reason == "model_declined"


def test_generation_refuses_without_evidence():
    from app.generate import generate

    result = generate("anything", [])
    assert result.grounded is False
    assert result.refusal_reason == "no_evidence"


# --- graph routing -----------------------------------------------------------


def test_grade_routes_to_generate_when_evidence_is_strong():
    from app.graph import after_grade
    from app.settings import MIN_SCORE

    assert after_grade({"evidence_score": MIN_SCORE + 0.1, "attempts": 0}) == "generate"


def test_grade_spends_a_rewrite_before_refusing():
    from app.graph import after_grade
    from app.settings import MAX_REWRITES, MIN_SCORE

    weak = {"evidence_score": MIN_SCORE - 0.1, "attempts": 0}
    assert after_grade(weak) == "rewrite"
    exhausted = {"evidence_score": MIN_SCORE - 0.1, "attempts": MAX_REWRITES}
    assert after_grade(exhausted) == "refuse"


def test_ungrounded_generation_retries_then_refuses():
    from app.graph import after_generate
    from app.settings import MAX_REWRITES

    assert after_generate({"refused": True, "attempts": 0}) == "rewrite"
    assert after_generate({"refused": True, "attempts": MAX_REWRITES}) == "refuse"
    assert after_generate({"refused": False, "attempts": 0}) == "__end__"


def test_graph_compiles():
    """Catches a malformed edge set without needing a key to invoke it."""
    from app.graph import build_graph

    assert build_graph() is not None
