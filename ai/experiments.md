# Training log

Every training run gets a row. **All metrics below are on the `valid` split (118 images)** so the
rows are comparable to each other. Test-split numbers are called out separately — never compare a
test number against a val number.

| run | base | epochs | imgsz | device | precision | recall | mAP50 | mAP50-95 |
|---|---|---|---|---|---|---|---|---|
| `train-2` (baseline) | yolov8n | 12 | 416 | CPU | 0.588 | 0.542 | 0.556 | 0.239 |
| `v2-2` (current `best.pt`) | yolov8s | 48 of 100 | 640 | T4 GPU | 0.664 | 0.472 | **0.550** | 0.234 |

`v2-2` also scores **mAP50 0.468 / mAP50-95 0.179 on the `test` split** (59 images, 189 instances).
That is a *different split*, not a regression from 0.556.

**Phase-2 target: mAP50 ≥ 0.75. Not met, and this run tells us why not.**

---

## The v2-2 retrain did not work. Read this before proposing another one.

The hypothesis behind `v2-2` was that the baseline was weak because it was under-trained: too few
epochs, too small a model, too low a resolution. So we changed all three at once — yolov8n → yolov8s,
12 → 100 epochs, 416 → 640px, CPU → T4.

**Val mAP50 went from 0.556 to 0.550.** Within noise on a 118-image val set. The hypothesis is
tested and **falsified**.

Two details that matter:

- The run **early-stopped at epoch 48**, not 100. `patience=20`, and the best epoch was **28**. It
  had stopped improving less than a third of the way in. Buying more epochs buys nothing.
- Precision rose (0.588 → 0.664) while recall fell (0.542 → 0.472). The bigger model got *pickier*,
  not *better*. It moved along the same precision/recall curve rather than moving the curve.

So the bottleneck is **not** training config. It is the **data**: 1,230 train / 118 val / 59 test.
Do not spend another GPU session on epochs, image size, or model scale. The next lever is data —
more images, better labels, or a stronger dataset. Anything else is retreading this run.

## ⚠ `dashcam.mp4` contains no potholes. Do not use it to judge the model.

The 57 frames in `ai/test_images/` come from `dashcam.mp4`, which is a **snowy Oregon highway**
(timestamped 2016-01-29). Nobody ever checked whether it contains potholes. **It does not.**

That makes the confidence-sweep table that used to live here actively misleading. It counted
detections and treated *more* as *better*. On footage with no potholes, every detection is a false
positive, and the **correct** number of detections is **zero**.

Here is what `v2-2` actually fires on, at its F1-optimal `conf=0.30`:

| frame | conf | what it actually is |
|---|---|---|
| `frame_0050` | 0.512 | a dark wet patch on the road surface |
| `frame_0046` | 0.395 | **trees, in the top-left corner of the sky** |
| `frame_0037` | 0.341 | **the car's own dashboard / hood strip**, spanning the full frame width |

The tell is the bbox geometry: several detections are full-width bands pinned to `y2 = 1080.0`
(the bottom edge) or to `y1 ≈ 0` (the top edge). No pothole is 1,900 px wide and touching the frame
edge. The model is latching onto the dashboard bezel and the treeline.

`v2-2` is *better calibrated* than the baseline — its max confidence on these frames is 0.512, where
the baseline never exceeded 0.369 — but it is **more confidently wrong**, not more right. Higher
confidence on a false positive is not progress.

**Consequence: `dashcam.mp4` cannot answer "does the model work?"** — it can only tell us how often
the model hallucinates on clean road. That is still useful (see hard-negative mining below), but it
is a *negative* test set, not a positive one. `potholevideos.mp4` is the positive one — see the next
section. Keep the two jobs separate:

- `dashcam.mp4` / `test_images/` → **false-positive rate.** Good result = **0 detections.**
- `potholevideos.mp4` / `pothole_frames/` → **detection ability.** Good result = **many detections.**

## ✅ `potholevideos.mp4` — the model does detect potholes. First real evidence.

`potholevideos.mp4` (474×854 portrait, 27s, 30fps) is a handheld walk down a badly damaged
residential street. Unlike `dashcam.mp4`, it is **full of potholes** — several large, unambiguous
ones in nearly every frame. 55 frames extracted to `ai/pothole_frames/` (every 15th).

Same weights, same `conf=0.30`, run over those 55 frames:

| | `dashcam.mp4` (no potholes) | `potholevideos.mp4` (many potholes) |
|---|---|---|
| max confidence | 0.512 | **0.755** |
| frames with ≥1 detection @ 0.30 | 3 / 57 | **43 / 55** |
| detections @ 0.30 | 3 (all false positives) | 64 |

**The boxes land on real potholes.** They are correctly sized and correctly placed — not full-width
bands pinned to the frame edge. This is the first time we have evidence that our own model detects
the thing it is supposed to detect. The confidence gap (0.755 vs 0.512) is also a real signal: the
model is meaningfully more confident on true potholes than on the dashboard-and-treeline garbage.

Over the full 821-frame video, **631 frames (77%) get ≥1 detection** at `conf=0.30`. Annotated
render: `ai/demo_potholes_annotated.mp4` (regenerable; gitignored). **This is the clip to demo.**

### But recall is the weak point, exactly as the val metrics said

`v2-2` val recall is **0.472** — it misses over half of what is there — and that shows up plainly:

- `frame_0030` has **~5 clearly visible potholes** and produces **zero detections**.
- `frame_0050` catches the small pothole and misses the larger patch right below it.

So the honest characterisation of the model is: **when it fires, it is usually right; it just doesn't
fire often enough.** Precision 0.664 / recall 0.472 is not a rounding error, it is the behaviour.
Do not describe this model as "working" without that second half of the sentence.

### Caveat: this is not dashcam POV

`potholevideos.mp4` is shot handheld at pedestrian height, portrait, looking down at close range.
The product is a **vehicle-mounted dashcam**: landscape, higher, further away, motion-blurred,
potholes far smaller in frame. So this clip proves *the detector detects potholes*. It does **not**
prove the detector works from a moving car. We still need real dashcam footage that contains
potholes — that gap is open.

## Comparison with the Phase-1 Roboflow hosted API

The 57 committed JSONs in `ai/outputs/` (produced in Phase 1 via `detect.roboflow.com`) contain
12 detections at confidences from ~0.41 up. That was read as "the hosted model beats ours."

Given the above, that reading is wrong too: those 12 detections are on the same pothole-free footage,
so they are **also false positives**. The Phase-1 demo was not evidence that the hosted model works.
It was evidence that a confident model on unsuitable footage produces confident nonsense.

## Current deployment

`weights/best.pt` is `v2-2` (yolov8s). `MODEL_VERSION=roadsense-yolov8s-v2`, `CONF_THRESHOLD=0.30`
(the F1-optimal point from `BoxF1_curve.png`; F1 = 0.55 there).

The baseline is kept at `weights/best-yolov8n-v1.pt` so the comparison above stays reproducible.

`0.30` is a **dataset-derived** threshold, not a field-validated one. It is the right default and it
is honestly sourced — but as the table above shows, it does not stop false positives on footage that
looks nothing like the training set.

## What would actually move the number

In rough order of expected payoff:

1. **Recall.** This is now the headline weakness: 0.472, and `frame_0030` misses five obvious
   potholes. More/better-labelled training data is the main lever — 1,230 images is small for a
   detector expected to generalise across dashcams, weather, and road surfaces.
2. **Hard-negative mining.** Feed the 57 pothole-free `test_images/` frames back in as background
   images so the model stops calling dashboards and treelines potholes. Cheap: the frames already
   exist and need no labelling (an empty label file *is* the label).
3. **Dashcam footage that contains potholes.** `potholevideos.mp4` proves the detector detects
   potholes, but at pedestrian height and close range. Nothing yet proves it works from a moving
   vehicle, which is the actual product. Still an open gap.
4. **Only then** revisit training config — epochs/imgsz/model-scale are already ruled out above.
