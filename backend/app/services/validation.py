"""
Arithmetic Validation Service — Phase 4

Cross-checks extracted marks data:
1. Consistency check: Flag gaps (questions with sub-marks but no declared total, or vice versa).
2. Question-level check: Verify sum of sub-question marks matches the declared question total.
3. Grand-total check: Verify sum of question totals matches the declared grand total score.
"""
from typing import Optional
from app.models.schemas import (
    ExtractionResult,
    ValidationResult,
    QuestionValidation,
    GrandTotalValidation,
)

TOLERANCE = 0.01


def validate_extraction_result(data: ExtractionResult) -> ValidationResult:
    """
    Computes arithmetic cross-checks and consistency audits on extracted marks.
    Runs locally, fast, and deterministic.
    """
    issues = []
    question_level_results = []

    # ── 1. Consistency Checks (List Gaps) ────────────────────────────────────
    # Extract unique question numbers present in subparts vs declared totals
    marks_qs = {entry.question_no for entry in data.marks_entries}
    declared_qs = {q.question_no for q in data.question_totals}

    # Find inconsistencies
    for q_no in marks_qs - declared_qs:
        issues.append(
            f"Question {q_no}: Sub-marks entries are present, but no declared question total cell was found."
        )

    for q_no in declared_qs - marks_qs:
        issues.append(
            f"Question {q_no}: Declared total cell of {next(q.total for q in data.question_totals if q.question_no == q_no)} exists, but no sub-marks entries were found."
        )

    # Determine initial overall status
    has_gaps = len(marks_qs - declared_qs) > 0 or len(declared_qs - marks_qs) > 0
    overall_status = "incomplete" if has_gaps else "valid"

    # ── 2. Question-Level Checks ─────────────────────────────────────────────
    # Check all declared question totals
    for q in sorted(data.question_totals, key=lambda x: x.question_no):
        q_no = q.question_no
        declared_total = q.total

        # Sum sub-part marks for this question
        sub_marks = [entry.marks for entry in data.marks_entries if entry.question_no == q_no]
        computed_sum = float(sum(sub_marks))

        # Check difference using tolerance
        diff = abs(computed_sum - declared_total)
        match = diff <= TOLERANCE

        if not match:
            overall_status = "mismatch" if overall_status == "valid" else overall_status
            issues.append(
                f"Question {q_no}: sub-marks sum to {computed_sum:.1f} but declared total is {declared_total:.1f}"
            )

        question_level_results.append(
            QuestionValidation(
                question_no=q_no,
                computed_sum=computed_sum,
                declared_total=declared_total,
                match=match,
            )
        )

    # ── 3. Grand-Total Check ──────────────────────────────────────────────────
    # Sum the declared question totals
    computed_grand_total = float(sum(q.total for q in data.question_totals))
    declared_grand_total = data.total_marks_declared

    if declared_grand_total is None:
        # If grand total is not detected, it is flagged as mismatch/incomplete
        match_grand = False
        overall_status = "mismatch" if overall_status == "valid" else overall_status
        issues.append(
            f"Grand Total: declared grand total is missing (not detected), but computed sum of questions is {computed_grand_total:.1f}"
        )
        declared_val = 0.0
    else:
        diff_grand = abs(computed_grand_total - declared_grand_total)
        match_grand = diff_grand <= TOLERANCE
        if not match_grand:
            overall_status = "mismatch" if overall_status == "valid" else overall_status
            issues.append(
                f"Grand Total: question totals sum to {computed_grand_total:.1f} but declared grand total is {declared_grand_total:.1f}"
            )
        declared_val = declared_grand_total

    grand_total_result = GrandTotalValidation(
        computed_sum=computed_grand_total,
        declared_total=declared_val,
        match=match_grand,
    )

    return ValidationResult(
        overall_status=overall_status,
        question_level=question_level_results,
        grand_total=grand_total_result,
        issues=issues,
    )
