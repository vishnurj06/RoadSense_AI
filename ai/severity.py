"""Severity estimation.

Shared by detect.py (batch) and infer_service.py (live) so the two can never disagree.
Person A owns this decision end-to-end — the backend stores whatever this returns and
never recomputes it (Contract v2 §3.3).
"""

HIGH_AREA_RATIO = 0.08
MEDIUM_AREA_RATIO = 0.03


def severity_from_bbox(bbox, img_w, img_h):
    """Classify severity from the fraction of the frame the detection occupies.

    Crude: bbox area is a poor proxy for depth, and a distant large pothole looks
    identical to a nearby small one. Task A-5 replaces this with monocular depth.
    """
    x1, y1, x2, y2 = bbox
    area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    ratio = area / float(img_w * img_h)

    if ratio > HIGH_AREA_RATIO:
        return "high"
    if ratio > MEDIUM_AREA_RATIO:
        return "medium"
    return "low"
