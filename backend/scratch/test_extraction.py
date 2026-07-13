import sys
import json
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).resolve().parents[4] / "Downloads" / "Development" / "SIPAR" / "backend"
sys.path.append(str(backend_path))

from app.models.schemas import ExtractionResult

# ── Mock payload with markdown blocks ───────────────────────────────────────
mock_raw_response_with_fences = """
Here is the JSON object you requested:
```json
{
  "name": "Jane Doe",
  "roll_no": "CS2026-99",
  "branch": "Computer Science",
  "subject": "Distributed Systems",
  "date": "2026-07-13",
  "marks_entries": [
    {"question_no": 1, "part": "a", "marks": 4.5},
    {"question_no": 1, "part": "b", "marks": 5.0}
  ],
  "question_totals": [
    {"question_no": 1, "total": 9.5}
  ],
  "total_marks_declared": 9.5,
  "field_confidence": {
    "name": "high",
    "roll_no": "low"
  }
}
```
Hope this helps!
"""

def clean_and_parse_json(raw_content: str) -> ExtractionResult:
    # Emulate the defensive parsing logic from extraction.py
    cleaned_json = raw_content.strip()
    
    # Locate markdown code block boundaries if present
    if "```json" in cleaned_json:
        start_idx = cleaned_json.find("```json") + 7
        end_idx = cleaned_json.find("```", start_idx)
        cleaned_json = cleaned_json[start_idx:end_idx].strip()
    elif "```" in cleaned_json:
        start_idx = cleaned_json.find("```") + 3
        end_idx = cleaned_json.find("```", start_idx)
        cleaned_json = cleaned_json[start_idx:end_idx].strip()
        
    parsed_data = json.loads(cleaned_json)
    return ExtractionResult(**parsed_data)

print("Testing defensive JSON parsing with markdown code fences...")
result = clean_and_parse_json(mock_raw_response_with_fences)

print("Parsed Name:", result.name)
print("Parsed Roll No:", result.roll_no)
print("Parsed Confidence (Roll No):", result.field_confidence.roll_no)

assert result.name == "Jane Doe"
assert result.roll_no == "CS2026-99"
assert result.field_confidence.roll_no == "low"
assert len(result.marks_entries) == 2
assert result.marks_entries[0].marks == 4.5

print("Defensive parsing test passed! ✅")
