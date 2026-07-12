"""
Submissions router — Phase 1.

Handles image upload (POST /submissions) and record retrieval
(GET /submissions/{submission_id}).

Storage strategy for Phase 1: in-memory dict (process-scoped).
MongoDB integration is deferred to a later phase.
"""
from __future__ import annotations

import uuid
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.models.schemas import SubmissionRecord, SubmissionResponse

router = APIRouter(prefix="/submissions", tags=["Submissions"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Path to the uploads directory (relative to the backend/ root, resolved once).
UPLOADS_DIR = Path(__file__).resolve().parents[2] / "uploads"

MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB

ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
}

# ---------------------------------------------------------------------------
# In-memory store  (Phase 1 — replaced with MongoDB in a later phase)
# ---------------------------------------------------------------------------

_submissions: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_uploads_dir() -> None:
    """Create the uploads directory if it does not exist yet."""
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=SubmissionResponse,
    summary="Upload a booklet cover image",
)
async def create_submission(
    image: UploadFile = File(..., description="JPEG or PNG image of the booklet cover"),
) -> SubmissionResponse:
    """
    Accept a multipart image upload, validate it, persist it to disk, and
    return a submission record with a generated UUID.

    Validations:
    - Content-Type must be image/jpeg or image/png (HTTP 415).
    - File size must not exceed 15 MB (HTTP 413).
    """
    # ── 1. Validate content type ─────────────────────────────────────────────
    content_type = (image.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Unsupported media type '{content_type}'. "
                "Only image/jpeg and image/png are accepted."
            ),
        )

    # ── 2. Read and size-check ───────────────────────────────────────────────
    file_bytes = await image.read()
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"File size {len(file_bytes):,} bytes exceeds the 15 MB limit."
            ),
        )

    # ── 3. Generate UUID + derive filename ───────────────────────────────────
    submission_id = str(uuid.uuid4())
    extension = ALLOWED_CONTENT_TYPES[content_type]
    filename = f"{submission_id}{extension}"

    # ── 4. Persist to disk ───────────────────────────────────────────────────
    _ensure_uploads_dir()
    saved_path = UPLOADS_DIR / filename
    saved_path.write_bytes(file_bytes)

    # ── 5. Store record in memory ─────────────────────────────────────────────
    original_filename = image.filename or "unknown"
    record = SubmissionRecord(
        submission_id=submission_id,
        original_filename=original_filename,
        saved_path=str(saved_path),
        content_type=content_type,
        upload_timestamp=datetime.now(timezone.utc).isoformat(),
        status="received",
    )
    _submissions[submission_id] = record.model_dump()

    return SubmissionResponse(submission_id=submission_id, status="received")


@router.get(
    "/{submission_id}",
    response_model=SubmissionRecord,
    summary="Retrieve a submission record",
)
async def get_submission(submission_id: str) -> SubmissionRecord:
    """Return the stored record for the given submission ID, or 404."""
    record = _submissions.get(submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )
    return SubmissionRecord(**record)
