# RoadSense AI — Detection (Person A)

Local YOLO inference. **No Roboflow, no hosted API, no API key, no network.**

## Setup

```bash
cd ai
python -m venv venv
venv/Scripts/activate        # Windows;  source venv/bin/activate on Linux/macOS
pip install -r requirements.txt
cp .env.example .env
```

## Get the model — one command (A3-7)

Weights are gitignored, so a fresh clone has no model. **Don't ask Person A for a file — fetch it:**

```bash
# the repo is private, so a token is required:
export GITHUB_TOKEN=ghp_xxx        # bash / macOS / Linux
$env:GITHUB_TOKEN = "ghp_xxx"      # PowerShell   (NOT `set` — that is cmd.exe syntax)
set GITHUB_TOKEN=ghp_xxx           # cmd.exe

python fetch_model.py           # downloads the default model -> weights/best.pt, SHA256-verified
python fetch_model.py --list    # every version + its real numbers and known weaknesses
```

**Which token?** A **classic** token with `repo` scope works for everyone. A *fine-grained* token is
scoped to a **resource owner** and can only reach repos that owner owns — so it works for the repo
owner, but **not** for a collaborator. If you are a collaborator, use classic.

`models.json` is the registry — it is the **single source of truth** for which model is current, what
classes it has, its `CONF_THRESHOLD`, its real-footage numbers, and what is wrong with it. The
fetcher verifies SHA256 before installing and **refuses** a mismatch rather than leaving you with a
model that isn't the one in the registry.

> **Why this exists:** `best.pt` being gitignored meant the repo could not tell you what the model
> was. That caused a codebase audit to report the model as single-class when it had two, and caused
> a merge to revert A-5 — in both cases because the person could not load the weights to check.
> `fetch_model.py` ends that. See the Phase 3 doc §2.1.

### Publishing a new model (Person A)

1. Train, then verify on **real footage** — the ship gate is beating the current model there
   (45/55 pothole frames, 0 false positives), **not** RDD test AP.
2. Hash it: `python -c "import hashlib;print(hashlib.sha256(open('weights/best.pt','rb').read()).hexdigest())"`
3. GitHub → **Releases → Draft a new release** → tag `model-<version>` → attach the `.pt`.
4. Add an entry to `models.json` (url, sha256, size_bytes, classes, conf_threshold, metrics,
   **known_weaknesses**) and move `default` to it. **Never point an entry at an artifact you have
   not hashed.**
5. Verify from a clean path: `python fetch_model.py --version <version> --dest /tmp/check.pt`

Weights still never go in git — only the registry entry does.

## Run the inference service — this is what the backend calls

```bash
uvicorn infer_service:app --port 8001 --reload
```

Implements Contract v2 §3:

| Endpoint | Purpose |
|---|---|
| `POST /infer` | image (multipart `file`) → detections |
| `GET /health` | liveness + which model is loaded |

```bash
curl -F "file=@test_images/frame_0055.jpg" http://localhost:8001/infer
curl http://localhost:8001/health
```

Response:
```json
{
  "model_version": "roadsense-yolov8n-v1",
  "image": { "width": 1920, "height": 1080 },
  "inference_ms": 45,
  "detections": [
    { "class": "pothole", "confidence": 0.369,
      "bbox": [540.1, 0.0, 1153.8, 472.8], "severity": "high" }
  ]
}
```

**An empty `detections` array is a success (`200`), not an error.** The backend relies on this.

## Batch mode — a folder of images → one report JSON each

```bash
python detect.py                                  # defaults to test_images/ → outputs/
python detect.py --input frames/ --conf 0.3
```

## Extract frames from a video

```bash
python extract_frames.py dashcam.mp4              # → test_images/
```

## GPS — real, not faked (task A-6)

`detect.py` resolves each report's position in this order:

1. **EXIF GPS** on the image itself (phone photos) — automatic, nothing to pass.
2. **A GPX track** sampled at the frame's timestamp — for a recorded drive:
   ```bash
   # --fps is the EFFECTIVE fps of the extracted frames:
   #   source fps / every_n_frames  (extract_frames.py defaults to every 15th)
   python detect.py --input frames/ --gpx drive.gpx --fps 2 \
                    --start-time 2026-07-16T10:00:00+00:00
   ```
   Positions are linearly interpolated between track points, and `speed_kmph`
   is derived from the surrounding segment. Frames outside the track clamp to
   its ends rather than inventing a position.
3. **Faked jitter near Mumbai** — last resort. The run prints a loud
   `WARNING: N of M reports carry FAKED GPS`, and `speed_kmph` is `null`.
   **Those coordinates are meaningless — never demo them as real.**

Every run ends with a `GPS sources: {...}` line, so you always know which of the
three produced your map pins.

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `MODEL_PATH` | `weights/best.pt` | **Swap this to deploy a new model. No code changes needed.** |
| `MODEL_VERSION` | `roadsense-yolov8s-v3-merged` | Returned on every response. **Bump on every retrain.** |
| `CONF_THRESHOLD` | `0.29` | F1-optimal on the v3-merged val set. Detections below this are dropped; the backend never re-filters. |
| `SEVERITY_HORIZON_Y` | `0.0` | Horizon row as a fraction of image height. **Must match the camera** — `0.0` suits footage shot looking down; a dashcam with a visible skyline needs ~`0.5`. |
| `SEVERITY_MEDIUM_SCORE` | `0.208` | Perspective-adjusted size score above which a detection is `medium`. |
| `SEVERITY_HIGH_SCORE` | `0.357` | …and above which it is `high`. Both are **relative** tertiles calibrated on `potholevideos.mp4` — recalibrate per camera. |

### Severity is perspective-corrected (A-5)

`severity.py` does **not** classify on raw bbox area — that provably measured *how close the camera
was* (`corr(depth, severity) = +0.711`), so the same pothole scored `low` far away and `high` up
close. It now divides apparent area by the squared distance-below-horizon of the bbox's bottom edge,
which drops that bias to `−0.157`. The score is **relative, not metric** — see `experiments.md`.

## Layout

```
model.py           model loading + detection → Contract v2 shape (shared)
severity.py        perspective-corrected severity (shared, so batch and service can't drift)
gps.py             real GPS: EXIF tags + GPX track interpolation (task A-6)
infer_service.py   FastAPI service — POST /infer, GET /health
detect.py          batch runner: images → report JSONs
extract_frames.py  video → frames
models.json        model registry — the source of truth for what the model IS (A3-7)
fetch_model.py     download + SHA256-verify a model by version (A3-7)
weights/           gitignored — populate with `python fetch_model.py`
```

## Model status — read before quoting any number. See `experiments.md`.

`weights/best.pt` is **`v3-merged`** (yolov8s, 640px, `conf=0.29`) — a **2-class pothole + crack**
model trained on `pothole-detection-3` + RDD2022 India + hard negatives.

**Potholes — best we've had.** On real footage (`potholevideos.mp4`, 55 frames) it hits **45 frames**
with **zero** false positives on clean dashcam road — beating the old pothole-only model (43 frames,
3 false positives). It's a strict upgrade on potholes.

**Cracks — new, but conservative.** The `crack` class works on RDD's test set (AP50 0.499), so the
dashboard's crack filter can finally match. But it's pothole-biased and under-fires on non-RDD
footage — **not yet confirmed on real crack video.** Don't claim crack detection is proven in the
field; claim the class exists and is validated on RDD. See `experiments.md`.

Two things not to trip over:

- **Don't compare this to the old 0.556 baseline** — different dataset, different (2-class) task.
  Judge it by the real-footage head-to-head above, not by RDD test AP.
- **`dashcam.mp4` contains no potholes** (snowy highway), so any detection on it is a false positive.
  Use it to measure false-positive rate (good score = **zero**), never as proof the model works.

The two test sets do different jobs:

| footage | frames | measures | good result | current |
|---|---|---|---|---|
| `potholevideos.mp4` | `pothole_frames/` | pothole detection | **many** detections | 45/55 |
| `Pothole_new_india_360p.mp4` | `india_frames/` | pothole detection (incl. **water-filled**) | **many** detections | **61/67** |
| `dashcam.mp4` | `test_images/` | false-positive rate | **zero** detections | **0/57** ✅ |

⚠️ **Both positive sets are the same camera domain** — low and close to the road (median detection
height 0.39 vs 0.41). Neither is windshield-mounted dashcam POV, which is the actual product. **No
accuracy claim here has been validated from a moving vehicle.**
