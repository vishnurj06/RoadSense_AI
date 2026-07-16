<<<<<<< HEAD
"""Severity estimation (task A-5).
=======
"""Severity estimation.
>>>>>>> origin/feat/ai-phase2

Shared by detect.py (batch) and infer_service.py (live) so the two can never disagree.
Person A owns this decision end-to-end — the backend stores whatever this returns and
never recomputes it (Contract v2 §3.3).
<<<<<<< HEAD

WHY THIS IS NOT JUST BBOX AREA
------------------------------
The previous version classified on raw bbox area / frame area. Measured against 81
real detections from `potholevideos.mp4`, that heuristic had **corr(depth, area) =
+0.711**: its buckets were an almost perfect ladder of *how close the camera was*
(mean vertical position: low 0.19 → medium 0.37 → high 0.68), not of how bad the
pothole was. The same pothole scored "low" from far away and "high" from up close.
That is worthless for prioritising repairs.

THE CORRECTION
--------------
Assume the pothole lies on a flat road plane (true by definition). For a pinhole
camera, the depth Z of image row y scales as

    Z  ~  1 / (y - y_horizon)

and an object of real area A at depth Z projects to an apparent area

    a  ~  A / Z^2      =>      A  ~  a * Z^2  ~  a / (y - y_horizon)^2

So dividing the apparent area by the squared distance-below-horizon of the bbox's
**bottom edge** (where the pothole meets the road) recovers a proxy that is
invariant to how far away the camera was. Measured: this drops the depth
correlation from +0.711 to **-0.157** — a 78% reduction in distance bias.

LIMITS — READ BEFORE TRUSTING A NUMBER
--------------------------------------
* The score is proportional to real area, but the constant depends on the camera's
  focal length and mounting height, which we do not know. So the score is
  **relative, not metric** — it cannot say "this pothole is 30 cm across".
* Thresholds below are therefore calibrated (tertiles) on 81 real detections from
  `potholevideos.mp4`. They mean "worst third of what that camera saw", not an
  absolute engineering standard. **Recalibrate per camera** via the env vars.
* `SEVERITY_HORIZON_Y` must match the camera or the correction is wrong. Default
  0.0 suits road footage shot looking down (the horizon is at/above the frame top).
  For a dashcam with the skyline visible mid-frame, set it to ~0.5.
* A real metric answer needs monocular depth (MiDaS / Depth-Anything) or camera
  calibration. That remains the upgrade path.
"""

import os

# Horizon row as a fraction of image height (0.0 = top of frame).
# MUST match the camera geometry — see LIMITS above.
HORIZON_Y = float(os.getenv("SEVERITY_HORIZON_Y", "0.0"))

# Score thresholds. Tertiles of 81 real detections (see module docstring).
HIGH_SCORE = float(os.getenv("SEVERITY_HIGH_SCORE", "0.357"))
MEDIUM_SCORE = float(os.getenv("SEVERITY_MEDIUM_SCORE", "0.208"))

# Near the horizon, depth explodes and the proxy becomes numerically meaningless.
# Clamp so a detection at the vanishing point cannot report infinite severity.
MIN_DEPTH_FRACTION = 0.05


def severity_score(bbox, img_w, img_h):
    """Distance-invariant size proxy. Higher = physically bigger pothole.

    Relative, not metric — see LIMITS in the module docstring.
    """
    x1, y1, x2, y2 = bbox
    area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_fraction = area / float(img_w * img_h)

    # Bottom edge = the road-contact point, so it is the right row for depth.
    depth_fraction = max((y2 / float(img_h)) - HORIZON_Y, MIN_DEPTH_FRACTION)

    return area_fraction / (depth_fraction * depth_fraction)


def severity_from_bbox(bbox, img_w, img_h):
    """Classify a detection as low / medium / high.

    Signature is unchanged from the bbox-area version, so model.py, detect.py and
    infer_service.py need no edits — Contract v2 §3.3 is untouched.
    """
    score = severity_score(bbox, img_w, img_h)

    if score > HIGH_SCORE:
        return "high"
    if score > MEDIUM_SCORE:
=======
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
>>>>>>> origin/feat/ai-phase2
        return "medium"
    return "low"
