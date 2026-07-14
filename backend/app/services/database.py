"""
SQLite Database utility layer — Durable Sets.
"""
import os
import json
import sqlite3
from pathlib import Path
from typing import Optional, List
from datetime import datetime, timezone
from app.models.schemas import SubmissionRecord, ExtractionResult, ValidationResult

DB_DIR = Path(__file__).parent.parent.parent / "data"

# Database separation: use environment variable DATABASE_PATH if set (e.g. during local tests)
# otherwise fall back to standard data/app.db (used in production on Render).
DATABASE_PATH_ENV = os.environ.get("DATABASE_PATH")
if DATABASE_PATH_ENV:
    DB_FILE = Path(DATABASE_PATH_ENV)
else:
    DB_FILE = DB_DIR / "app.db"


def init_db():
    """Initializes the SQLite database schema if not already set up."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_FILE))
    cursor = conn.cursor()

    # Drop old session tables if they exist to perform clean migration to Sets
    cursor.execute("DROP TABLE IF EXISTS sessions")
    
    # Check if submissions has the old schema (has session_id instead of set_id)
    cursor.execute("PRAGMA table_info(submissions)")
    cols = [col[1] for col in cursor.fetchall()]
    if cols and "session_id" in cols:
        cursor.execute("DROP TABLE IF EXISTS submissions")

    # Create sets table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sets (
            set_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            name TEXT,
            status TEXT NOT NULL
        )
    """)

    # Create submissions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            submission_id TEXT PRIMARY KEY,
            set_id TEXT,
            original_filename TEXT NOT NULL,
            saved_path TEXT NOT NULL,
            content_type TEXT NOT NULL,
            upload_timestamp TEXT NOT NULL,
            status TEXT NOT NULL,
            preprocessing_status TEXT NOT NULL,
            processed_image_path TEXT,
            preprocessing_debug_reason TEXT,
            extraction_status TEXT NOT NULL,
            extraction_result TEXT, -- JSON String
            extraction_error TEXT,
            validation_status TEXT NOT NULL,
            validation_result TEXT, -- JSON String
            review_status TEXT NOT NULL,
            export_status TEXT NOT NULL,
            roi_x REAL,
            roi_y REAL,
            roi_w REAL,
            roi_h REAL,
            FOREIGN KEY (set_id) REFERENCES sets (set_id)
        )
    """)

    conn.commit()
    conn.close()


def get_db_connection():
    """Returns a SQLite connection with Row factory set."""
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    return conn


def create_set(set_id: str, name: Optional[str] = None):
    """Inserts a new set record if set_id is not already registered."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM sets WHERE set_id = ?", (set_id,))
    if not cursor.fetchone():
        created_at = datetime.now(timezone.utc).isoformat()
        cursor.execute(
            "INSERT INTO sets (set_id, created_at, name, status) VALUES (?, ?, ?, ?)",
            (set_id, created_at, name or f"Set {created_at[:10]}", "active"),
        )
        conn.commit()
    conn.close()


def get_set(set_id: str) -> Optional[dict]:
    """Retrieves set details by set_id."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sets WHERE set_id = ?", (set_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def list_sets() -> List[dict]:
    """Lists all sets, sorted by created_at DESC, including row count of confirmed submissions."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.set_id, s.name, s.created_at, s.status,
               (SELECT COUNT(*) FROM submissions sub 
                WHERE sub.set_id = s.set_id AND sub.review_status = 'confirmed') as row_count
        FROM sets s
        ORDER BY s.created_at DESC
    """)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def save_submission(record: SubmissionRecord, set_id: str):
    """Inserts or overwrites a SubmissionRecord in the submissions database table."""
    # Ensure set exists first
    create_set(set_id)

    conn = get_db_connection()
    cursor = conn.cursor()

    ext_res_str = (
        json.dumps(record.extraction_result.model_dump())
        if record.extraction_result
        else None
    )
    val_res_str = (
        json.dumps(record.validation_result.model_dump())
        if record.validation_result
        else None
    )

    cursor.execute(
        """
        INSERT OR REPLACE INTO submissions (
            submission_id, set_id, original_filename, saved_path, content_type,
            upload_timestamp, status, preprocessing_status, processed_image_path,
            preprocessing_debug_reason, extraction_status, extraction_result,
            extraction_error, validation_status, validation_result, review_status,
            export_status, roi_x, roi_y, roi_w, roi_h
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record.submission_id,
            set_id,
            record.original_filename,
            record.saved_path,
            record.content_type,
            record.upload_timestamp,
            record.status,
            record.preprocessing_status,
            record.processed_image_path,
            record.preprocessing_debug_reason,
            record.extraction_status,
            ext_res_str,
            record.extraction_error,
            record.validation_status,
            val_res_str,
            record.review_status,
            record.export_status,
            record.roi_x,
            record.roi_y,
            record.roi_w,
            record.roi_h,
        ),
    )
    conn.commit()
    conn.close()


def get_submission(submission_id: str) -> Optional[SubmissionRecord]:
    """Retrieves a SubmissionRecord from database by ID, or None if not found."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM submissions WHERE submission_id = ?", (submission_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    ext_data = None
    if row["extraction_result"]:
        ext_data = ExtractionResult(**json.loads(row["extraction_result"]))

    val_data = None
    if row["validation_result"]:
        val_data = ValidationResult(**json.loads(row["validation_result"]))

    return SubmissionRecord(
        submission_id=row["submission_id"],
        original_filename=row["original_filename"],
        saved_path=row["saved_path"],
        content_type=row["content_type"],
        upload_timestamp=row["upload_timestamp"],
        status=row["status"],
        preprocessing_status=row["preprocessing_status"],
        processed_image_path=row["processed_image_path"],
        preprocessing_debug_reason=row["preprocessing_debug_reason"],
        extraction_status=row["extraction_status"],
        extraction_result=ext_data,
        extraction_error=row["extraction_error"],
        validation_status=row["validation_status"],
        validation_result=val_data,
        review_status=row["review_status"],
        export_status=row["export_status"],
        roi_x=row["roi_x"],
        roi_y=row["roi_y"],
        roi_w=row["roi_w"],
        roi_h=row["roi_h"],
    )


def get_set_submissions(set_id: str, confirmed_only: bool = False) -> List[SubmissionRecord]:
    """Loads all submissions associated with the specified set."""
    conn = get_db_connection()
    cursor = conn.cursor()
    if confirmed_only:
        cursor.execute(
            "SELECT * FROM submissions WHERE set_id = ? AND review_status = 'confirmed'",
            (set_id,),
        )
    else:
        cursor.execute("SELECT * FROM submissions WHERE set_id = ?", (set_id,))

    rows = cursor.fetchall()
    conn.close()

    records = []
    for row in rows:
        ext_data = None
        if row["extraction_result"]:
            ext_data = ExtractionResult(**json.loads(row["extraction_result"]))

        val_data = None
        if row["validation_result"]:
            val_data = ValidationResult(**json.loads(row["validation_result"]))

        records.append(
            SubmissionRecord(
                submission_id=row["submission_id"],
                original_filename=row["original_filename"],
                saved_path=row["saved_path"],
                content_type=row["content_type"],
                upload_timestamp=row["upload_timestamp"],
                status=row["status"],
                preprocessing_status=row["preprocessing_status"],
                processed_image_path=row["processed_image_path"],
                preprocessing_debug_reason=row["preprocessing_debug_reason"],
                extraction_status=row["extraction_status"],
                extraction_result=ext_data,
                extraction_error=row["extraction_error"],
                validation_status=row["validation_status"],
                validation_result=val_data,
                review_status=row["review_status"],
                export_status=row["export_status"],
                roi_x=row["roi_x"],
                roi_y=row["roi_y"],
                roi_w=row["roi_w"],
                roi_h=row["roi_h"],
            )
        )
    return records


def get_set_confirmed_count(set_id: str) -> int:
    """Returns the count of reviewed/confirmed booklets in this set."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM submissions WHERE set_id = ? AND review_status = 'confirmed'",
        (set_id,),
    )
    count = cursor.fetchone()[0]
    conn.close()
    return count


def delete_set(set_id: str):
    """
    Deletes the set record from SQLite database along with all its submissions.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM submissions WHERE set_id = ?", (set_id,))
    cursor.execute("DELETE FROM sets WHERE set_id = ?", (set_id,))
    conn.commit()
    conn.close()

