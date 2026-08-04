"""
BM25 keyword retriever, as a LangChain BaseRetriever.

Written directly on rank_bm25 rather than imported from langchain-community, for two
reasons. langchain-community is being sunset, and BM25Retriever there has no metadata
filter — you rank the whole corpus and discard afterwards, which quietly changes the
result: the IDF statistics still come from the full corpus, but more importantly, asking
for k documents gives you fewer than k once the filter runs. Filtering first and then
ranking is what the caller actually meant.
"""

from __future__ import annotations

import re
from typing import Callable

from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import Field
from rank_bm25 import BM25Okapi

# Split on non-alphanumerics but keep digits attached to letters, so "HbA1c" survives as
# one token instead of becoming ["hba", "1", "c"]. Biomarker names are full of these and
# splitting them is what makes exact-name queries miss.
_TOKEN = re.compile(r"[a-z0-9]+(?:[a-z0-9]*)")


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


class FilteredBM25Retriever(BaseRetriever):
    """
    BM25 over the subset of documents passing `predicate`, rebuilt per call.

    Rebuilding sounds wasteful, but the corpus is a few dozen briefs: constructing the
    index is sub-millisecond, and it means the category filter is applied before the
    ranking rather than after, so `k` means what it says.
    """

    documents: list[Document] = Field(default_factory=list)
    k: int = 12

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun | None = None,
        predicate: Callable[[Document], bool] | None = None,
    ) -> list[Document]:
        return self.search(query, predicate=predicate, k=self.k)

    def search(
        self,
        query: str,
        predicate: Callable[[Document], bool] | None = None,
        k: int | None = None,
    ) -> list[Document]:
        pool = [d for d in self.documents if predicate(d)] if predicate else list(self.documents)
        if not pool:
            return []

        tokens = tokenize(query)
        if not tokens:
            return []

        # The keyword surface deliberately includes the biomarker name, aliases and lay
        # keywords as well as the body: a user typing "A1c" should hit the brief whose
        # alias list contains it, even though the prose spells it out differently.
        corpus = [tokenize(_keyword_surface(d)) for d in pool]
        scores = BM25Okapi(corpus).get_scores(tokens)

        ranked = sorted(zip(pool, scores), key=lambda pair: pair[1], reverse=True)
        # A zero score means no query term appeared at all. Returning those pads the
        # candidate list with documents BM25 has no opinion about, and fusion then treats
        # that padding as evidence.
        return [doc for doc, score in ranked[: k or self.k] if score > 0]


def _keyword_surface(doc: Document) -> str:
    md = doc.metadata
    parts = [
        str(md.get("biomarker_name", "")),
        " ".join(md.get("aliases", []) or []),
        " ".join(md.get("keywords", []) or []),
        doc.page_content,
    ]
    return " ".join(p for p in parts if p)
