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

Then put your trained weights at `ai/weights/best.pt` (gitignored — weights never go in git).

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

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `MODEL_PATH` | `weights/best.pt` | **Swap this to deploy a new model. No code changes needed.** |
| `MODEL_VERSION` | `roadsense-yolov8s-v2` | Returned on every response. **Bump on every retrain.** |
| `CONF_THRESHOLD` | `0.30` | F1-optimal on the v2-2 val set. Detections below this are dropped; the backend never re-filters. |

## Layout

```
model.py           model loading + detection → Contract v2 shape (shared)
severity.py        severity heuristic (shared, so batch and service can't drift)
infer_service.py   FastAPI service — POST /infer, GET /health
detect.py          batch runner: images → report JSONs
extract_frames.py  video → frames
weights/           gitignored
```

## Model status — read before quoting any number. See `experiments.md`.

`weights/best.pt` is the GPU-trained `v2-2` checkpoint (yolov8s, 640px, `conf=0.30`).

**It detects potholes.** On `potholevideos.mp4` — a street genuinely full of them — it fires on
**77% of frames**, boxes on target, up to **0.755** confidence. That is the clip to demo.

**It misses a lot of them.** Val recall is **0.472**: one extracted frame with five obvious potholes
returns zero detections. Precision 0.664 / recall 0.472 — *when it fires it's usually right, it just
doesn't fire often enough.* Never state the first half without the second.

Two more things not to trip over:

- **`v2-2` did not beat the 12-epoch CPU baseline** (val mAP50 0.550 vs 0.556). Bigger model, 4× the
  epochs and higher resolution changed nothing — the bottleneck is **data**, not training config.
- **`dashcam.mp4` contains no potholes** (it's a snowy highway), so every detection on it — from this
  model *and* from the Phase-1 Roboflow API — is a false positive. Use it to measure the
  false-positive rate, where a good score is **zero** detections. Never as proof the model works.

The two test sets do different jobs:

| footage | frames | measures | good result |
|---|---|---|---|
| `potholevideos.mp4` | `pothole_frames/` | detection ability | **many** detections |
| `dashcam.mp4` | `test_images/` | false-positive rate | **zero** detections |
