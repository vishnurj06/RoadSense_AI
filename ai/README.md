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
| `MODEL_VERSION` | `roadsense-yolov8n-v1` | Returned on every response. **Bump on every retrain.** |
| `CONF_THRESHOLD` | `0.25` | Detections below this are dropped. The backend never re-filters. |

## Layout

```
model.py           model loading + detection → Contract v2 shape (shared)
severity.py        severity heuristic (shared, so batch and service can't drift)
infer_service.py   FastAPI service — POST /infer, GET /health
detect.py          batch runner: images → report JSONs
extract_frames.py  video → frames
weights/           gitignored
```

## ⚠ Current model is weak — see `experiments.md`

The checkpoint in `weights/best.pt` is the 12-epoch CPU baseline. On real dashcam footage it
**never exceeds 0.369 confidence**, and finds nothing at all above `conf=0.4`. `CONF_THRESHOLD` is
temporarily set to `0.25` just so the pipeline demonstrably produces output end-to-end.

This is a **model** problem, not a **service** problem — the contract, the endpoint and the backend
integration are all correct and unaffected. Replacing `weights/best.pt` with the properly-trained
model fixes it with zero code changes. Reset `CONF_THRESHOLD` from the new model's F1 curve at that
point.
