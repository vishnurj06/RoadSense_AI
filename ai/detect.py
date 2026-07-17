"""Batch detection: a folder of images -> one Contract v2 report JSON per image.

Runs entirely offline against local weights. No Roboflow, no API key, no network.

GPS (task A-6) is resolved per image in this order:
  1. EXIF GPS on the image (phone photos).
  2. A --gpx track sampled at the frame's timestamp (a recorded drive).
  3. Faked jitter near Mumbai — only as a last resort, and it is reported loudly
     in the run summary so a demo can never quietly pass fake coordinates off as
     real ones.
"""

import argparse
import json
import os
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from gps import Fix, GpxTrack, frame_timestamp, gps_from_exif, timestamp_from_exif
from model import CONF_THRESHOLD, MODEL_VERSION, detect, load_model

_HERE = Path(__file__).parent

# Last-resort fake fix. Real GPS comes from EXIF or a GPX track — see gps.py.
BASE_LAT, BASE_LON = 19.0760, 72.8777

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def fake_gps():
    """Random jitter near Mumbai. Not a location — a placeholder."""
    return Fix(
        lat=BASE_LAT + random.uniform(-0.01, 0.01),
        lon=BASE_LON + random.uniform(-0.01, 0.01),
        speed_kmph=None,
        source="faked",
    )


def resolve_gps(img_path, index, track, start, fps):
    """Best available fix for one image. Never returns None."""
    fix = gps_from_exif(img_path)
    if fix is not None:
        return fix

    if track is not None:
        # Prefer the image's own capture time; fall back to position in sequence.
        when = timestamp_from_exif(img_path)
        if when is None and fps:
            when = frame_timestamp(start or track.start, index, fps)
        if when is not None:
            return track.at(when)

    return fake_gps()


def main():
    parser = argparse.ArgumentParser(description="Run pothole detection over a folder of images.")
    parser.add_argument("--input", default=_HERE / "test_images", type=Path)
    parser.add_argument("--output", default=_HERE / "outputs", type=Path)
    parser.add_argument("--conf", default=CONF_THRESHOLD, type=float)
    parser.add_argument("--vehicle-id", default="demo-vehicle-1")
    parser.add_argument("--gpx", type=Path, default=None, help="GPX track recorded with the drive")
    parser.add_argument(
        "--fps",
        type=float,
        default=None,
        help="effective fps of the extracted frames (source fps / every_n_frames). "
        "Used with --gpx to place each frame on the track.",
    )
    parser.add_argument(
        "--start-time",
        default=None,
        help="ISO8601 UTC timestamp of the first frame. Defaults to the GPX start.",
    )
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    model = load_model()

    track = GpxTrack.from_file(args.gpx) if args.gpx else None
    start = datetime.fromisoformat(args.start_time) if args.start_time else None
    if start and start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)

    images = sorted(p for p in args.input.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    total_detections = 0
    sources = {}

    for index, img_path in enumerate(images):
        img_w, img_h = Image.open(img_path).size
        detections = detect(model, img_path, img_w, img_h, conf=args.conf)
        total_detections += len(detections)

        fix = resolve_gps(img_path, index, track, start, args.fps)
        sources[fix.source] = sources.get(fix.source, 0) + 1

        report = {
            "report_id": str(uuid.uuid4()),
            "vehicle_id": args.vehicle_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "gps": {"lat": round(fix.lat, 6), "lon": round(fix.lon, 6)},
            # Contract v3 §3.2 — exif | gpx | faked. The backend marks `faked`
            # pins in the UI (B3-6), so this must always be sent: an absent
            # value lets a placebo location pass as a real fix.
            "gps_source": fix.source,
            "speed_kmph": fix.speed_kmph,  # nullable per Contract v2 §4.2
            "model_version": MODEL_VERSION,
            "detections": detections,
            "image_url": f"/static/uploads/{img_path.name}",
        }

        out_path = args.output / f"{img_path.stem}.json"
        out_path.write_text(json.dumps(report, indent=2))
        print(f"{img_path.name}: {len(detections)} detections  gps={fix.source}")

    print(
        f"\nDone. {len(images)} images -> {total_detections} detections "
        f"(conf>={args.conf}, model={MODEL_VERSION})"
    )
    print(f"GPS sources: {sources}")
    if sources.get("faked"):
        print(
            f"\n  WARNING: {sources['faked']} of {len(images)} reports carry FAKED GPS "
            f"(random jitter near Mumbai).\n"
            f"  Those coordinates are meaningless. Pass --gpx (with --fps) or use "
            f"GPS-tagged images for real positions."
        )
    print(f"JSON written to {os.path.relpath(args.output)}")


if __name__ == "__main__":
    main()
