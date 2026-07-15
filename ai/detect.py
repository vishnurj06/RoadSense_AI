"""Batch detection: a folder of images -> one Contract v2 report JSON per image.

Runs entirely offline against local weights. No Roboflow, no API key, no network.
"""

import argparse
import json
import os
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from model import CONF_THRESHOLD, MODEL_VERSION, detect, load_model

_HERE = Path(__file__).parent

# GPS is still faked. Task A-6 replaces this with a real GPX track.
BASE_LAT, BASE_LON = 19.0760, 72.8777

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def fake_gps():
    return {
        "lat": BASE_LAT + random.uniform(-0.01, 0.01),
        "lon": BASE_LON + random.uniform(-0.01, 0.01),
    }


def main():
    parser = argparse.ArgumentParser(description="Run pothole detection over a folder of images.")
    parser.add_argument("--input", default=_HERE / "test_images", type=Path)
    parser.add_argument("--output", default=_HERE / "outputs", type=Path)
    parser.add_argument("--conf", default=CONF_THRESHOLD, type=float)
    parser.add_argument("--vehicle-id", default="demo-vehicle-1")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    model = load_model()

    images = sorted(p for p in args.input.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    total_detections = 0

    for img_path in images:
        img_w, img_h = Image.open(img_path).size
        detections = detect(model, img_path, img_w, img_h, conf=args.conf)
        total_detections += len(detections)

        report = {
            "report_id": str(uuid.uuid4()),
            "vehicle_id": args.vehicle_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "gps": fake_gps(),
            "model_version": MODEL_VERSION,
            "detections": detections,
            "image_url": f"/static/uploads/{img_path.name}",
        }

        out_path = args.output / f"{img_path.stem}.json"
        out_path.write_text(json.dumps(report, indent=2))
        print(f"{img_path.name}: {len(detections)} detections")

    print(
        f"\nDone. {len(images)} images -> {total_detections} detections "
        f"(conf>={args.conf}, model={MODEL_VERSION})"
    )
    print(f"JSON written to {os.path.relpath(args.output)}")


if __name__ == "__main__":
    main()
