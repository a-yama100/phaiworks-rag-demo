"""
Per-query cost, computed and shown rather than described.

"Cheap" is not a number a client can plan a budget against. Every response carries what
that specific query cost, so the figure on the page is measured, not estimated — and if a
change to the prompt or the retrieval doubles it, that shows up immediately instead of
three weeks later on an invoice.
"""

from __future__ import annotations

from app.settings import CHAT_MODEL, EMBED_MODEL, PRICE_PER_MTOK

# One embedding call per retrieval; the query is short. Measuring it exactly would cost
# another tokeniser dependency for a figure four decimal places below the chat cost, so
# it is approximated from the question length instead, and labelled as approximate.
CHARS_PER_TOKEN = 4


def embedding_tokens(queries: list[str]) -> int:
    return sum(max(1, len(q) // CHARS_PER_TOKEN) for q in queries)


def usd(model: str, direction: str, tokens: int) -> float | None:
    """None, not zero, when the model has no configured price — see query_cost."""
    prices = PRICE_PER_MTOK.get(model)
    if prices is None:
        return None
    return tokens / 1_000_000 * prices.get(direction, 0.0)


def query_cost(input_tokens: int, output_tokens: int, queries: list[str]) -> dict:
    embed_tok = embedding_tokens(queries)
    parts = [
        usd(CHAT_MODEL, "in", input_tokens),
        usd(CHAT_MODEL, "out", output_tokens),
        usd(EMBED_MODEL, "in", embed_tok),
    ]
    # If any leg is unpriced, report no total rather than one that silently treats the
    # missing leg as free. A cost figure that is quietly wrong is worse than a blank.
    total = None if any(p is None for p in parts) else sum(p for p in parts if p is not None)

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "embedding_tokens_approx": embed_tok,
        "chat_model": CHAT_MODEL,
        "embed_model": EMBED_MODEL,
        "usd_total": None if total is None else round(total, 6),
        # Clients ask "what does 10k questions a month cost?" more often than they ask
        # about a single query, so answer that directly.
        "usd_per_1k_queries": None if total is None else round(total * 1000, 3),
    }
