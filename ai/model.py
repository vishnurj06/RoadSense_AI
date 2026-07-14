"""Model loading and detection, shared by the batch script and the HTTP service."""

import os

from dotenv import load_dotenv
from ultralytics import YOLO

from severity import severity_from_bbox

load_dotenv()

_HERE = os.path.dirname(os.path.abspath(__file__))

MODEL_PATH = os.getenv("MODEL_PATH", os.path.join(_HERE, "weights", "best.pt"))
MODEL_VERSION = os.getenv("MODEL_VERSION", "roadsense-yolov8n-v1")
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.5"))


def load_model():
    return YOLO(MODEL_PATH)


def detect(model, image, img_w, img_h, conf=CONF_THRESHOLD):
    """Run the model and return detections in Contract v2 §3.2 shape.

    `image` is anything Ultralytics accepts (path, PIL image, ndarray).
    Returns [] when nothing is found — that is a valid result, not an error.
    """
    detections = []

    for result in model.predict(image, conf=conf, verbose=False):
        for box in result.boxes:
            # YOLO gives xyxy natively. The contract mandates absolute-pixel
            # [x1, y1, x2, y2], so there is deliberately no conversion here.
            xyxy = [round(float(v), 1) for v in box.xyxy[0].tolist()]
            class_name = model.names[int(box.cls)].lower().replace(" ", "_")

            detections.append(
                {
                    "class": class_name,
                    "confidence": round(float(box.conf), 3),
                    "bbox": xyxy,
                    "severity": severity_from_bbox(xyxy, img_w, img_h),
                }
            )

    return detections
