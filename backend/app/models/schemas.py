"""
Pydantic schemas for SIPAR.

Phase 0: stubs only.
Phase 1: added SubmissionRecord + SubmissionResponse for the upload endpoint.
"""
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------

class MarksEntry(BaseModel):
    """A single answered sub-part: question number, part letter, and marks."""
    question_no: int = Field(..., ge=1, le=8, description="Question number (1–8)")
    part: str = Field(..., pattern=r"^[a-d]$", description="Sub-part letter (a–d)")
    marks: float = Field(..., ge=0, description="Marks awarded for this sub-part")


class QuestionTotal(BaseModel):
    """The examiner-written total for a question (used for cross-check)."""
    question_no: int = Field(..., ge=1, le=8)
    total: float = Field(..., ge=0)


class FieldConfidence(BaseModel):
    """Extraction confidence levels for key header fields."""
    name: Literal["high", "medium", "low"] = "medium"
    roll_no: Literal["high", "medium", "low"] = "medium"


# ---------------------------------------------------------------------------
# Primary extraction schema
# ---------------------------------------------------------------------------

class ExtractionResult(BaseModel):
    """
    Structured output returned by the Claude vision extraction step.
    Matches the target JSON schema defined in the project brief.
    """
    name: str
    roll_no: str
    branch: str
    subject: str
    date: str

    # Only sub-parts that contain a handwritten mark — blank/struck rows omitted.
    marks_entries: list[MarksEntry] = Field(default_factory=list)

    # Examiner-written per-question totals (right column on the sheet).
    question_totals: list[QuestionTotal] = Field(default_factory=list)

    # Grand total handwritten at the bottom of the sheet.
    total_marks_declared: Optional[float] = None

    field_confidence: FieldConfidence = Field(default_factory=FieldConfidence)


# ---------------------------------------------------------------------------
# API response wrappers (Phase 1)
# ---------------------------------------------------------------------------

class ExtractionResponse(BaseModel):
    """Wraps ExtractionResult with a record ID after MongoDB insert."""
    record_id: str
    data: ExtractionResult


class ValidationStatus(BaseModel):
    """Result of arithmetic cross-check (Phase 1)."""
    per_question_ok: bool
    grand_total_ok: bool
    mismatches: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Submission models (Phase 1) — upload tracking
# ---------------------------------------------------------------------------

class SubmissionRecord(BaseModel):
    """Record stored in-memory after an image is uploaded."""
    submission_id: str
    original_filename: str
    saved_path: str  # Absolute path on disk inside backend/uploads/
    content_type: str
    upload_timestamp: str  # ISO-8601 UTC string
    status: Literal["received", "processing", "done", "error"] = "received"


class SubmissionResponse(BaseModel):
    """Response body for POST /submissions (HTTP 201)."""
    submission_id: str
    status: str
