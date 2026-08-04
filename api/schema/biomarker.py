"""
Vera knowledge-base schema for clinically-approved biomarker briefs.

Design goals (what the client calls "discipline / consistency is everything"):
  1. Validation gate      - nothing reaches Pinecone unless it passes this model.
  2. Controlled vocabulary - category / status / direction are enums, not free text.
  3. Idempotent identity   - the vector id is a deterministic hash, so re-ingesting
                             the same brief UPSERTS (overwrites) instead of duplicating.
  4. Separation of concerns - embedding_text (what we vectorise) is kept apart from
                             filterable metadata (what we hard-filter on at query time).
  5. Traceability          - every entry carries approval + version + source provenance,
                             which is also what GDPR / clinical governance audits ask for.

NOTE ON ROLE BOUNDARY: clinical content is authored and APPROVED by the client's
clinicians. This schema does not invent medical facts; it structures already-approved
briefs and enforces consistency. `approved_by` / `approval_date` reference that sign-off.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

SCHEMA_VERSION = "1.0.0"


class Category(str, Enum):
    """Controlled vocabulary for the biomarker panel. Extend deliberately, never ad-hoc."""

    metabolic = "metabolic"
    lipid = "lipid"
    thyroid = "thyroid"
    inflammation = "inflammation"
    liver = "liver"
    kidney = "kidney"
    haematology = "haematology"
    vitamin_mineral = "vitamin_mineral"
    hormone = "hormone"
    cardiac = "cardiac"


class Status(str, Enum):
    draft = "draft"
    clinically_approved = "clinically_approved"
    deprecated = "deprecated"


class Sex(str, Enum):
    any = "any"
    male = "male"
    female = "female"


class Direction(str, Enum):
    """Which way an out-of-range result points."""

    high = "high"
    low = "low"


class ReferenceRange(BaseModel):
    """A reference interval. Lab- and cohort-specific, so it carries its own context."""

    low: Optional[float] = Field(None, description="Lower bound of the normal interval.")
    high: Optional[float] = Field(None, description="Upper bound of the normal interval.")
    unit: str = Field(..., description="Measurement unit, e.g. 'mmol/L', '%', 'ng/mL'.")
    sex: Sex = Sex.any
    age_min_years: Optional[int] = Field(None, ge=0)
    age_max_years: Optional[int] = Field(None, ge=0)
    note: Optional[str] = Field(None, description="Cohort / assay caveats, e.g. 'fasting'.")

    @model_validator(mode="after")
    def _bounds_sane(self) -> "ReferenceRange":
        if self.low is not None and self.high is not None and self.low > self.high:
            raise ValueError("reference range low cannot exceed high")
        if (
            self.age_min_years is not None
            and self.age_max_years is not None
            and self.age_min_years > self.age_max_years
        ):
            raise ValueError("age_min_years cannot exceed age_max_years")
        return self


class Interpretation(BaseModel):
    """Plain-language meaning of an out-of-range result in one direction."""

    direction: Direction
    meaning: str = Field(..., min_length=1, description="What this direction can indicate.")
    common_causes: list[str] = Field(default_factory=list)
    typical_next_steps: list[str] = Field(default_factory=list)


class BiomarkerBrief(BaseModel):
    """One clinically-approved biomarker entry, ready to embed and retrieve."""

    # --- identity (controlled) ---
    biomarker_name: str = Field(..., min_length=1, description="Canonical display name, e.g. 'HbA1c'.")
    aliases: list[str] = Field(
        default_factory=list,
        description="Synonyms users may search, e.g. ['glycated haemoglobin', 'A1c'].",
    )
    category: Category
    keywords: list[str] = Field(
        default_factory=list,
        description="Retrieval boosters: lay terms / conditions, e.g. ['diabetes','blood sugar'].",
    )

    # --- clinical payload (approved content) ---
    summary: str = Field(..., min_length=1, description="One-paragraph plain-language overview.")
    what_it_measures: str = Field(..., min_length=1)
    reference_ranges: list[ReferenceRange] = Field(..., min_length=1)
    interpretations: list[Interpretation] = Field(default_factory=list)
    when_to_seek_help: Optional[str] = Field(
        None, description="Red-flag guidance. Vera should surface this verbatim."
    )

    # --- governance / provenance (consistency + GDPR friendly) ---
    status: Status = Status.draft
    source_brief_id: str = Field(..., description="Stable id of the approved source brief.")
    approved_by: Optional[str] = Field(None, description="Clinician / reviewer who signed off.")
    approval_date: Optional[date] = None
    last_updated: date
    language: str = Field("en-GB", description="BCP-47 tag. Panel is UK English by default.")
    region: str = Field("UK", description="Jurisdiction the reference ranges apply to.")
    schema_version: str = Field(SCHEMA_VERSION)

    @field_validator("biomarker_name", "source_brief_id")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @model_validator(mode="after")
    def _approval_consistency(self) -> "BiomarkerBrief":
        # A clinically-approved entry must name who approved it and when — no anonymous sign-off.
        if self.status == Status.clinically_approved:
            if not self.approved_by or self.approval_date is None:
                raise ValueError(
                    "clinically_approved entries require both approved_by and approval_date"
                )
        return self

    # ---------- derived artefacts ----------

    @staticmethod
    def _slug(text: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")

    def vector_id(self) -> str:
        """Deterministic id: same source brief -> same id -> upsert overwrites, never duplicates."""
        basis = f"{self._slug(self.source_brief_id)}::{self._slug(self.biomarker_name)}"
        digest = hashlib.md5(basis.encode("utf-8")).hexdigest()[:12]
        return f"bm-{self._slug(self.biomarker_name)}-{digest}"

    def content_hash(self) -> str:
        """Hash of the meaningful payload. Lets ingest skip unchanged entries on re-run."""
        payload = self.model_dump(mode="json", exclude={"last_updated"})
        canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def embedding_text(self) -> str:
        """
        The ONLY text we vectorise. Built from semantic content (names, synonyms, meaning),
        deliberately excluding governance fields so they don't pollute similarity.
        """
        parts = [
            f"Biomarker: {self.biomarker_name}",
            f"Also known as: {', '.join(self.aliases)}" if self.aliases else "",
            f"Category: {self.category.value}",
            f"Keywords: {', '.join(self.keywords)}" if self.keywords else "",
            f"What it measures: {self.what_it_measures}",
            f"Summary: {self.summary}",
        ]
        for interp in self.interpretations:
            parts.append(f"When {interp.direction.value}: {interp.meaning}")
        if self.when_to_seek_help:
            parts.append(f"When to seek help: {self.when_to_seek_help}")
        return "\n".join(p for p in parts if p)

    def to_metadata(self) -> dict:
        """
        Flattened metadata for Pinecone. Pinecone allows only str / number / bool / list[str],
        so nested objects are JSON-encoded into `payload_json` and the human-facing answer is
        pre-rendered into `answer_text`. Scalar fields stay native so they can be HARD-FILTERED.
        """
        return {
            "biomarker_name": self.biomarker_name,
            "category": self.category.value,
            "status": self.status.value,
            "language": self.language,
            "region": self.region,
            "keywords": self.keywords,
            "aliases": self.aliases,
            "source_brief_id": self.source_brief_id,
            "schema_version": self.schema_version,
            "content_hash": self.content_hash(),
            "answer_text": self.answer_text(),
            "payload_json": self.model_dump_json(),
        }

    def answer_text(self) -> str:
        """Pre-rendered, citation-ready text Vera can quote. Keeps clinical wording intact."""
        lines = [f"{self.biomarker_name} ({self.category.value})", "", self.summary, ""]
        lines.append("Reference ranges:")
        for r in self.reference_ranges:
            bound = []
            if r.low is not None:
                bound.append(f">= {r.low}")
            if r.high is not None:
                bound.append(f"<= {r.high}")
            ctx = []
            if r.sex != Sex.any:
                ctx.append(r.sex.value)
            if r.note:
                ctx.append(r.note)
            ctx_s = f" ({', '.join(ctx)})" if ctx else ""
            lines.append(f"  - {' and '.join(bound) or 'see note'} {r.unit}{ctx_s}")
        for interp in self.interpretations:
            lines.append("")
            lines.append(f"If {interp.direction.value}: {interp.meaning}")
            if interp.common_causes:
                lines.append(f"  Common causes: {', '.join(interp.common_causes)}")
            if interp.typical_next_steps:
                lines.append(f"  Typical next steps: {', '.join(interp.typical_next_steps)}")
        if self.when_to_seek_help:
            lines += ["", f"When to seek help: {self.when_to_seek_help}"]
        return "\n".join(lines)


def load_brief(path: str) -> BiomarkerBrief:
    with open(path, "r", encoding="utf-8") as f:
        return BiomarkerBrief.model_validate_json(f.read())


if __name__ == "__main__":
    # Emit the JSON Schema so reviewers can see the contract without reading Python.
    print(json.dumps(BiomarkerBrief.model_json_schema(), indent=2, ensure_ascii=False))
