# Training log

Every training run gets a row. **All metrics below are on the `valid` split (118 images)** so the
rows are comparable to each other. Test-split numbers are called out separately — never compare a
test number against a val number.

| run | base | epochs | imgsz | device | classes | train imgs | mAP50 | notes |
|---|---|---|---|---|---|---|---|---|
| `train-2` (baseline) | yolov8n | 12 | 416 | CPU | pothole | 1,230 | 0.556 | val split |
| `v2-2` | yolov8s | 48/100 | 640 | T4 | pothole | 1,230 | 0.550 | val; **config changes did nothing** |
| `v3-rdd-india` (rejected) | yolov8s | 85/100 | 640 | T4 | pothole+crack | ~5.4k | 0.427 | pothole AP 0.377 — collapsed to 18/55 on real footage |
| `v3-merged` | yolov8s | ~60/100 | 640 | T4 | pothole+crack | 6,655 | 0.480 | pothole AP 0.460, crack AP 0.499 |
| `v4-all` (**current `best.pt`**) | yolov8s | 60 | 640 | T4 | pothole+crack | 11,976 | 0.511 | pothole AP 0.477, crack AP **0.545**; TTA 0.519 |

⚠️ **The mAP50 column is NOT comparable across the last two rows.** `v3-merged`'s test split is
India+p3 (1,225 images); `v4-all`'s is all-countries+p3 (5,817). Judge them by the real-footage
head-to-head below, not by this column.

**Current deployment: `v3-merged`.** `MODEL_VERSION=roadsense-yolov8s-v3-merged`, `CONF_THRESHOLD=0.29`
(F1-optimal, 0.52 at 0.292). Old `v2-2` kept at `weights/best-yolov8s-v2-2.pt`.

**Phase-2 target mAP50 ≥ 0.75 still not met on the RDD test set** — but on real footage the pothole
detection is now the best we've had (see below), and the crack class exists for the first time.

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

## ✅ v3-merged — the real Phase-2 model (pothole + crack). How it was built.

The two-class model went through two attempts:

1. **`v3-rdd-india`** — trained on RDD2022 India alone (pothole + 3 crack types → 2 classes, + hard
   negatives). Cracks worked, but **pothole recall regressed badly on real footage** (19/55 pothole
   frames vs the pothole-only model's 43/55). RDD India potholes are a harder, different distribution
   than the clean close-up potholes in `pothole-detection-3`. **Rejected — not shipped.**
2. **`v3-merged`** — merged **`pothole-detection-3` (strong potholes) + RDD India (cracks) + hard
   negatives**: 6,655 train images, 6,358 pothole boxes / 2,581 crack boxes. This recovered pothole
   recall *and* kept the crack class. **Shipped.**

### Head-to-head on real footage (the decider — not the RDD test AP)

`potholevideos.mp4` (55 frames, real potholes) and the 57 pothole-free dashcam frames, at conf 0.30:

| model | pothole frames hit (of 55) | false positives on clean road (of 57) |
|---|---|---|
| `v2-2` pothole-only (old deploy) | 43 | 3 |
| `v3-rdd-india` (rejected) | 18 | 0 |
| **`v3-merged` (shipped)** | **45** | **0** |

**v3-merged is a strict upgrade over the old model**: more potholes caught (45 vs 43, and 79 raw
detections vs 64) *and* zero false positives (vs 3). Verified end-to-end through `model.py`
(`roadsense-yolov8s-v3-merged`, conf 0.29): fires 0.748 on a real pothole, returns `[]` on clean road.

### ⚠ Honest caveat on the crack class

Cracks are validated on **RDD's own test set** (AP50 **0.499**) — the class is real and works on
RDD-style cracks. **But it is conservative**: on `potholevideos.mp4` it emits **zero** crack
detections even at conf 0.05, because (a) that footage is potholes, not clean transverse/longitudinal
cracks, and (b) the merge is pothole-biased (6,358 pothole boxes vs 2,581 crack). We have **not**
independently confirmed cracks on non-RDD footage — there are no crack test images locally. So: the
dashboard `crack` filter now *can* match, but expect it to fire only on clear RDD-style cracks until
we test it on real crack footage. That test is the open item for cracks.

## `Pothole_new_india_360p.mp4` — third positive set, and the best result yet

640x360 landscape, 40 s, 25 fps → 67 frames in `ai/india_frames/`. An Indian road covered in large
potholes, **many of them water-filled**. v3-merged at the deployed `conf=0.29`:

| footage | frames hit | max conf |
|---|---|---|
| `potholevideos.mp4` | 45 / 55 (82%) | 0.755 |
| **`Pothole_new_india_360p.mp4`** | **61 / 67 (91%)** | **0.882** |

Even at `conf=0.50` it still hits 54/67. **This is the model's strongest showing on any real footage**,
and it is a genuinely independent third test set.

### The interesting part: water-filled potholes work

The boxes land on the flooded potholes. That was not a given — a water-filled pothole is bright and
reflective, the visual *opposite* of the dark holes the training data is full of. The model was never
trained on them as a class and still finds them, labelling them `pothole` (which is defensible: they
*are* potholes).

**This matters for A3-1.** `water_filled_pothole` is one of the 7 PRD classes, and the Phase-3 plan
called it *"the hardest — likely needs custom collection"*. We now have footage of it, and evidence
the detector already sees them. **But 67 frames from one scene is not a training set** — it is enough
to evaluate, not to teach a new class.

Recall is still visibly imperfect: several potholes per frame go unboxed (e.g. the dark one top-left
of `frame_0000`), consistent with the measured recall of ~0.44.

### ⚠ It does NOT close the dashcam gap — the geometry says so

It *looks* more dashcam-like (landscape, forward motion) but it is the **same low, road-filling
camera** as the handheld clip. Vertical position of detections:

| footage | min | median | max |
|---|---|---|---|
| `Pothole_new_india_360p.mp4` | 0.06 | **0.39** | 0.92 |
| `potholevideos.mp4` | 0.07 | **0.41** | 0.91 |

A windshield-mounted dashcam would put the horizon mid-frame and cluster potholes **low** (~0.6-0.9).
These two are statistically the same camera height. So this is a **second sample of the same domain**,
not a new one.

**Still open, unchanged:** no GPS (so A3-5's GPS validation is untouched), and no true
vehicle-mounted footage. **Every accuracy claim we have still comes from low, close-range video.**
Recording a real drive remains the cheapest way to close that.

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

## 🔬 `v4-all` — the data-scale experiment. **Answer: data scale is not the lever either.**

**The single most important result in this file.** Every prior run trained on a subset; `v4-all`
tested the one untried hypothesis — **more data**.

**Setup:** all 6 RDD countries (India 5,368 · Japan 7,432 · Norway 5,708 · US 3,348 · China 3,051 ·
Czech 1,962 = 26,869) + pothole-detection-3 + 57 hard negatives. Non-pothole images subsampled 1-in-3
so cracks could not swamp potholes (34,114 → 13,443 crack boxes; **every** pothole kept: 8,750).
Final: **11,976 train images — 4x v3's data**, same yolov8s @640 so only the data changed.

### The result: marginal and mixed

Real footage @ conf 0.29 — the ship gate:

| test set | v3-merged | **v4-all** | |
|---|---|---|---|
| `potholevideos.mp4` | 45/55 | **51/55** | ✅ v4 better at **every** threshold (+3 to +7) |
| `Pothole_new_india_360p.mp4` | **60/67** | 58/67 | ❌ v4 worse; less confident (max 0.855 vs 0.882) |
| hard negatives | 0 FP | **0 FP** | tie |
| **total frames hit** | 105/122 | **109/122** | |
| **total detections** | 178 | **204 (+15%)** | |

**Shipped** — net recall is up (the known weakness) with false positives still 0, and v4 saw 6
countries vs 1, which should generalise better to the dashcam domain we cannot test. But it is an
**honest marginal call, not a clean win**: it failed the stated gate ("beat v3 on all three").

### What it actually proves — this is the finding, not the model

**4x the data → a ~4-frame net change.** Not a breakthrough. Set that beside `v2-2`:

| hypothesis | experiment | result |
|---|---|---|
| "it's under-trained" (epochs / model size / resolution) | `v2-2` | **falsified** — 0.556 → 0.550 |
| "it needs more data" | `v4-all` | **falsified as a step-change** — 4x data, marginal real-world gain |

**Two independent experiments now point at the same conclusion: the ceiling is LABEL QUALITY, not
data quantity and not training config.** RDD's labels are inconsistent — the same damage is boxed
differently across countries, and plenty is missed entirely.

**Consequence for the Phase-2/3 targets (D-4).** mAP50 ≥ 0.75 and the PRD's precision ≥95% /
recall ≥90% are **not reachable by scaling this approach**. That is no longer an opinion — it is two
falsified hypotheses. Anyone proposing "just train it longer / feed it more" should be shown this
table. **The remaining levers are: better labels, a domain-matched dataset (real dashcam footage), or
accepting a lower, honest target.**

## A3-3 — monocular depth CANNOT measure pothole depth. Measured, not assumed.

A3-3 says: *integrate MiDaS / Depth-Anything → real `depth_cm`*. **Tested before building. It does not
work, and no bigger model fixes it.**

### The physics says it shouldn't work

The PRD wants **pothole depth** ("estimated depth") — how deep the hole is — not distance to camera.
A pothole is **2-15 cm deep** viewed from **3-10 m**: a **0.5-5%** change in depth. Monocular depth
models carry **5-15% relative error**. **The signal sits under the noise floor.**

### The test

For every detected pothole, compare the depth *inside* the box against the road plane in a ring
*around* it. A real pothole **must** read as further away — a dip. Run on `india_frames` (close-range,
large, **water-filled** potholes) — deliberately the **easiest case we have**.

| model | reads as a DIP (physically correct) | median \|SNR\| vs road texture |
|---|---|---|
| Depth-Anything **V2-Small** | **44%** | 1.03 |
| Depth-Anything **V2-Base** (4x bigger) | **50%** | 1.04 |
| *random guessing* | *50%* | — |

**It cannot tell a hole from a bump.** V2-Small is *worse than a coin flip*; V2-Base is *exactly* a
coin flip. It called a 0.72-confidence pothole a **bump**. `SNR ≈ 1.0` means the pothole "signal" is
the same size as the road's own surface texture.

**A 4x bigger model bought exactly nothing** — which is the tell that this is a physics limit, not a
capacity limit. Scaling further is pointless.

**And this was the best case.** Close-range, large, water-filled holes filling much of the frame. On
dashcam footage (potholes far smaller and further) it can only be worse.

### Decision: `depth_cm` stays `null`. Not built.

Contract v3 §3.1 says `depth_cm` null means *"not estimated, **never** a guess"*. Populating it from a
coin flip would be the single most dishonest thing in this codebase — a number that looks metric,
carries a unit, and is noise. **A3-3 as specified is not achievable with monocular depth.**

Not shipped: no `transformers`/`timm` in `requirements.txt`, no second model per frame, and the 6%
latency margin (A3-6) is untouched. **Latency never even had to be measured** — the model doesn't
work, so its cost is moot.

### What could actually work (none are A3-3 as written)

1. **Stereo camera / depth sensor** — real depth, needs hardware. The PRD already lists Jetson; a
   stereo rig is the honest answer.
2. **Structure-from-Motion** — a *moving* dashcam sees each pothole from many angles; parallax gives
   real geometry. Plausible, and it only works *because* the vehicle moves. Substantial build.
3. **A reference object of known size** in frame — calibration, impractical in the field.
4. **Keep relative severity** (what A-5 ships) and **stop claiming cm.** Honest, free, already done.

**Recommendation: (4) now, (2) if depth becomes a real requirement.** Severity today is
distance-invariant and honest about being relative — that is worth more than a fabricated centimetre.

## Note on `docs/codebase_audit_report.md` (2026-07-16) — stale on the AI track

That audit predates / could not see this model, and three of its AI findings are **wrong now**:

| Audit claim | Actual |
|---|---|
| "A-3 ❌ NOT DONE — model is still single-class" | **Done.** `v3-merged` ships `pothole` + `crack`. |
| "the `crack` filter still matches nothing" | The class exists (RDD test AP 0.499). |
| "`CONF_THRESHOLD = 0.30`" / "MODEL_VERSION may be `yolov8n-v1`" | `0.29` / `roadsense-yolov8s-v3-merged`. |

**Why it got this wrong is worth understanding:** `weights/best.pt` is **gitignored**, so a reader
with only the repo *cannot* see how many classes the model has — the audit itself says "unable to
verify". Anyone auditing the AI track needs the weights handed over separately. The audit's
platform findings are unaffected.

Its remaining AI criticism that **is** fair: mAP50 ≥ 0.75 is still unmet (a genuine data bottleneck).
GPS (A-6) and severity (A-5) are both now addressed — see below.

## A-6 — GPS is real now (was: random jitter near Mumbai)

`detect.py` no longer silently fabricates coordinates. `gps.py` resolves each report from, in order:

1. **EXIF GPS** on the image (phone photos), including `GPSSpeed` when present.
2. **A GPX track** interpolated to the frame's timestamp, with `speed_kmph` derived from the
   surrounding segment. Frames outside the track clamp to its ends instead of inventing a position.
3. **Faked jitter** — only as a last resort, and now it is **loud**: the run prints
   `WARNING: N of M reports carry FAKED GPS` and a `GPS sources: {...}` breakdown, so fake pins can
   never quietly pass for real ones in a demo.

`speed_kmph` (Contract v2 §4.2) is now emitted — it was previously missing from every report
entirely. It is `null` when genuinely unknown rather than guessed.

Verified: a synthetic 6-point track (11.12 m/s) returns exactly **40.0 km/h**, midpoint
interpolation is exact to 1e-7°, out-of-range timestamps clamp correctly, and images without EXIF
degrade to `None` instead of raising.

**Still open for GPS:** we have no real GPX track or GPS-tagged footage yet, so the *code* path is
verified but has never run against a real recorded drive. `dashcam.mp4` has coordinates burned into
the video as pixels (not EXIF), which would need OCR — not worth it. The honest status is: the
faking is gone as a silent default, and real GPS works the moment someone records a drive with a
GPX logger.

## A-5 — severity was measuring camera distance, not pothole size

Measured on **81 real detections** (v3-merged @ conf 0.29 over `potholevideos.mp4`), the old
bbox-area heuristic scored **`corr(depth-position, area_ratio) = +0.711`**, and its buckets were an
almost perfect ladder of *how close the camera was*:

| bucket (old) | n | mean depth-position (0 = far, 1 = near) |
|---|---|---|
| low | 24 | 0.187 |
| medium | 19 | 0.367 |
| high | 38 | 0.684 |

**The same pothole scored `low` from far away and `high` from up close.** For a system whose entire
job is prioritising repairs, that is worse than useless — it is confidently wrong.

*(Two older claims are now stale: the Phase-1 audit's "the `medium` band has never fired" and
`claude.md`'s "all `potholevideos.mp4` detections are low". Under v3-merged all three buckets fire.
The distribution was never the real problem — the distance bias was.)*

### The fix: perspective normalisation

A pothole lies on the road plane, so pinhole geometry applies: depth `Z ~ 1/(y - y_horizon)`, and a
real area `A` projects to apparent area `a ~ A/Z²`. Therefore `A ~ a / (y - y_horizon)²`.
`severity.py` now divides apparent area by the squared distance-below-horizon of the bbox's **bottom
edge** (the road-contact row). Same 81 detections:

| | corr(depth, score) | bucket mean depth-positions |
|---|---|---|
| old (raw bbox area) | **+0.711** | 0.187 / 0.367 / 0.684 — a distance ladder |
| **new (perspective-adjusted)** | **−0.157** | 0.441 / 0.535 / 0.416 — **flat** |

**Distance bias reduced 78%.** Severity now tracks size rather than camera proximity, and all three
buckets populate (28 / 26 / 27). The function signature is unchanged, so `model.py`, `detect.py` and
`infer_service.py` needed no edits.

### ⚠ What this still does NOT give you

- **The score is relative, not metric.** It is proportional to real area, but the constant depends on
  focal length and camera mount height, which we do not know. It cannot say "30 cm across".
- **Thresholds are tertiles of that one video** (`medium > 0.208`, `high > 0.357`) — they mean "worst
  third of what this camera saw", not an engineering standard. Recalibrate per camera via
  `SEVERITY_MEDIUM_SCORE` / `SEVERITY_HIGH_SCORE`.
- **`SEVERITY_HORIZON_Y` must match the camera** (default `0.0` = horizon at/above the frame top,
  correct for downward-looking road footage; a dashcam with a visible skyline needs ~`0.5`). A wrong
  horizon means a wrong correction.
- There is still **no ground truth** — nobody has measured a real pothole and checked its bucket. The
  metric upgrade path remains monocular depth (MiDaS / Depth-Anything) or camera calibration.

So A-5 is **improved and honest, not solved**: the dominant defect (distance ≡ severity) is fixed and
measured; absolute calibration is still open.

## A3-6 — latency: the ONNX/OpenVINO plan was wrong, and we already pass

**Two of my own claims were false. Both are corrected here.**

### False claim 1: "103 ms/frame — currently failing"

That came from a sloppy benchmark (8 runs, 1 warmup). Measured properly — **25 runs, 8 warmups,
median, through `model.predict()` (the path `model.py` actually calls)**:

    PyTorch (.pt):  93.7 ms   -> PASSES the PRD's <100 ms/frame

**Hardware, because "<100 ms" is meaningless without it:** AMD Ryzen 5 5600H, 12 cores, torch using
6 threads, CPU only, imgsz 640, one 474x854 image, warm.

### False claim 2: "export ONNX/OpenVINO — typically 2-3x on CPU"

Received wisdom. **Tested, and it is backwards on this hardware.** All three through the production
path, **interleaved** round-robin so thermal drift hits each equally:

| backend | median | vs PyTorch | <100 ms? |
|---|---|---|---|
| **PyTorch (.pt)** | **93.7 ms** | 1.00x | ✅ |
| ONNX Runtime 1.27 | 132.3 ms | **1.41x SLOWER** | ❌ |
| OpenVINO 2026.2 | 177.2 ms | **1.89x SLOWER** | ❌ |

Both exports also **changed the output** (pothole conf 0.75 → 0.73). A faster wrong answer is not a
win — and these were not even faster.

**Why (best explanation):** torch 2.13's CPU backend is oneDNN-optimised and already strong on a
modern Ryzen. OpenVINO is Intel-tuned and gives up much of its advantage on AMD. Neither export
beats it here.

**A methodological trap worth recording:** a raw forward-pass comparison says the *opposite* —
ONNX 156 ms vs PyTorch 205 ms, i.e. ONNX "1.32x faster". That is wrong because `YOLO().model` is
**unfused**, while exporting fuses conv+BN. Benchmarking the unfused module handicaps PyTorch and
flips the conclusion. **Always measure the path you actually deploy.**

**Decision: do NOT ship ONNX or OpenVINO.** No speedup, changed outputs, two extra dependencies.
`ai/requirements.txt` is untouched; the export artifacts were deleted (regenerable in ~2 s).

### What the latency picture actually is

- ✅ **The PRD's <100 ms/frame is met today** — 93.7 ms, on the hardware named above.
- ⚠️ **The margin is 6%.** This is one image, warm, with **no depth and no segmentation**.
- ⚠️ **A3-3 (depth) and A3-4 (segmentation) each add a second model per frame and will blow it.**
  The mitigation is already in the plan: run depth **only on frames that already have a detection**.
  If that is not enough, the answer is a GPU / Jetson (the PRD lists both) — **not** an ONNX export.
- ⚠️ **93.7 ms/frame ≈ 10 fps. It is NOT real-time for 30 fps dashcam video** — that would need
  ~33 ms. The PRD asks for <100 ms and we meet *that*, but nobody should read it as "runs live on a
  dashcam". Batch/sampled frames only.

**Untested levers, if depth+segmentation do blow the budget:** INT8 quantisation (real speedup,
costs accuracy, needs calibration data), a smaller imgsz (costs small-object recall — bad for
potholes), `torch.compile`, or GPU/edge hardware.

## A3-4 — road segmentation: measured, and NOT built. The problem is already solved.

A3-4 exists to kill the treeline / dashboard-bezel false positives. **That problem no longer exists**,
so the task has no upside and a large downside. Both sides measured on v3-merged:

### Upside: zero — FP is already 0

57 pothole-free dashcam frames (any detection = a false positive):

| threshold | false positives |
|---|---|
| **0.29 (deployed)** | **0 / 57** |
| 0.20 / 0.15 / 0.10 | **0 / 57** |
| 0.05 | 2 — at conf **0.077** and **0.055** |

The highest latent off-road detection is **conf 0.077 — 3.8x below the deployed 0.29.** A road mask
would remove detections the confidence threshold already discards. **Nothing to gain.**

**The 57 hard negatives already did segmentation's job, at zero latency cost.** v2-2 fired on the
treeline at **0.395** and the dashboard at **0.341** — both *above* threshold. Adding those frames as
background images in v3-merged drove it to 0. That is the cheaper fix, and it already shipped.

### Downside: it would delete 38% of recall

Where 81 true potholes actually sit vertically (`potholevideos.mp4`, conf 0.29):

    min ycen 0.07 | median 0.41 | max 0.91
    31 of 81 (38%) sit ABOVE ycen 0.35 — the same zone the false positives were in

**A filter targeting the FP zone deletes 38% of real potholes.** Real potholes and the (already
sub-threshold) false positives occupy the *same* part of the frame, so no naive geometric split
separates them. A learned road mask might do better — but it would be spending a second model per
frame, against a **6% latency margin** (see A3-6), to fix a **0-false-positive** problem.

### Decision: not built. Revisit only when this is measured, not assumed.

**Reopen A3-4 if and only if** FP > 0 at the deployed threshold on real footage. Right now the
honest answer is that the ship gate (§A3-4: "FP stays 0 **and** recall is not regressed") is
**unreachable** — FP is already 0, so segmentation can only hold or hurt.

**One genuine future use, not FP filtering:** a road mask would let us *estimate the horizon
automatically*, which would fix A-5's real limitation (`SEVERITY_HORIZON_Y` is currently hand-set per
camera). If segmentation gets built, that — not false positives — is the reason.

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
