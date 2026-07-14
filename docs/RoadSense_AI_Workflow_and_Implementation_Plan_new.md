# RoadSense AI — 2-Day Build Plan (Demo/PoC Scope)

**Team size:** 2 people
**Timeframe:** 2 days
**Reality check up front:** the full PRD (production dashboards, repair workflow, security hardening, fine-tuned multi-class model, fleet/admin panels) is a multi-month build — that's what the original phased plan was for. In **2 days**, the realistic and honest target is a working **end-to-end demo**: real video in → real pothole detections → GPS-tagged reports → stored in a DB → shown on a live map dashboard. That's a legitimate, demoable PoC (it maps to "Phase 1" of the full plan), not the whole product. This doc is scoped to make that achievable without either of you blocking the other.

**What's explicitly OUT of scope for 2 days** (park for later): model fine-tuning/training, multi-class detection beyond pothole (+crack if time allows), fleet/admin dashboards, repair workflow states, notifications, auth/security hardening, duplicate-clustering as a real algorithm (stub it), depth estimation model (use bbox-size heuristic instead).

---

## 1. Split (same seam as before, just compressed)

| | Person A — AI | Person B — Platform |
|---|---|---|
| Owns | Pretrained detection model wired to a script | FastAPI + Postgres(+PostGIS) + Next.js map dashboard |
| Ships | Script: video/images in → JSON detections out | API + DB + live map UI consuming that JSON |

## 2. The Contract — lock this in the first 30 minutes, together

```json
{
  "report_id": "uuid",
  "vehicle_id": "demo-vehicle-1",
  "timestamp": "ISO8601",
  "gps": {"lat": 19.0760, "lon": 72.8777},
  "detections": [
    {
      "class": "pothole",
      "confidence": 0.91,
      "bbox": [x1, y1, x2, y2],
      "severity": "high"
    }
  ],
  "image_url": "local/path/or/s3/url.jpg"
}
```

Person B immediately writes 10 fixture JSON files matching this shape and starts building against them. Person A never needs to touch the backend; Person B never needs to touch the model.

---

## 3. Fastest path on models/data (no training, no exceptions)

- **Model:** use a **pretrained YOLOv8 pothole detection model already fine-tuned by someone else on Roboflow Universe** (search "pothole detection" on Roboflow Universe, filter to ones with an attached trained model). Pull the weights directly via the `roboflow` or `ultralytics` Python package. Zero training.
- **Test data:** grab 20-50 sample images/short dashcam clips from the same Roboflow project (or any "pothole dataset" on Roboflow/Kaggle) plus a couple of real photos you take yourself with a phone, to prove it's not overfit to the demo set.
- **Severity:** skip depth estimation entirely. Use a one-line heuristic: `severity = high if bbox_area/image_area > 0.08 else (medium if > 0.03 else low)`. Explainable, defensible in a demo, zero extra models.
- **GPS:** if you're not literally driving around, fake it — attach randomized-but-plausible lat/lon near a real location (e.g. jittered around a Mumbai coordinate) to each detection so the map looks real.
- **Duplicate/verification:** stub it. Either skip entirely for the demo, or a one-liner: if two reports are within ~20m and same class, mark the second as duplicate. Don't build real DBSCAN clustering in 2 days — mention it as "next step" in the demo narration.

---

## 4. Hour-by-hour plan

### Day 1

**Hour 0-0.5 (both):** Agree on the JSON contract (Section 2). Set up shared GitHub repo with `/ai` and `/backend` `/frontend` folders. Exchange nothing further until sync point.

**Hour 0.5-4 — Person A:**
- Install Ultralytics + pull a pretrained pothole YOLOv8 checkpoint from Roboflow Universe.
- Run it on 10-20 sample images, confirm bounding boxes look right.
- Write a small script `detect.py`: takes an image folder → runs model → outputs one JSON per image matching the contract (with faked GPS jitter + heuristic severity).
- **Checkpoint (hour 4):** you have a folder of real JSON outputs from real detections.

**Hour 0.5-4 — Person B:**
- Scaffold FastAPI (`/detect` accepts JSON matching contract, `/reports` returns list, `/map` returns GeoJSON), Postgres via Docker (plain Postgres is fine for 2 days — skip PostGIS setup overhead unless duplicate-check is prioritized).
- Scaffold Next.js app with a map (Leaflet + OpenStreetMap tiles — free, no API key needed) that calls `/map` and plots markers colored by severity.
- Build against the 10 fixture JSONs from Section 2 — don't wait for Person A.
- **Checkpoint (hour 4):** dashboard shows fixture pins on a map.

**Hour 4-4.5 (both, sync point):** Feed Person A's real JSON output into Person B's `/detect` endpoint. Fix any field-name mismatches. You should now see *real* detected potholes as pins on the map, with thumbnail images.

**Hour 4.5-8 — Person A:**
- Test the model against a slightly harder/varied image set (different lighting, angles) — write down failure cases for the demo narrative ("here's what we'd fine-tune next").
- If time allows: add a second class (crack) using the same pretrained model if it already supports it, or skip.
- Clean up `detect.py` into something that can run on a folder or a short video (extract frames with OpenCV, run detection per frame).

**Hour 4.5-8 — Person B:**
- Polish the map dashboard: click a pin → show image + confidence + severity + timestamp.
- Add a simple severity filter (low/med/high toggle).
- Add a basic upload endpoint so you can demo "drop a new image in, see it appear on the map live" (even if synchronous/no queue).

### Day 2

**Hour 0-3 — Person A:**
- Run the full pipeline on a real short video (phone dashcam clip you record yourselves, e.g. driving around your neighborhood) end to end: frames → detections → JSON batch.
- Tune confidence threshold to cut obvious false positives for the demo.

**Hour 0-3 — Person B:**
- Add a very basic list/table view of reports (id, class, severity, time) alongside the map — mirrors the "Authority Dashboard" from the PRD without building the rest.
- Basic loading states, error handling, so nothing visibly breaks mid-demo.

**Hour 3-3.5 (sync):** Run the real video's output JSON batch through the whole live system together, watch it populate the dashboard in real time. This is your actual demo dry run.

**Hour 3.5-6:** Bug-fix whatever broke in the dry run. This always eats more time than planned — don't schedule new features here.

**Hour 6-7 (both):** Prepare the demo narrative:
1. Show the pipeline diagram from the PRD.
2. Show real video → detections happening live (or pre-recorded run, played back).
3. Show the dashboard with real pins, click into a report.
4. Explicitly state what's next (fine-tuning on RDD2022, real duplicate clustering via PostGIS, repair workflow, security) — this shows you understand the full scope, not just what you rushed.

**Hour 7-8:** Buffer / rehearsal.

---

## 5. Sync points (only 3 — keep it lightweight)

| When | What |
|---|---|
| Day 1, hour 4 | Real model JSON plugged into real backend |
| Day 2, hour 3 | Full pipeline dry run on real video |
| Day 2, hour 6 | Demo narrative rehearsal |

Everything else, work independently — don't schedule extra meetings, they'll eat your 2 days.

---

## 6. Stack for the 2-day version (trimmed from full PRD stack)

- **Frontend:** Next.js + Tailwind + Leaflet (skip Mapbox, skip auth UI)
- **Backend:** FastAPI + plain Postgres (skip PostGIS/Redis/S3 — store images locally or in a single S3 bucket with no presigning fuss, or even just base64/local disk for the demo)
- **AI:** Ultralytics YOLOv8, pretrained checkpoint from Roboflow Universe — no training
- **Auth/security/notifications/repair workflow:** all skipped, called out explicitly as "next phase" in the demo

---

## 7. After the 2 days

Once the demo is done, the original full phased plan (PoC → MVP → Beta → Production, with RDD2022 fine-tuning, PostGIS clustering, fleet/admin dashboards, security hardening) is the roadmap to go from "working demo" to the real product described in the PRD. Nothing here contradicts it — this is just Phase 1, compressed and de-scoped to fit 2 days.
