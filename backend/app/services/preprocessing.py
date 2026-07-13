"""
Preprocessing Service — Phase 2 Revisions.

Handles:
1. EXIF orientation correction (via PIL/Pillow).
2. Constraining contour detection within the expanded Region of Interest (ROI) hint.
3. OpenCV booklet cover contour detection.
4. Validation checks (Area >= 20%, Aspect Ratio 1.2–1.7, Brightness Variance >= 15.0).
5. Four-point perspective warp.
6. Deskewing (residual small tilt correction).
7. Contrast enhancement (CLAHE).
8. Graceful fallback on detection/validation failures with debug logging.
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Tuple, Optional

import cv2
import numpy as np
from PIL import Image, ImageOps

logger = logging.getLogger("sipar.preprocessing")


# ─── Perspective Warp Helpers ────────────────────────────────────────────────

def order_points(pts: np.ndarray) -> np.ndarray:
    """
    Orders a list of 4 coordinate points in the order:
    [top-left, top-right, bottom-right, bottom-left].
    """
    rect = np.zeros((4, 2), dtype="float32")
    # Top-left has the smallest sum, bottom-right has the largest sum
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]

    # Top-right has the smallest difference, bottom-left has the largest difference
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]

    return rect


def four_point_transform(image: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """
    Performs a 4-point perspective warp to extract a flat, front-on view of the
    region defined by coordinates `pts`.
    """
    rect = order_points(pts)
    (tl, tr, br, bl) = rect

    # Compute width of the new image
    width_a = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    width_b = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    max_width = max(int(width_a), int(width_b))

    # Compute height of the new image
    height_a = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    height_b = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    max_height = max(int(height_a), int(height_b))

    # Destination points for the warped perspective
    dst = np.array([
        [0, 0],
        [max_width - 1, 0],
        [max_width - 1, max_height - 1],
        [0, max_height - 1]
    ], dtype="float32")

    # Compute warp matrix and apply it
    transform_matrix = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, transform_matrix, (max_width, max_height))


# ─── Deskew Helper ───────────────────────────────────────────────────────────

def deskew_image(image: np.ndarray) -> np.ndarray:
    """
    Detects small residual rotation tilts using the text binarization lines
    and rotates the image if the angle falls between 0.5 and 10.0 degrees.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]

    # Grab coords of all non-zero pixels
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) == 0:
        return image

    angle = cv2.minAreaRect(coords)[-1]

    # Normalise angle to [-45, 45] range
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    # Rotate only if rotation is noticeable but within bounds of residual skew
    if 0.5 <= abs(angle) <= 10.0:
        (h, w) = image.shape[:2]
        center = (w // 2, h // 2)
        rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
        return cv2.warpAffine(
            image,
            rotation_matrix,
            (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE
        )

    return image


# ─── Contrast Helper ──────────────────────────────────────────────────────────

def enhance_contrast_clahe(image: np.ndarray) -> np.ndarray:
    """
    Applies Contrast Limited Adaptive Histogram Equalization (CLAHE) on the L-channel
    in LAB color space to make handwriting more legible across varying lighting.
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l_channel)

    enhanced_lab = cv2.merge((cl, a_channel, b_channel))
    return cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)


# ─── Contour Finder with ROI Constraint & Validation Checks ───────────────────

def find_booklet_contour(
    image: np.ndarray,
    search_area_rect: Tuple[int, int, int, int]
) -> np.ndarray | None:
    """
    Finds the largest 4-sided contour inside the designated bounding box
    of the image (defined by search_area_rect: x, y, width, height).
    """
    sx, sy, sw, sh = search_area_rect
    cropped_search = image[sy : sy + sh, sx : sx + sw]

    # Resize crop to constant height for consistent Edge/Canny behavior
    ch, cw = cropped_search.shape[:2]
    if ch == 0 or cw == 0:
        return None

    ratio = ch / 500.0
    resized = cv2.resize(cropped_search, (int(cw / ratio), 500))

    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 75, 200)

    contours, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)

        if len(approx) == 4:
            # Map points back to original image scale
            pts_cropped = approx.reshape(4, 2) * ratio

            # Translate points back to full image coordinate system
            pts_full = pts_cropped + np.array([sx, sy])
            return pts_full.astype(np.int32)

    return None


def validate_contour(
    image: np.ndarray,
    pts: np.ndarray,
    search_area_rect: Tuple[int, int, int, int]
) -> Tuple[bool, Optional[str], Optional[np.ndarray]]:
    """
    Enforces three sanity validation checks on the candidate booklet contour:
    1. Area: Bounding box area >= 20% of search area.
    2. Aspect Ratio: Ratio of max to min dimension of bounding box is between 1.2 and 1.7 (A4 ratio tolerance).
    3. Brightness Variance: The warped crop's pixel standard deviation >= 15.0 (rejects flat bezels/shadows).
    """
    _, _, sw, sh = search_area_rect
    search_area = sw * sh

    # Bounding rectangle of the contour points
    cx, cy, cw, ch = cv2.boundingRect(pts)
    contour_rect_area = cw * ch

    # Check 1: Area Check (reject small keyboard keys/clutter)
    area_fraction = contour_rect_area / search_area
    if area_fraction < 0.20:
        return False, f"area_too_small (contour area is {area_fraction:.1%} of search area, expected >= 20%)", None

    # Check 2: Aspect Ratio Check (A4 is 1.41)
    aspect_ratio = max(cw, ch) / min(cw, ch)
    if not (1.2 <= aspect_ratio <= 1.7):
        return False, f"invalid_aspect_ratio ({aspect_ratio:.2f}, expected between 1.2 and 1.7)", None

    # Perform temporary warp to verify contents
    try:
        warped = four_point_transform(image, pts)
        gray_warped = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
        std_dev = np.std(gray_warped)

        # Check 3: Brightness Variance check
        if std_dev < 15.0:
            return False, f"low_brightness_variance (std dev is {std_dev:.2f}, expected >= 15.0; likely background shadow/bezel)", None

        return True, None, warped
    except Exception as e:
        return False, f"transform_error ({str(e)})", None


# ─── Main Pipeline ────────────────────────────────────────────────────────────

def preprocess_image(
    input_path: str,
    output_path: str,
    roi: Tuple[float, float, float, float] | None = None
) -> Tuple[str, Optional[str]]:
    """
    Applies the booklet image preprocessing pipeline.

    Args:
        input_path: Path of uploaded original image.
        output_path: Destination path for preprocessed image.
        roi: Optional normalized ROI coordinates (x, y, w, h) as fractions (0.0-1.0) of preview dimension.

    Returns:
        A tuple of (preprocessing_status, preprocessing_debug_reason)
        preprocessing_status can be: "success" | "fallback"
    """
    input_p = Path(input_path)
    output_p = Path(output_path)
    output_p.parent.mkdir(parents=True, exist_ok=True)

    # ── 1. Correct EXIF Orientation first (using PIL) ────────────────────────
    try:
        pil_img = Image.open(input_p)
        pil_img = ImageOps.exif_transpose(pil_img)
        cv_img = np.array(pil_img)
        if len(cv_img.shape) == 3:
            cv_img = cv2.cvtColor(cv_img, cv2.COLOR_RGB2BGR)
    except Exception as e:
        logger.error(f"Failed to load image or apply EXIF correction: {e}")
        shutil.copy2(input_p, output_p)
        return "fallback", f"exif_transpose_failed ({str(e)})"

    fallback_img = cv_img.copy()
    img_h, img_w = cv_img.shape[:2]

    # ── 2. Determine Search Region (ROI Constraints) ─────────────────────────
    # We default to the full image coordinates as the active search region
    search_rect = (0, 0, img_w, img_h)
    using_roi = False

    if roi is not None:
        rx, ry, rw, rh = roi
        # Translate fractions to absolute pixel coordinates
        abs_x = int(rx * img_w)
        abs_y = int(ry * img_h)
        abs_w = int(rw * img_w)
        abs_h = int(rh * img_h)

        # Expand ROI by 15% margin on all directions per Issue 3 spec
        margin_x = int(abs_w * 0.15)
        margin_y = int(abs_h * 0.15)

        x1 = max(0, abs_x - margin_x)
        y1 = max(0, abs_y - margin_y)
        x2 = min(img_w, abs_x + abs_w + margin_x)
        y2 = min(img_h, abs_y + abs_h + margin_y)

        expanded_w = x2 - x1
        expanded_h = y2 - y1

        if expanded_w > 0 and expanded_h > 0:
            search_rect = (x1, y1, expanded_w, expanded_h)
            using_roi = True

    # ── 3. Find Contour ───────────────────────────────────────────────────────
    pts = None
    debug_reason = None

    if using_roi:
        logger.info(f"Searching for booklet contour inside expanded ROI: {search_rect}")
        pts = find_booklet_contour(cv_img, search_rect)
        if pts is not None:
            # Validate contour found inside ROI
            ok, reason, warped_crop = validate_contour(cv_img, pts, search_rect)
            if ok and warped_crop is not None:
                # Valid booklet contour found inside the ROI constraint!
                try:
                    # Apply deskew + contrast to crop
                    deskewed = deskew_image(warped_crop)
                    processed = enhance_contrast_clahe(deskewed)
                    cv2.imwrite(str(output_p), processed)
                    logger.info("Booklet cropped successfully from ROI.")
                    return "success", None
                except Exception as e:
                    debug_reason = f"processing_failed ({str(e)})"
            else:
                debug_reason = f"ROI candidate failed: {reason}"
                logger.info(f"Contour inside ROI failed sanity checks: {reason}. Falling back to full image search.")
                pts = None

    # If ROI search fails, fall back to searching the full image
    if pts is None:
        logger.info("Searching full image for booklet contour.")
        full_rect = (0, 0, img_w, img_h)
        pts = find_booklet_contour(cv_img, full_rect)

        if pts is not None:
            ok, reason, warped_crop = validate_contour(cv_img, pts, full_rect)
            if ok and warped_crop is not None:
                try:
                    deskewed = deskew_image(warped_crop)
                    processed = enhance_contrast_clahe(deskewed)
                    cv2.imwrite(str(output_p), processed)
                    logger.info("Booklet cropped successfully from full image.")
                    return "success", None
                except Exception as e:
                    debug_reason = f"processing_failed ({str(e)})"
            else:
                debug_reason = f"Full image candidate failed: {reason}"
        else:
            debug_reason = "no_4_sided_contour_found" if not debug_reason else debug_reason

    # If all searches / validations fail, apply deskew + contrast enhancement on the fallback image itself
    # so that the resulting uploaded booklet scan is still straightened and highly legible for Claude.
    logger.warning(f"Preprocessing fallback triggered. Reason: {debug_reason}")
    try:
        deskewed = deskew_image(fallback_img)
        processed = enhance_contrast_clahe(deskewed)
        cv2.imwrite(str(output_p), processed)
        logger.info("Fallback image deskewed and contrast enhanced successfully.")
    except Exception as e:
        logger.error(f"Failed to process fallback image ({e}). Writing un-processed fallback image.")
        cv2.imwrite(str(output_p), fallback_img)

    return "fallback", debug_reason
