"""
The agent, as a LangGraph state machine.

    retrieve ──> grade ──┬── enough evidence ─────> generate ──┬── grounded ──> END
        ^                │                                      │
        │                ├── weak, retries left ──> rewrite ─────┤ (ungrounded, retries left)
        │                │                             │        │
        └────────────────┴── weak, no retries ──> refuse <───────┘ (ungrounded, no retries)

Why a graph and not a chain. The interesting behaviour here is a cycle: a question that
retrieves nothing useful gets its wording rewritten and tried again, and only refuses if
that also fails. Two different nodes can send the flow back to the same rewrite step, and
the retry budget has to be shared between them. That is a state machine — expressing it as
a linear chain means smuggling the loop into an if-block and losing the per-node trace.

Every node appends to `trace`, which is what the UI renders. The point of showing it is
that a reviewer can see *why* an answer was refused, not just that it was.
"""

from __future__ import annotations

import time
from typing import Annotated, Literal, TypedDict

from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, StateGraph

from rag.generate import generate, get_chat_model
from rag.retrieval import Hit, best_dense_score, retrieve
from rag.settings import MAX_REWRITES, MIN_SCORE, RETRIEVAL_MODE, TOP_K


def _append(left: list, right: list) -> list:
    return (left or []) + (right or [])


class AgentState(TypedDict, total=False):
    question: str
    category: str | None
    mode: str
    # Every query actually issued: the user's wording first, then any rewrites.
    queries: Annotated[list[str], _append]
    attempts: int
    hits: list[Hit]
    evidence_score: float
    answer: str
    citations: list[str]
    uncovered: str
    refused: bool
    refusal_reason: str
    trace: Annotated[list[dict], _append]
    input_tokens: int
    output_tokens: int
    total_ms: int


REWRITE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Rewrite the user's question as a search query over a knowledge base of blood-test "
            "briefs. Translate lay wording into the clinical terms a brief would use "
            "('always tired' -> 'fatigue anaemia iron'), and expand abbreviations. Keep it under "
            "15 words. Output the query only, with no preamble.\n\n"
            "If the question is not about blood tests or biomarkers at all, return it unchanged — "
            "rewriting an off-topic question into on-topic vocabulary would manufacture a false "
            "match, which is the opposite of what this step is for.",
        ),
        ("human", "{question}"),
    ]
)


# --- nodes -------------------------------------------------------------------


def retrieve_node(state: AgentState) -> AgentState:
    started = time.perf_counter()
    query = state["queries"][-1]
    hits = retrieve(
        query,
        category=state.get("category"),
        mode=state.get("mode") or RETRIEVAL_MODE,
        top_k=TOP_K,
    )
    score = best_dense_score(hits)
    return {
        "hits": hits,
        "evidence_score": score,
        "trace": [
            {
                "node": "retrieve",
                "ms": round((time.perf_counter() - started) * 1000),
                "query": query,
                "mode": state.get("mode") or RETRIEVAL_MODE,
                "candidates": [h.to_dict() for h in hits],
                "best_dense_score": round(score, 4),
            }
        ],
    }


def grade_node(state: AgentState) -> AgentState:
    """
    A threshold, not an LLM judge. The score is already a calibrated number and asking a
    model to second-guess it costs a round trip, adds variance, and made the gold set
    worse when tried — the model talks itself into loosely-related briefs.
    """
    started = time.perf_counter()
    score = state.get("evidence_score", 0.0)
    passed = score >= MIN_SCORE
    return {
        "trace": [
            {
                "node": "grade",
                "ms": round((time.perf_counter() - started) * 1000),
                "best_dense_score": round(score, 4),
                "threshold": MIN_SCORE,
                "passed": passed,
            }
        ]
    }


def rewrite_node(state: AgentState) -> AgentState:
    started = time.perf_counter()
    chain = REWRITE_PROMPT | get_chat_model()
    message = chain.invoke({"question": state["question"]})
    rewritten = str(message.content).strip() or state["question"]
    usage = getattr(message, "usage_metadata", None) or {}
    return {
        "queries": [rewritten],
        "attempts": state.get("attempts", 0) + 1,
        "input_tokens": state.get("input_tokens", 0) + int(usage.get("input_tokens", 0)),
        "output_tokens": state.get("output_tokens", 0) + int(usage.get("output_tokens", 0)),
        "trace": [
            {
                "node": "rewrite",
                "ms": round((time.perf_counter() - started) * 1000),
                "from": state["queries"][-1],
                "to": rewritten,
                "attempt": state.get("attempts", 0) + 1,
            }
        ],
    }


def generate_node(state: AgentState) -> AgentState:
    started = time.perf_counter()
    result = generate(state["question"], state.get("hits", []))
    return {
        "answer": result.answer,
        "citations": result.citations,
        "uncovered": result.uncovered,
        "refused": not result.grounded,
        "refusal_reason": result.refusal_reason,
        "input_tokens": state.get("input_tokens", 0) + result.input_tokens,
        "output_tokens": state.get("output_tokens", 0) + result.output_tokens,
        "trace": [
            {
                "node": "generate",
                "ms": round((time.perf_counter() - started) * 1000),
                "grounded": result.grounded,
                "citations": result.citations,
                "refusal_reason": result.refusal_reason,
            }
        ],
    }


def refuse_node(state: AgentState) -> AgentState:
    reason = state.get("refusal_reason") or "below_threshold"
    return {
        "refused": True,
        "answer": "",
        "citations": [],
        "refusal_reason": reason,
        "trace": [{"node": "refuse", "ms": 0, "reason": reason}],
    }


# --- edges -------------------------------------------------------------------


def after_grade(state: AgentState) -> Literal["generate", "rewrite", "refuse"]:
    if state.get("evidence_score", 0.0) >= MIN_SCORE:
        return "generate"
    if state.get("attempts", 0) < MAX_REWRITES:
        return "rewrite"
    return "refuse"


def after_generate(state: AgentState) -> Literal["rewrite", "refuse", "__end__"]:
    if not state.get("refused"):
        return END
    # The retrieval cleared the threshold but the model would not stand behind an answer.
    # Often that means the question was on-topic but worded around the brief's vocabulary,
    # which is exactly what a rewrite fixes — so spend the retry rather than refusing.
    if state.get("attempts", 0) < MAX_REWRITES:
        return "rewrite"
    return "refuse"


def build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("grade", grade_node)
    graph.add_node("rewrite", rewrite_node)
    graph.add_node("generate", generate_node)
    graph.add_node("refuse", refuse_node)

    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "grade")
    graph.add_conditional_edges("grade", after_grade)
    graph.add_edge("rewrite", "retrieve")
    graph.add_conditional_edges("generate", after_generate)
    graph.add_edge("refuse", END)
    return graph.compile()


_compiled = None


def get_agent():
    global _compiled
    if _compiled is None:
        _compiled = build_graph()
    return _compiled


def ask(question: str, category: str | None = None, mode: str | None = None) -> AgentState:
    started = time.perf_counter()
    state: AgentState = get_agent().invoke(
        {
            "question": question,
            "category": category,
            "mode": mode or RETRIEVAL_MODE,
            "queries": [question],
            "attempts": 0,
            "trace": [],
            "input_tokens": 0,
            "output_tokens": 0,
        }
    )
    state["total_ms"] = round((time.perf_counter() - started) * 1000)
    return state
