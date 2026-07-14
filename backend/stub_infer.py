import io
import random
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, status
from PIL import Image

app = FastAPI(title="RoadSense AI Stub Inference Service", version="2.0.0")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_version": "roadsense-stub-v2",
        "model_loaded": True,
    }



@app.post("/infer", status_code=status.HTTP_200_OK)
async def infer(file: UploadFile = File(...), conf: float = Form(0.5)):
    # 1. Validate image format
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_image: Uploaded file is not an image.",
        )

    # 2. Validate image size (must be <= 10MB)
    contents = await file.read()
    file_size = len(contents)
    if file_size > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="image_too_large: Image exceeds 10 MB limit.",
        )

    # 3. Read image dimensions using Pillow
    try:
        image = Image.open(io.BytesIO(contents))
        width, height = image.size
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"invalid_image: Could not parse image. Error: {e}",
        )

    # 4. Pseudo-random detections (0 to 3 detections)
    # ~25% chance of empty detections
    detections = []
    classes = ["pothole", "crack"]
    severities = ["low", "medium", "high"]

    if random.random() > 0.25:
        num_detections = random.randint(1, 3)
        for _ in range(num_detections):
            # Random confidence >= threshold (or conf Form parameter)
            confidence = round(random.uniform(max(conf, 0.4), 0.98), 2)
            # Random bbox coords [x1, y1, x2, y2]
            # Ensure x1 < x2, y1 < y2
            x1 = round(random.uniform(0, width * 0.7), 1)
            y1 = round(random.uniform(0, height * 0.7), 1)
            x2 = round(random.uniform(x1 + 10, width), 1)
            y2 = round(random.uniform(y1 + 10, height), 1)

            detections.append(
                {
                    "class": random.choice(classes),
                    "confidence": confidence,
                    "bbox": [x1, y1, x2, y2],
                    "severity": random.choice(severities),
                }
            )

    return {
        "model_version": "roadsense-stub-v2",
        "image": {"width": width, "height": height},
        "inference_ms": random.randint(10, 45),
        "detections": detections,
    }
