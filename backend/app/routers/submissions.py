"""
Submissions router — Phase 1.

Handles image upload (POST /submissions) and record retrieval
(GET /submissions/{submission_id}).

Storage strategy for Phase 1: in-memory dict (process-scoped).
MongoDB integration is deferred to a later phase.
"""
from __future__ import annotations

from typing import Optional


import uuid
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.models.schemas import SubmissionRecord, SubmissionResponse, ExtractionResult, ValidationResult, SetCreateRequest, SetResponse
import logging

logger = logging.getLogger(__name__)

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
    set_id: str = Form(..., description="ID of the destination scan set"),
    roi_x: Optional[float] = Form(None, description="Normalized X coordinate of the guide rectangle"),
    roi_y: Optional[float] = Form(None, description="Normalized Y coordinate of the guide rectangle"),
    roi_w: Optional[float] = Form(None, description="Normalized width of the guide rectangle"),
    roi_h: Optional[float] = Form(None, description="Normalized height of the guide rectangle"),
) -> SubmissionResponse:
    """
    Accept a multipart image upload, validate it, persist it to disk, and
    return a submission record with a generated UUID. Also associates with a set_id
    and registers in SQLite app.db database.
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

    # ── 5. Store record in SQLite database ────────────────────────────────────
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
    from app.services.database import save_submission
    save_submission(record, set_id)

    return SubmissionResponse(submission_id=submission_id, status="received")



# ---------------------------------------------------------------------------
# Durable Sets Management
# ---------------------------------------------------------------------------

@router.post(
    "/sets",
    status_code=status.HTTP_201_CREATED,
    response_model=SetResponse,
    summary="Create a new scan set",
)
async def create_new_set(payload: SetCreateRequest) -> SetResponse:
    """
    Creates a new named set for accumulating confirmed booklet submissions.
    """
    from app.services.database import create_set, get_set
    set_id = str(uuid.uuid4())
    create_set(set_id, payload.name)
    set_data = get_set(set_id)
    if not set_data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve created set details."
        )
    return SetResponse(
        set_id=set_data["set_id"],
        name=set_data["name"],
        created_at=set_data["created_at"],
        status=set_data["status"],
        row_count=0,
    )


@router.get(
    "/sets",
    response_model=list[SetResponse],
    summary="List all scan sets",
)
async def get_sets_list() -> list[SetResponse]:
    """
    Returns all scan sets sorted by created_at DESC, including row count.
    """
    from app.services.database import list_sets
    sets_data = list_sets()
    return [
        SetResponse(
            set_id=s["set_id"],
            name=s["name"],
            created_at=s["created_at"],
            status=s["status"],
            row_count=s["row_count"],
        )
        for s in sets_data
    ]


@router.get(
    "/sets/{set_id}/download",
    summary="Download Excel spreadsheet for a specific set",
)
async def download_set_excel(set_id: str):
    """
    Serves the exports/{set_id}.xlsx file as a downloadable response.
    """
    from app.services.database import get_set
    from fastapi.responses import FileResponse
    from pathlib import Path
    
    set_data = get_set(set_id)
    if not set_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Set not found"
        )
        
    EXPORT_DIR = Path(__file__).parent.parent.parent / "exports"
    set_file_path = EXPORT_DIR / f"{set_id}.xlsx"
    
    if not set_file_path.exists():
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Marks Records"
        ws.append([
            "Name", "Roll No", "Branch", "Subject", "Date", 
            "Marks Breakdown", "Total Marks", "Validation Status"
        ])
        wb.save(set_file_path)

    sanitized_name = set_data["name"].replace("/", "_").replace("\\", "_")
    return FileResponse(
        path=str(set_file_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"{sanitized_name}.xlsx",
    )


@router.get(
    "/sets/{set_id}/status",
    summary="Get status and details of a scan set",
)
async def get_set_status(set_id: str):
    """
    Returns metadata and count of confirmed booklets for a scan set.
    """
    from app.services.database import get_set, get_set_confirmed_count
    set_data = get_set(set_id)
    if not set_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Set not found"
        )
    count = get_set_confirmed_count(set_id)
    return {
        "set_id": set_id,
        "name": set_data.get("name"),
        "created_at": set_data.get("created_at"),
        "status": set_data.get("status"),
        "confirmed_count": count,
    }



@router.get(
    "/sets/{set_id}/rows",
    summary="Get confirmed row records for a scan set",
)
async def get_set_rows(set_id: str):
    """
    Returns Name, Roll No, Total Marks, and Validation Status for all confirmed booklets.
    """
    from app.services.database import get_set, get_set_submissions
    set_data = get_set(set_id)
    if not set_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Set not found"
        )
    
    submissions = get_set_submissions(set_id, confirmed_only=True)
    rows = []
    for sub in submissions:
        name = "Unknown"
        roll_no = "Unknown"
        total_marks = 0.0
        val_status = "Valid"
        
        if sub.extraction_result:
            name = sub.extraction_result.name or "Unknown"
            roll_no = sub.extraction_result.roll_no or "Unknown"
            total_marks = sub.extraction_result.total_marks_declared
            if total_marks is None:
                total_marks = 0.0
        
        if sub.validation_result:
            val_status = sub.validation_result.overall_status or "Valid"
        
        rows.append({
            "submission_id": sub.submission_id,
            "name": name,
            "roll_no": roll_no,
            "total_marks": total_marks,
            "validation_status": val_status
        })
    return rows


@router.delete(
    "/sets/{set_id}",
    summary="Delete a set and its associated submissions/spreadsheets",
)
async def delete_scan_set(set_id: str):
    """
    Removes the Set record from the database, its submissions, and deletes its .xlsx file.
    """
    from app.services.database import get_set, delete_set
    from pathlib import Path
    
    set_data = get_set(set_id)
    if not set_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Set not found"
        )
    
    # 1. Delete database tables entries
    delete_set(set_id)
    
    # 2. Delete Excel file from disk if it exists
    EXPORT_DIR = Path(__file__).parent.parent.parent / "exports"
    set_file_path = EXPORT_DIR / f"{set_id}.xlsx"
    try:
        if set_file_path.exists():
            set_file_path.unlink()
    except Exception as e:
        logger.error(f"Failed to delete Excel sheet on disk for set {set_id}: {e}")
        
    return {"status": "success", "message": f"Set '{set_data['name']}' deleted successfully."}


@router.get(
    "/{submission_id}",
    response_model=SubmissionRecord,
    summary="Retrieve a submission record",
)
async def get_submission(submission_id: str) -> SubmissionRecord:
    """Return the stored record from SQLite database for the given ID, or 404."""
    from app.services.database import get_submission as db_get_submission
    record = db_get_submission(submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )
    return record


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
    # ── 1. Fetch record ────────────────--------------------------------------
    from app.services.database import get_submission, save_submission, get_db_connection
    record = get_submission(submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )

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

    # Build ROI tuple if coordinates exist (Phases 1-2 backwards compatibility)
    roi = None
    if all(v is not None for v in (record.roi_x, record.roi_y, record.roi_w, record.roi_h)):
        roi = (record.roi_x, record.roi_y, record.roi_w, record.roi_h)

    # In Phase 3 (revisions), the mobile app uploads an image pre-cropped to the ROI.
    # Therefore, we pass roi=None to run contour detection directly on the cropped bounds.
    status_result, debug_reason = preprocess_image(input_path, str(processed_path), None)

    # ── 4. Update SQLite database record ──────────────────────────────────────
    record.preprocessing_status = status_result
    record.preprocessing_debug_reason = debug_reason
    record.processed_image_path = str(processed_path)
    record.status = "processing" if status_result == "success" else "error" if status_result == "fallback" else record.status

    # Retrieve associated set_id first to satisfy FK constraint
    conn = get_db_connection()
    row = conn.execute("SELECT set_id FROM submissions WHERE submission_id = ?", (submission_id,)).fetchone()
    set_id = row["set_id"] if row else "unknown"
    conn.close()

    save_submission(record, set_id)

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
    from app.services.database import get_submission
    record = get_submission(submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )

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


# ---------------------------------------------------------------------------
# Extraction Endpoints (Phase 3)
# ---------------------------------------------------------------------------

@router.post(
    "/{submission_id}/extract",
    response_model=SubmissionRecord,
    summary="Extract marks details from preprocessed cover page",
)
async def extract_submission_details(submission_id: str) -> SubmissionRecord:
    """
    Triggers the Anthropic Claude Vision extraction step on the preprocessed cover page
    (or falls back to the original if preprocessing fell back).
    Defensively handles parsing/validation errors and sets error codes accordingly.
    """
    # ── 1. Fetch record ────────────────--------------------------------------
    from app.services.database import get_submission, save_submission, get_db_connection
    record = get_submission(submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )

    # ── 2. Determine target image file for extraction ────────────────────────
    # Use preprocessed image if available, else original EXIF-corrected upload
    image_path = record.processed_image_path
    if not image_path or not os.path.exists(image_path):
        image_path = record.saved_path

    if not os.path.exists(image_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Booklet image file not found on disk.",
        )

    # ── 3. Run Claude Vision Extraction ──────────────────────────────────────
    # Import service locally
    from app.services.extraction import extract_details_from_booklet

    try:
        extraction_result = extract_details_from_booklet(
            image_path=image_path,
            media_type=record.content_type
        )
        record.extraction_status = "success"
        record.extraction_result = extraction_result
        record.extraction_error = None
        record.status = "done"
    except Exception as e:
        record.extraction_status = "failed"
        record.extraction_result = None
        record.extraction_error = str(e)
        record.status = "error"

    # ── 4. Save updated record in SQLite database ─────────────────────────────
    conn = get_db_connection()
    row = conn.execute("SELECT set_id FROM submissions WHERE submission_id = ?", (submission_id,)).fetchone()
    set_id = row["set_id"] if row else "unknown"
    conn.close()

    save_submission(record, set_id)

    return record


@router.get(
    "/{submission_id}/extraction",
    summary="Get the extraction result details",
)
async def get_extraction_result(submission_id: str):
    """
    Returns only the structured extraction JSON payload or error status
    for simplified verification.
    """
    from app.services.database import get_submission
    record = get_submission(submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )

    return {
        "submission_id": submission_id,
        "extraction_status": record.extraction_status,
        "extraction_result": record.extraction_result,
        "extraction_error": record.extraction_error,
    }


# ---------------------------------------------------------------------------
# Validation Endpoints (Phase 4)
# ---------------------------------------------------------------------------

@router.post(
    "/{submission_id}/validate",
    response_model=SubmissionRecord,
    summary="Compute arithmetic validation on extracted marks data",
)
async def validate_submission_data(submission_id: str) -> SubmissionRecord:
    """
    Runs the arithmetic checks on the extracted booklet marks data.
    Requires extraction_status to be 'success'.
    """
    from app.services.database import get_submission, save_submission, get_db_connection
    record = get_submission(submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )

    if record.extraction_status != "success" or not record.extraction_result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot validate submission data: Details extraction is not in 'success' state.",
        )

    # Run the validation
    from app.services.validation import validate_extraction_result

    try:
        validation_result = validate_extraction_result(record.extraction_result)
        record.validation_status = "success"
        record.validation_result = validation_result
    except Exception as e:
        record.validation_status = "failed"
        record.validation_result = None
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Validation computation failed: {str(e)}",
        )

    # Save to SQLite database
    conn = get_db_connection()
    row = conn.execute("SELECT set_id FROM submissions WHERE submission_id = ?", (submission_id,)).fetchone()
    set_id = row["set_id"] if row else "unknown"
    conn.close()

    save_submission(record, set_id)
    return record


@router.get(
    "/{submission_id}/validation",
    summary="Get stored validation result",
)
async def get_validation_result(submission_id: str):
    """
    Returns only the structured validation result.
    """
    from app.services.database import get_submission
    record = get_submission(submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )

    return {
        "submission_id": submission_id,
        "validation_status": record.validation_status,
        "validation_result": record.validation_result,
    }


# ---------------------------------------------------------------------------
# Phase 5 Corrections / Preview validation endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/validate/preview",
    response_model=ValidationResult,
    summary="Stateless preview validation of extraction result shaped payload",
)
async def preview_validation(data: ExtractionResult) -> ValidationResult:
    """
    Runs the arithmetic validation checks on a preview extraction data payload
    without saving to the stored submission. Used during interactive editing on client.
    """
    from app.services.validation import validate_extraction_result
    return validate_extraction_result(data)


@router.put(
    "/{submission_id}/extraction",
    response_model=SubmissionRecord,
    summary="Overwrite the stored extraction_result with corrected version",
)
async def update_extraction_result(submission_id: str, data: ExtractionResult) -> SubmissionRecord:
    """
    Overwrites the stored extraction_result with teacher edits, re-computes validation,
    sets review_status to 'confirmed', performs disk cleanup of uploaded and preprocessed images,
    and saves to database.
    """
    from app.services.database import get_submission, save_submission, get_db_connection
    record = get_submission(submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Submission '{submission_id}' not found.",
        )

    # Overwrite extraction_result and mark extraction success
    record.extraction_result = data
    record.extraction_status = "success"

    # Re-run validation using the pure function
    from app.services.validation import validate_extraction_result
    validation_res = validate_extraction_result(data)
    record.validation_status = "success"
    record.validation_result = validation_res

    # Mark review status confirmed
    record.review_status = "confirmed"

    # ── Phase 7: Physical Image Files Disk Cleanup ───────────────────────────
    # Delete original upload file
    if record.saved_path and os.path.exists(record.saved_path):
        try:
            os.remove(record.saved_path)
            logger.info(f"Disk Cleanup: Deleted original image at {record.saved_path}")
        except Exception as ex:
            logger.error(f"Failed to delete original image at {record.saved_path}: {ex}")

    # Delete preprocessed crop file
    if record.processed_image_path and os.path.exists(record.processed_image_path):
        try:
            os.remove(record.processed_image_path)
            logger.info(f"Disk Cleanup: Deleted preprocessed image at {record.processed_image_path}")
        except Exception as ex:
            logger.error(f"Failed to delete preprocessed image at {record.processed_image_path}: {ex}")

    # Retrieve associated set_id to save
    conn = get_db_connection()
    row = conn.execute("SELECT set_id FROM submissions WHERE submission_id = ?", (submission_id,)).fetchone()
    set_id = row["set_id"] if row else "unknown"
    conn.close()

    # Save to SQLite database
    save_submission(record, set_id)

    # Append row directly to set's spreadsheet exports/{set_id}.xlsx immediately
    if set_id != "unknown":
        from app.services.excel_export import append_row_to_set_excel
        try:
            append_row_to_set_excel(set_id, record)
            record.export_status = "exported"
            save_submission(record, set_id)
        except Exception as e:
            logger.error(f"Failed to append row to set Excel for set {set_id}: {e}")

    return record







