"""
Preprocessing Service — Phase 2.

Handles:
1. EXIF orientation correction (via PIL/Pillow).
2. OpenCV image conversion & document contour detection.
3. Four-point perspective warp.
4. Deskewing (residual small tilt correction).
5. Contrast enhancement (CLAHE).
6. Graceful fallback on detection failure.
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Tuple

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
    warped = cv2.warpPerspective(image, transform_matrix, (max_width, max_height))
    return warped


# ─── Deskew Helper ───────────────────────────────────────────────────────────

def deskew_image(image: np.ndarray) -> np.ndarray:
    """
    Detects small residual rotation tilts using the text binarization lines
    and rotates the image if the angle falls between 0.5 and 10.0 degrees.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Threshold to binary (invert because text is dark on light background)
    gray = cv2.bitwise_not(gray)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]

    # Grab coords of all non-zero pixels
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) == 0:
        return image

    # Compute minimum area bounding box containing all non-zero pixels
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
        rotated = cv2.warpAffine(
            image,
            rotation_matrix,
            (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE
        )
        logger.info(f"Deskewing applied: corrected residual tilt of {angle:.2f} degrees")
        return rotated

    return image


# ─── Contrast Helper ──────────────────────────────────────────────────────────

def enhance_contrast_clahe(image: np.ndarray) -> np.ndarray:
    """
    Applies Contrast Limited Adaptive Histogram Equalization (CLAHE) on the L-channel
    in LAB color space to make handwriting more legible across varying lighting.
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    # Apply CLAHE to L (luminance) channel
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l_channel)

    # Merge channels and convert back to BGR
    enhanced_lab = cv2.merge((cl, a_channel, b_channel))
    return cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)


# ─── Main Pipeline ────────────────────────────────────────────────────────────

def preprocess_image(input_path: str, output_path: str) -> str:
    """
    Applies the full booklet image preprocessing pipeline:
    1. EXIF orientation correction (crucial so OpenCV raw matrix is upright).
    2. Contour detection of the booklet cover page.
    3. Perspective transformation (4-point warp).
    4. Deskewing of small-angle rotation.
    5. CLAHE adaptive contrast normalization.

    If booklet boundaries cannot be found or warped, falls back to copying
    the EXIF-corrected original image.

    Returns:
        "success" if perspective correction worked,
        "fallback" if we used the EXIF-corrected original image directly.
    """
    input_p = Path(input_path)
    output_p = Path(output_path)
    output_p.parent.mkdir(parents=True, exist_ok=True)

    # ── 1. Correct EXIF Orientation first (using PIL) ────────────────────────
    # Photos from phones contain EXIF orientation data. OpenCV's imread reads raw
    # pixel arrays ignoring this tag, which commonly causes portrait photos to load
    # sideways/upside-down. Correcting it via ImageOps before conversion fixes this.
    try:
        pil_img = Image.open(input_p)
        pil_img = ImageOps.exif_transpose(pil_img)
        # Convert PIL image to BGR numpy array
        cv_img = np.array(pil_img)
        if len(cv_img.shape) == 3:
            # PIL loads RGB, OpenCV needs BGR
            cv_img = cv2.cvtColor(cv_img, cv2.COLOR_RGB2BGR)
    except Exception as e:
        logger.error(f"Failed to load image or apply EXIF correction: {e}")
        # Fatal loading error, fallback copy
        shutil.copy2(input_p, output_p)
        return "fallback"

    # We now have the upright, EXIF-corrected original image. Keep a copy in memory
    # as our fallback baseline.
    fallback_img = cv_img.copy()

    # ── 2. Booklet Contour Detection ──────────────────────────────────────────
    try:
        # Resize image slightly to keep contour detection properties consistent
        # across different camera resolutions
        h, w = cv_img.shape[:2]
        ratio = h / 500.0
        resized = cv2.resize(cv_img, (int(w / ratio), 500))

        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edged = cv2.Canny(blurred, 75, 200)

        # Find contours
        contours, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

        screen_cnt = None
        for c in contours:
            # Approximate the contour
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)

            # A 4-sided contour is likely our booklet cover page boundary
            if len(approx) == 4:
                screen_cnt = approx
                break

        if screen_cnt is None:
            raise ValueError("No 4-sided document contour found.")

        # ── 3. Four-point Perspective Warp ────────────────────────────────────
        # Multiply points back to original image scale
        pts = screen_cnt.reshape(4, 2) * ratio
        warped = four_point_transform(cv_img, pts)

        # ── 4. Deskew ─────────────────────────────────────────────────────────
        deskewed = deskew_image(warped)

        # ── 5. Contrast Enhancement ───────────────────────────────────────────
        processed = enhance_contrast_clahe(deskewed)

        # ── 6. Save Processed Image ───────────────────────────────────────────
        cv2.imwrite(str(output_p), processed)
        logger.info(f"Booklet preprocessing succeeded for {input_p.name}")
        return "success"

    except Exception as e:
        logger.warning(
            f"Preprocessing failed for {input_p.name} ({e}). "
            "Falling back to original EXIF-corrected image."
        )
        # Save the EXIF-corrected baseline image as fallback
        cv2.imwrite(str(output_p), fallback_img)
        return "fallback"
