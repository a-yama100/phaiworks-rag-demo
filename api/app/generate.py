"""
Citation-enforced generation.

The original version of this demo returned approved text verbatim and let no model near
the output. That is genuinely safer, but it is not what a RAG brief usually asks for, and
it dodges the hard part: letting a model write while still being unable to invent.

So the model writes, and then two mechanical checks decide whether the user sees it:

  1. Every citation it emits must be a source_brief_id that was actually retrieved for
     this question. A model that cites a brief it was not shown is hallucinating, and
     that is now a detectable event rather than a plausible-looking paragraph.
  2. It must mark the evidence sufficient. "The briefs do not cover this" is a valid,
     rewarded answer — the prompt makes refusing the cheap option, not the failure.

Neither check trusts the model's self-assessment alone: the id check is set membership
against the retrieval result, which the model cannot influence.
"""

from __future__ import annotations

import functools

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from app.retrieval import Hit
from app.settings import CHAT_MODEL, require

SYSTEM_PROMPT = """You answer questions about blood tests using ONLY the approved briefs supplied below.

Rules:
- Use only facts present in the briefs. Never add clinical facts from your own knowledge, \
even if you are confident they are correct.
- Cite the source_brief_id of every brief you drew on, in `citations`.
- If the briefs do not contain what the user asked for, set `sufficient` to false and leave \
`answer` empty. Saying the knowledge base does not cover it is the correct answer, not a \
failure — do not stretch a loosely related brief to cover the question.
- If the briefs partially cover it, answer only the covered part and say plainly what is \
not covered.
- Never give personal medical advice, a diagnosis, or a recommendation to start or stop \
treatment. Describe what the marker means and, where a brief says so, when to seek help.
- Write in plain UK English at a level a non-clinician can follow. Keep it under 180 words.

Approved briefs:
{context}"""


class GroundedAnswer(BaseModel):
    """Structured output so the citation check operates on a list, not a regex over prose."""

    sufficient: bool = Field(
        description="True only if the supplied briefs genuinely answer the question."
    )
    answer: str = Field(default="", description="The answer. Empty when sufficient is false.")
    citations: list[str] = Field(
        default_factory=list,
        description="source_brief_id values of the briefs actually used.",
    )
    uncovered: str = Field(
        default="",
        description="Any part of the question the briefs do not cover. Empty if fully covered.",
    )


class GenerationResult(BaseModel):
    grounded: bool
    answer: str = ""
    citations: list[str] = []
    uncovered: str = ""
    refusal_reason: str = ""
    input_tokens: int = 0
    output_tokens: int = 0


@functools.lru_cache(maxsize=1)
def get_chat_model() -> ChatOpenAI:
    # temperature=0: this is an extraction-shaped task, not a creative one. Sampling
    # variance here shows up as citations that change between identical questions,
    # which makes the eval numbers noisy for no benefit.
    return ChatOpenAI(model=CHAT_MODEL, temperature=0, api_key=require("OPENAI_API_KEY"))


def format_context(hits: list[Hit]) -> str:
    blocks = []
    for hit in hits:
        blocks.append(
            f"--- source_brief_id: {hit.brief_id} ---\n"
            f"{hit.doc.metadata.get('answer_text', '')}"
        )
    return "\n\n".join(blocks)


def build_chain():
    """
    Separated so tests can substitute the model without a key. The citation check is the
    security-relevant part of this module, and a check that is only exercised against a
    live API is a check that never runs in CI.
    """
    prompt = ChatPromptTemplate.from_messages(
        [("system", SYSTEM_PROMPT), ("human", "{question}")]
    )
    return prompt | get_chat_model().with_structured_output(GroundedAnswer, include_raw=True)


def generate(question: str, hits: list[Hit]) -> GenerationResult:
    if not hits:
        return GenerationResult(
            grounded=False,
            refusal_reason="no_evidence",
        )

    raw = build_chain().invoke({"context": format_context(hits), "question": question})
    parsed: GroundedAnswer | None = raw.get("parsed")
    usage = getattr(raw.get("raw"), "usage_metadata", None) or {}
    tokens = {
        "input_tokens": int(usage.get("input_tokens", 0)),
        "output_tokens": int(usage.get("output_tokens", 0)),
    }

    if parsed is None:
        # Structured output failed to parse. Refuse rather than fall back to raw text —
        # unparsed output has not been through the citation check.
        return GenerationResult(grounded=False, refusal_reason="unparseable_output", **tokens)

    if not parsed.sufficient:
        return GenerationResult(
            grounded=False,
            refusal_reason="model_declined",
            uncovered=parsed.uncovered,
            **tokens,
        )

    # The check the model cannot game: cited ids must come from what we retrieved.
    retrieved_ids = {h.brief_id for h in hits}
    invented = [c for c in parsed.citations if c not in retrieved_ids]
    if invented:
        return GenerationResult(
            grounded=False,
            refusal_reason=f"ungrounded_citation:{','.join(invented)}",
            **tokens,
        )

    if not parsed.citations:
        return GenerationResult(grounded=False, refusal_reason="no_citation", **tokens)

    return GenerationResult(
        grounded=True,
        answer=parsed.answer.strip(),
        citations=parsed.citations,
        uncovered=parsed.uncovered.strip(),
        **tokens,
    )
