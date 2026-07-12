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

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

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
    roi_x: float | None = Form(None, description="Normalized X coordinate of the guide rectangle"),
    roi_y: float | None = Form(None, description="Normalized Y coordinate of the guide rectangle"),
    roi_w: float | None = Form(None, description="Normalized width of the guide rectangle"),
    roi_h: float | None = Form(None, description="Normalized height of the guide rectangle"),
) -> SubmissionResponse:
    """
    Accept a multipart image upload, validate it, persist it to disk, and
    return a submission record with a generated UUID. Also accepts optional
    Region of Interest (ROI) fractional coordinates of the camera visual guide.

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
        roi_x=roi_x,
        roi_y=roi_y,
        roi_w=roi_w,
        roi_h=roi_h,
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


# ---------------------------------------------------------------------------
# Preprocessing Endpoints (Phase 2)
# ---------------------------------------------------------------------------

@router.post(
    "/{submission_id}/preprocess",
    response_model=SubmissionRecord,
    summary="Preprocess a booklet cover image",
)
async def preprocess_submission(submission_id: str) -> SubmissionRecord:
    """
    Triggers the booklet preprocessing pipeline on the uploaded image.
    Crops, aligns, deskews, and enhances contrast.
    """
    # ── 1. Fetch record ──────────────────────────────────────────────────────
    record_dict = _submissions.get(submission_id)
    if record_dict is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )

    record = SubmissionRecord(**record_dict)

    # ── 2. Derive output paths ───────────────────────────────────────────────
    input_path = record.saved_path
    if not os.path.exists(input_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Original upload file not found on disk at {input_path}.",
        )

    extension = os.path.splitext(input_path)[1] or ".jpg"
    processed_dir = UPLOADS_DIR / "processed"
    processed_dir.mkdir(parents=True, exist_ok=True)
    processed_path = processed_dir / f"{submission_id}{extension}"

    # ── 3. Run Preprocessing Pipeline ────────────────────────────────────────
    # Import locally to avoid startup dependencies
    from app.services.preprocessing import preprocess_image

    # Build ROI tuple if coordinates exist
    roi = None
    if all(v is not None for v in (record.roi_x, record.roi_y, record.roi_w, record.roi_h)):
        roi = (record.roi_x, record.roi_y, record.roi_w, record.roi_h)

    status_result, debug_reason = preprocess_image(input_path, str(processed_path), roi)

    # ── 4. Update memory store record ────────────────────────────────────────
    record.preprocessing_status = status_result
    record.preprocessing_debug_reason = debug_reason
    record.processed_image_path = str(processed_path)
    record.status = "processing" if status_result == "success" else "error" if status_result == "fallback" else record.status

    # Keep original status but update preprocessing specifics
    _submissions[submission_id] = record.model_dump()

    return record


@router.get(
    "/{submission_id}/preprocessed",
    summary="Get the preprocessed image file",
)
async def get_preprocessed_image(submission_id: str):
    """
    Returns the preprocessed image file. Falls back to returning the
    EXIF-corrected original image if preprocessing failed/fell back.
    """
    record_dict = _submissions.get(submission_id)
    if record_dict is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )

    record = SubmissionRecord(**record_dict)

    # Determine which file to serve
    if record.processed_image_path and os.path.exists(record.processed_image_path):
        image_to_serve = record.processed_image_path
    else:
        # Fall back to original upload
        image_to_serve = record.saved_path

    if not os.path.exists(image_to_serve):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image file not found on disk.",
        )

    # Return the file as response
    from fastapi.responses import FileResponse
    return FileResponse(image_to_serve, media_type=record.content_type)

