"""RoadSense AI inference service — implements Contract v2 §3.

    POST /infer    image (multipart) -> detections
    GET  /health   liveness + which model is loaded

The backend (Person B) calls this via INFERENCE_URL. It is stateless: it knows
nothing about reports, GPS, vehicles, or the database.
"""

import io
import time

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError

from model import CONF_THRESHOLD, MODEL_VERSION, detect, load_model

MAX_BYTES = 10 * 1024 * 1024  # Contract v2 §3.1

app = FastAPI(title="RoadSense AI Inference", version="2.0.0")

# Loaded once at import, not per request.
model = load_model()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_version": MODEL_VERSION,
        "model_loaded": model is not None,
    }


@app.post("/infer")
async def infer(file: UploadFile = File(...), conf: float = Form(CONF_THRESHOLD)):
    raw = await file.read()

    if len(raw) > MAX_BYTES:
        return JSONResponse(
            status_code=413,
            content={
                "error": "image_too_large",
                "detail": f"Image is {len(raw)} bytes; max is {MAX_BYTES}.",
            },
        )

    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except (UnidentifiedImageError, OSError) as e:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_image", "detail": f"Could not decode image: {e}"},
        )

    img_w, img_h = image.size

    try:
        started = time.perf_counter()
        detections = detect(model, image, img_w, img_h, conf=conf)
        inference_ms = int((time.perf_counter() - started) * 1000)
    except Exception as e:  # noqa: BLE001 - any model failure must surface as 500, not a crash
        return JSONResponse(
            status_code=500,
            content={"error": "inference_failed", "detail": str(e)},
        )

    # An empty `detections` list is a SUCCESS (200), never an error. Contract v2 §3.5.
    return {
        "model_version": MODEL_VERSION,
        "image": {"width": img_w, "height": img_h},
        "inference_ms": inference_ms,
        "detections": detections,
    }
