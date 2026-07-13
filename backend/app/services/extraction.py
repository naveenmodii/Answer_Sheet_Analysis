"""
Extraction Service — Phase 3.

Calls the Anthropic Claude API using the official SDK (claude-sonnet-5)
with base64-encoded image input to perform structured extraction of booklet metadata,
marks table, and confidence assessment.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from pathlib import Path

import anthropic
from anthropic import APIStatusError, APITimeoutError, APIConnectionError

from app.models.schemas import ExtractionResult

logger = logging.getLogger("sipar.extraction")


# ─── System & User Prompt templates ──────────────────────────────────────────

SYSTEM_PROMPT = """
You are an expert OCR and data extraction system specialized in reading handwritten exam answer booklet cover sheets.
You will receive an image of the booklet cover page. Your task is to extract the student details, per-subquestion marks table, per-question examiner totals, and declared grand total.

Output ONLY a raw, valid JSON object matching the requested schema.
Do NOT wrap your response in markdown fences (like ```json ... ```).
Do NOT include any introduction, explanation, or conversational text.
If any required field is completely illegible or missing, represent it as an empty string.

Target JSON Schema:
{
  "name": "string",
  "roll_no": "string",
  "branch": "string",
  "subject": "string",
  "date": "string",
  "marks_entries": [
    {"question_no": 1, "part": "a", "marks": 5}
  ],
  "question_totals": [
    {"question_no": 1, "total": 10}
  ],
  "total_marks_declared": 44.5,
  "field_confidence": {
    "name": "high | medium | low",
    "roll_no": "high | medium | low"
  }
}
"""

USER_PROMPT = """
Analyze the attached answer booklet cover page and extract the following details according to these strict rules:

1. Student Metadata:
   - Extract "name", "roll_no", "branch", "subject", and "date".

2. Marks Table Grid:
   - The marks grid contains up to 8 questions (1-8) and up to 4 sub-parts (a, b, c, d) per question.
   - ONLY include entries in "marks_entries" that have a handwritten number/score.
   - Skip empty questions, blank rows, and sub-parts struck through with a dash or left blank entirely. Do NOT record them as null or zero; omit them completely from the array.
   - Marks can be fractional (e.g. 4.5).

3. Question Totals:
   - The examiner writes a total score per question in the dedicated "Total" column on the right side of the grid.
   - Extract these values exactly as written by the examiner in "question_totals". Do NOT calculate the sums yourself; transcribe the handwritten value.

4. Grand Total:
   - Extract the grand total handwritten at the bottom of the booklet page into "total_marks_declared".

5. Field Confidence Assessment:
   - Evaluate your own visual uncertainty for "name" and "roll_no".
   - Return "high" if the writing is clear and easy to read.
   - Return "medium" or "low" if the handwriting is blurry, messy, overlapping, or ambiguous. Be honest about uncertainty.
"""


# ─── Helper: Image Base64 Encoder ─────────────────────────────────────────────

def _encode_image_to_base64(image_path: str) -> str:
    """Read a local file and return its base64 encoded representation."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


# ─── Extraction Function ──────────────────────────────────────────────────────

def extract_details_from_booklet(
    image_path: str,
    media_type: str = "image/jpeg"
) -> ExtractionResult:
    """
    Sends the cover booklet image to Claude Sonnet 5 for structured details
    extraction and parses the response defensively.

    Raises:
        ValueError: If JSON parsing or Pydantic validation fails.
        RuntimeError: If the Anthropic API returns a billing, rate limit, or client error.
    """
    # ── 1. Fetch API Key from environment ─────────────────────────────────────
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY is not set in the environment variables.")
        raise RuntimeError("API key is not configured. Please check your backend environment.")

    # Normalize media type (Claude expects image/jpeg, image/png, image/gif, or image/webp)
    if "png" in media_type.lower():
        anthropic_media_type = "image/png"
    else:
        anthropic_media_type = "image/jpeg"

    # ── 2. Encode image to Base64 ─────────────────────────────────────────────
    try:
        base64_data = _encode_image_to_base64(image_path)
    except Exception as e:
        logger.error(f"Failed to read/encode image at {image_path}: {e}")
        raise RuntimeError(f"Failed to load image for extraction: {str(e)}")

    # ── 3. Initialize Client & Make Call ──────────────────────────────────────
    try:
        client = anthropic.Anthropic(api_key=api_key)
        logger.info(f"Sending vision extraction request for {Path(image_path).name} to claude-sonnet-5...")

        response = client.messages.create(
            model="claude-sonnet-5",
            max_tokens=1500,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": anthropic_media_type,
                                "data": base64_data,
                            },
                        },
                        {
                            "type": "text",
                            "text": USER_PROMPT
                        }
                    ],
                }
            ],
        )
    except APITimeoutError:
        logger.error("Anthropic API request timed out.")
        raise RuntimeError("Request timed out. Please try again.")
    except APIConnectionError as e:
        logger.error(f"Anthropic network connection failed: {e}")
        raise RuntimeError("Network error. Unable to establish connection to Anthropic servers.")
    except APIStatusError as e:
        logger.error(f"Anthropic API returned status code {e.status_code}: {e.message}")
        if e.status_code == 401:
            raise RuntimeError("Invalid Anthropic API Key. Please verify plans & billing setup.")
        elif e.status_code == 429:
            raise RuntimeError("Anthropic rate limit exceeded. Please wait a moment before retrying.")
        else:
            raise RuntimeError(f"Anthropic API error ({e.status_code}): {e.message}")
    except Exception as e:
        logger.error(f"Unexpected error during Anthropic API call: {e}")
        raise RuntimeError(f"Unexpected API error: {str(e)}")

    # ── 4. Parse Response Content Defensively ─────────────────────────────────
    raw_content = ""
    try:
        # Extract response text
        if response.content and len(response.content) > 0:
            raw_content = response.content[0].text.strip()
        else:
            raise ValueError("Empty response received from Claude.")

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

        # Parse JSON
        parsed_data = json.loads(cleaned_json)

        # Validate with Pydantic schema
        result = ExtractionResult(**parsed_data)
        logger.info(f"Successful extraction completion for {Path(image_path).name}")
        return result

    except json.JSONDecodeError as e:
        logger.error(f"JSON decode failed. Raw payload:\n{raw_content}\nError: {e}")
        raise ValueError("Failed to parse extraction output. The response was not valid JSON.")
    except Exception as e:
        logger.error(f"Data validation failed: {e}. Raw content:\n{raw_content}")
        raise ValueError(f"Extracted details did not match the target booklet schema: {str(e)}")
