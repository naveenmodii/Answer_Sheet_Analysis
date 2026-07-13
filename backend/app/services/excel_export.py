"""
Excel Export Service — Durable Sets.

Appends confirmed booklet rows directly to the set's spreadsheet file exports/{set_id}.xlsx.
"""
import os
from pathlib import Path
from openpyxl import Workbook, load_workbook
from app.models.schemas import SubmissionRecord

EXPORT_DIR = Path(__file__).parent.parent.parent / "exports"


def append_row_to_set_excel(set_id: str, record: SubmissionRecord) -> str:
    """
    Appends one row representing the confirmed student grades to exports/{set_id}.xlsx.
    Creates the workbook with headers if it doesn't already exist.
    """
    if not record.extraction_result:
        raise ValueError("Cannot export submission: extraction_result is empty.")

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    set_file = EXPORT_DIR / f"{set_id}.xlsx"

    headers = [
        "Name",
        "Roll No",
        "Branch",
        "Subject",
        "Date",
        "Marks Breakdown",
        "Total Marks",
        "Validation Status",
    ]

    # Load or create workbook
    if not set_file.exists():
        wb = Workbook()
        ws = wb.active
        ws.title = "Marks Records"
        ws.append(headers)
    else:
        wb = load_workbook(set_file)
        ws = wb.active

    # Format the Marks Breakdown string (e.g. "1a-5, 1b-5, 2a-4")
    ext = record.extraction_result
    marks_str = ", ".join(
        f"{entry.question_no}{entry.part}-{entry.marks}"
        for entry in sorted(ext.marks_entries, key=lambda x: (x.question_no, x.part))
    )

    # Determine validation status
    val_status = "Discrepancy noted"
    if record.validation_result and record.validation_result.overall_status == "valid":
        val_status = "Valid"

    # Assemble row data
    row_data = [
        ext.name,
        ext.roll_no,
        ext.branch,
        ext.subject,
        ext.date,
        marks_str,
        ext.total_marks_declared,
        val_status,
    ]

    # Append and save
    ws.append(row_data)
    wb.save(set_file)
    return str(set_file)
