"""Privacy blur — redact faces and licence plates before storing images (code item #5).

Street imagery captures pedestrians' faces and vehicle number plates = personal data.
Under privacy law (India's DPDP Act, GDPR, …) that cannot be stored freely. This module
blurs those regions **before** an uploaded image reaches object storage.

Gated by the `PRIVACY_BLUR` env var (default OFF) per the Phase-4 decision: *build now,
enable before launch, don't block private testing on our own footage.* Inference runs on
the ORIGINAL (clear) image; only the stored copy is redacted.

Detector: OpenCV **Haar cascades**, which ship bundled with opencv — so there are NO
separate weight files (this sidesteps the gitignored-weights problem that bites the YOLO
model). ⚠️ This is a **BASIC, best-effort** detector: frontal faces only, and a
region-specific plate cascade. It is NOT production-grade anonymisation — the upgrade
path is a DNN face/plate model. Documented so nobody mistakes it for a compliance guarantee.

**Fail-closed:** `blur_faces_and_plates` raises on any error. The caller must let that
propagate rather than store an un-redacted image — a privacy control that silently no-ops
is worse than none.
"""

import logging
import os

logger = logging.getLogger(__name__)

# Cached (face, plate) classifiers — loaded lazily so importing this module never
# fails in a minimal environment without opencv.
_cascades = None


def is_blur_enabled() -> bool:
    """True if privacy blurring is switched on (read live so tests can toggle it)."""
    return os.getenv("PRIVACY_BLUR", "0") == "1"


def _load_cascades():
    global _cascades
    if _cascades is not None:
        return _cascades
    import cv2

    base = cv2.data.haarcascades
    face = cv2.CascadeClassifier(base + "haarcascade_frontalface_default.xml")
    plate = cv2.CascadeClassifier(base + "haarcascade_russian_plate_number.xml")
    if face.empty() or plate.empty():
        raise RuntimeError(
            "privacy blur: Haar cascade XML not found — opencv installed without data?"
        )
    _cascades = (face, plate)
    return _cascades


def _encode_ext(content_type: str | None, filename: str | None) -> str:
    """Pick an imencode extension that preserves the original format where possible."""
    if content_type == "image/png" or (filename or "").lower().endswith(".png"):
        return ".png"
    if content_type == "image/webp" or (filename or "").lower().endswith(".webp"):
        return ".webp"
    return ".jpg"


def blur_faces_and_plates(
    image_bytes: bytes,
    content_type: str | None = None,
    filename: str | None = None,
) -> bytes:
    """Return *image_bytes* with detected faces and plates Gaussian-blurred.

    Re-encodes even when nothing is detected. Raises on any failure (fail-closed):
    the caller must not store the image if this cannot complete.
    """
    import cv2
    import numpy as np

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("privacy blur: could not decode image bytes")

    face_cc, plate_cc = _load_cascades()
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    regions = list(
        face_cc.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
        )
    )
    regions += list(
        plate_cc.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 15)
        )
    )

    for x, y, w, h in regions:
        roi = img[y : y + h, x : x + w]
        if roi.size == 0:
            continue
        # Kernel scales with region size and must be odd; strong enough to redact.
        k = max(11, (w // 3) | 1)
        img[y : y + h, x : x + w] = cv2.GaussianBlur(roi, (k, k), 0)

    ext = _encode_ext(content_type, filename)
    ok, out = cv2.imencode(ext, img)
    if not ok:
        raise RuntimeError(f"privacy blur: re-encode to {ext} failed")

    if regions:
        logger.info("privacy blur: redacted %d region(s)", len(regions))
    return out.tobytes()
