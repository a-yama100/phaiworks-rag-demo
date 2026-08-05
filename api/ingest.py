"""
Ingest: validate -> embed -> idempotent upsert.

This is the only ingest in the repo. An earlier version had a second copy in JavaScript
so the Next.js app could populate the index itself, which meant embedding_text() and
answer_text() existed twice in two languages — and the JS copy had already drifted. The
rule now is that the schema defines those, in one place, and everything else calls it.

    python ingest.py                  # every brief in data/
    python ingest.py ../data/hba1c.json
    python ingest.py --dry-run        # validate + report, no network, no keys needed
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from rag.corpus import load_briefs
from rag.settings import (
    EMBED_DIM,
    INDEX_NAME,
    NAMESPACE,
    PINECONE_CLOUD,
    PINECONE_REGION,
    require,
)
from rag.schema.biomarker import BiomarkerBrief, load_brief


def _ensure_index(pc) -> None:
    from pinecone import ServerlessSpec

    if INDEX_NAME in pc.list_indexes().names():
        print(f"Index {INDEX_NAME!r} exists.")
        return
    print(f"Creating serverless index {INDEX_NAME!r} (dim={EMBED_DIM}, cosine)…")
    pc.create_index(
        name=INDEX_NAME,
        dimension=EMBED_DIM,
        metric="cosine",
        spec=ServerlessSpec(cloud=PINECONE_CLOUD, region=PINECONE_REGION),
    )


def dry_run(briefs: list[BiomarkerBrief]) -> None:
    """
    Everything the pipeline can check without spending a cent: schema validity, id
    uniqueness, and the category spread that decides whether the eval means anything.
    """
    print(f"Validated {len(briefs)} brief(s) against schema v{briefs[0].schema_version}.")

    by_category: dict[str, list[str]] = {}
    for b in briefs:
        by_category.setdefault(b.category.value, []).append(b.biomarker_name)
    print("\nCategory spread:")
    for category in sorted(by_category):
        names = sorted(by_category[category])
        print(f"  {category:<16} {len(names):>2}  {', '.join(names)}")

    approved = [b for b in briefs if b.status.value == "clinically_approved"]
    print(f"\nRetrievable (clinically_approved): {len(approved)}/{len(briefs)}")

    lengths = [len(b.embedding_text()) for b in briefs]
    print(
        f"embedding_text chars: min={min(lengths)} median={sorted(lengths)[len(lengths) // 2]} "
        f"max={max(lengths)}"
    )
    print("\nDry run only — nothing was embedded or upserted.")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", help="specific brief files (default: all of data/)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate and report without embedding or contacting Pinecone",
    )
    args = parser.parse_args(argv)

    if args.paths:
        briefs = [load_brief(p) for p in args.paths]
        print(f"Validated {len(briefs)} brief(s) from arguments.")
    else:
        briefs = load_briefs()

    if args.dry_run:
        dry_run(briefs)
        return 0

    from langchain_pinecone import PineconeVectorStore
    from pinecone import Pinecone

    from rag.corpus import brief_to_document
    from rag.retrieval import get_embeddings

    pc = Pinecone(api_key=require("PINECONE_API_KEY"))
    _ensure_index(pc)
    index = pc.Index(INDEX_NAME)

    # Skip entries whose content has not changed, so a re-run after editing one brief
    # pays to embed one brief and not the whole corpus.
    ids = [b.vector_id() for b in briefs]
    existing = index.fetch(ids=ids, namespace=NAMESPACE).vectors or {}
    changed, unchanged = [], []
    for brief in briefs:
        prior = existing.get(brief.vector_id())
        prior_hash = (prior.metadata or {}).get("content_hash") if prior else None
        (unchanged if prior_hash == brief.content_hash() else changed).append(brief)

    if not changed:
        print(f"Nothing changed. {len(unchanged)} entry(ies) already up to date.")
        return 0

    store = PineconeVectorStore(
        index=index,
        embedding=get_embeddings(),
        namespace=NAMESPACE,
        text_key="chunk_text",
    )
    documents = [brief_to_document(b) for b in changed]
    store.add_documents(documents, ids=[d.id for d in documents])

    print(f"Upserted {len(changed)}: {', '.join(b.biomarker_name for b in changed)}")
    if unchanged:
        print(f"Skipped {len(unchanged)} unchanged.")
    print(f"Index reports {index.describe_index_stats().total_vector_count} vectors.")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main(sys.argv[1:]))
