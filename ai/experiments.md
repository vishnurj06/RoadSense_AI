# Training log

Every training run gets a row. Metrics come from Ultralytics' validation split.

| run | base | epochs | imgsz | device | precision | recall | mAP50 | mAP50-95 |
|---|---|---|---|---|---|---|---|---|
| `train-2` (baseline, current `best.pt`) | yolov8n | 12 | 416 | CPU | 0.588 | 0.542 | **0.556** | 0.239 |
| `v2-2` (in progress) | yolov8s | 100 | 640 | T4 GPU | ? | ? | ? | ? |

**Phase-2 target: mAP50 ≥ 0.75.** The PRD's precision ≥95% / recall ≥90% is a Phase-3/4 goal — it
needs far more data than the 1,230 images we have, not more epochs.

---

## Behaviour of the baseline model on real dashcam footage

Measured over the 57 extracted frames from `dashcam.mp4` (`ai/test_images/`), using local
inference — **not** the Roboflow hosted API.

| conf threshold | detections | frames with a hit |
|---|---|---|
| ≥ 0.50 | 0 | 0 / 57 |
| ≥ 0.40 | 0 | 0 / 57 |
| ≥ 0.30 | 2 | 2 / 57 |
| ≥ 0.25 | 2 | 2 / 57 |
| ≥ 0.15 | 6 | 6 / 57 |
| ≥ 0.10 | 17 | 12 / 57 |
| ≥ 0.05 | 54 | 28 / 57 |

**The model's highest confidence on any of the 57 frames is 0.369.** It is not merely
under-confident — the two surviving detections have bboxes with `y1 = 0.0` spanning most of the
frame, which is not a plausible pothole shape. They are almost certainly false positives.

Consequences:
- `CONF_THRESHOLD` is set to `0.25` **as a temporary measure** so the pipeline produces visible
  output. It is not a defensible threshold; it is a placeholder.
- Do **not** quote these detections as evidence the model works. They are not.
- This is exactly why the GPU retrain (12 epochs → 100 epochs, 416px → 640px, yolov8n → yolov8s)
  matters. Compare against this table when it lands.

## Comparison with the Phase-1 Roboflow hosted API

The 57 committed JSONs in `ai/outputs/` (produced in Phase 1 via `detect.roboflow.com`) contain
**12 detections**, at confidences from ~0.41 upward. Our own 12-epoch checkpoint cannot reach 0.4
at all on the same frames.

So the Phase-1 demo was carried entirely by **someone else's trained model**. Our own model has
never yet been the thing producing results. Closing that gap is task A-2.

## After the next run

1. Put the new `best.pt` in `ai/weights/`.
2. Read the optimal confidence off `BoxF1_curve.png` (the number in the title) and set
   `CONF_THRESHOLD` to it — replacing the `0.25` placeholder.
3. Bump `MODEL_VERSION` in `.env` to `roadsense-yolov8s-v2`.
4. Re-run `python detect.py` and re-measure the table above.
5. Restart `infer_service`. **No code changes anywhere.**
