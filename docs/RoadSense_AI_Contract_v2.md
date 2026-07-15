# RoadSense AI — Contract v2

**Status:** DRAFT — needs sign-off from both sides (§10)
**Parties:** Person A = AI / model (`/ai`) · Person B = Platform (`/backend`, `/frontend`)
**Rule:** once signed, this is **frozen**. Changing it costs a 10-minute sync, not a rewrite.

---

## 1. What changes from v1

| | v1 (Phase 1, today) | v2 (Phase 2) |
|---|---|---|
| How AI reaches the backend | AI writes JSON files to disk; backend reads them | Backend **calls the AI over HTTP** and gets detections back immediately |
| Coupling | File format | **`POST /infer` HTTP endpoint** |
| Who runs the model | Roboflow's hosted API | Person A's own service, local weights |

**v2 is additive.** Every existing fixture and all 57 committed JSONs remain valid — nothing you
have already built breaks.

---

## 2. The seam: two services, one contract

```
   Person B                                     Person A
   ┌──────────────────────┐   POST /infer   ┌──────────────────────┐
   │  backend (port 8000) │ ──────────────▶ │  AI service (8001)   │
   │                      │ ◀────────────── │  loads best.pt       │
   └──────────────────────┘   detections    └──────────────────────┘
        │                                          
        └── reads INFERENCE_URL from env.  Day 1 it points at B's own stub;
            later it points at A's real service. That swap is the ONLY
            integration step, and it is one environment variable.
```

**Person A implements `POST /infer`. Person B calls it. That is the entire seam.**

---

## 3. `POST /infer` — the endpoint Person A builds

### 3.1 Request

```
POST http://<ai-host>:8001/infer
Content-Type: multipart/form-data
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | file | **yes** | The image. `image/jpeg` or `image/png`. |
| `conf` | float | no | Confidence threshold override, `0.0`–`1.0`. Default **`0.5`**. |

Max image size: **10 MB**. Larger → `413`.

`curl` you can both test with:
```bash
curl -F "file=@frame_0008.jpg" http://localhost:8001/infer
```

### 3.2 Success response — `200 OK`

```json
{
  "model_version": "roadsense-yolov8s-v2",
  "image": { "width": 1280, "height": 720 },
  "inference_ms": 42,
  "detections": [
    {
      "class": "pothole",
      "confidence": 0.91,
      "bbox": [822.0, 573.0, 948.0, 661.0],
      "severity": "high"
    }
  ]
}
```

### 3.3 Field rules — the part that actually prevents bugs

| Field | Type | Rule |
|---|---|---|
| `model_version` | string | Non-empty. Identifies the weights that produced this. **Person A bumps it on every retrain.** |
| `image.width` / `image.height` | int | Pixel dimensions of the image **as the model saw it**. |
| `inference_ms` | int | Model time only, excluding network. This is how the PRD's `<100 ms/frame` gets measured. |
| `detections` | array | **May be empty. An empty array is a SUCCESS (`200`), never an error.** |
| `detections[].class` | string | **Always lowercase.** Allowed values in §3.4. *(Today's JSONs say `"Pothole"` — Person A normalises this at the source.)* |
| `detections[].confidence` | float | `0.0`–`1.0`. Already filtered by `conf`; the backend does **not** filter again. |
| `detections[].bbox` | `[float × 4]` | **`[x1, y1, x2, y2]`** — top-left and bottom-right, **absolute pixels**, origin top-left. Not centre-based. Not normalised. |
| `detections[].severity` | string | One of `low` \| `medium` \| `high`. **Person A owns this. The backend stores it verbatim and never recomputes it.** |

> **The bbox rule is not cosmetic.** The Roboflow API returns *centre-based* `(x, y, w, h)` and
> `detect.py:66-76` already converts it. YOLO natively gives `xyxy`. The contract locks `xyxy` so
> that conversion lives on Person A's side, once, forever.

### 3.4 Class enum

**Phase 2 ships:** `pothole` (live today) → then `crack`.

Full allowed set, so nobody has to renegotiate later:
```
pothole | crack | broken_road | water_filled_pothole | patch_repair | road_edge_damage | speed_breaker
```
`snake_case`, lowercase. Person A may ship a subset; Person B must not crash on any value from this list.

> `crack` is the priority second class: the dashboard **already has a `crack` filter button**
> (`page.js:273`) that currently matches nothing. Shipping `crack` lights up existing UI for free.

### 3.5 Errors

| Code | When | Body |
|---|---|---|
| `400` | File missing, or not a decodable image | `{"error": "invalid_image", "detail": "..."}` |
| `413` | Image > 10 MB | `{"error": "image_too_large", "detail": "..."}` |
| `503` | Model not loaded yet | `{"error": "model_unavailable", "detail": "..."}` |
| `500` | Anything else | `{"error": "inference_failed", "detail": "..."}` |

**"No potholes found" is NOT an error.** It is `200` with `"detections": []`. This is the single
most common way this kind of contract gets broken — pinning it down here.

### 3.6 `GET /health` (Person A also builds this)

```json
{ "status": "ok", "model_version": "roadsense-yolov8s-v2", "model_loaded": true }
```
Person B's backend uses this to show whether the AI service is up, instead of failing at request time.

---

## 4. `POST /detect-image` — the new backend endpoint Person B builds

This is what makes the dashboard's upload button **real**. Today it posts a hardcoded fake detection
(`page.js:134-151`: `confidence: 0.94`, `bbox: [120,220,310,420]`) with no model involved.

**Flow:**
```
browser → POST /detect-image (image)
            → backend saves image to /static/uploads
            → backend POSTs it to INFERENCE_URL  (§3)
            → backend persists the returned detections + model_version
            → returns the created report
```
If `detections` comes back empty, the backend **still creates the report** but the UI says *"no hazards
found"* rather than dropping a pin. Person A's service is stateless — it knows nothing about reports,
GPS, or vehicles. Those stay entirely on Person B's side.

---

## 5. Extended report payload (`POST /detect`)

Two **optional, nullable** additions to the v1 schema:

```json
{
  "report_id": "uuid",
  "vehicle_id": "demo-vehicle-1",
  "timestamp": "ISO8601",
  "gps": { "lat": 19.0760, "lon": 72.8777 },
  "speed_kmph": 34.5,
  "model_version": "roadsense-yolov8s-v2",
  "detections": [ /* exactly the shape from §3.2 */ ],
  "image_url": "/static/uploads/frame_0008.jpg"
}
```

| Field | Owner | Why |
|---|---|---|
| `speed_kmph` | Person A (from GPS track) | PRD lists speed as captured data; feeds severity later. |
| `model_version` | Person A (passthrough from `/infer`) | Lets a report be traced to the model that made it. Needed for the admin model registry. |

Both are **optional** — so all 57 existing JSONs and all 10 fixtures still validate. Backward
compatibility is deliberate, not accidental.

---

## 6. Decisions taken (flag now if either of you disagrees)

These were genuine forks. I picked one each; they are cheap to change **now** and expensive later.

1. **Severity is computed by the AI, not the backend.** The AI has the image, the bbox geometry, and
   later the depth model — the backend has none of that. Backend stores it as an opaque string.
2. **`/infer` is stateless: image in, detections out.** No GPS, no `report_id`, no DB. Keeps the AI
   service trivially testable and independently deployable.
3. **`multipart/form-data`, not base64 JSON.** Base64 inflates payloads ~33% and `detect.py` already
   pays that cost against Roboflow. Multipart is also what FastAPI's `UploadFile` handles natively —
   Person B's `/upload` (`main.py:155`) already does exactly this.
4. **Synchronous, one image per call.** No queue, no batch endpoint yet. A video is just N calls from
   a loop on Person A's side. Add batching only if it actually proves too slow.
5. **The backend never re-filters by confidence.** The AI applies `conf` and returns only survivors.
   One place to tune, not two.

---

## 7. How you both work without ever waiting

**Person B does not wait for Person A.** Write a ~20-line stub first:

`backend/stub_infer.py` — a FastAPI app on port 8001 serving `POST /infer` per §3, returning random
plausible detections, and **sometimes an empty `detections: []`** so the no-detection path is exercised
from day one. Point `INFERENCE_URL` at it and build everything in Part 6 of the Phase-2 plan.

**Person A ships `/infer` early — before the model is good.** A rough model behind a correct endpoint
unblocks Person B immediately; A then improves the model behind an endpoint that never changes.

**Integration = changing one env var:**
```
INFERENCE_URL=http://localhost:8001   # stub → real service. Nothing else changes.
```

---

## 8. Acceptance tests — each side runs these ALONE

Neither test needs the other person present. That is the point.

**Person A ships when all of these pass:**
- [ ] `curl -F "file=@pothole.jpg" localhost:8001/infer` → `200`, non-empty `detections`, `bbox` is `xyxy` absolute pixels.
- [ ] `curl -F "file=@blank_wall.jpg" localhost:8001/infer` → **`200`** with `"detections": []`. Not a 404. Not a 500.
- [ ] `curl -F "file=@notanimage.txt" localhost:8001/infer` → `400`.
- [ ] Every `class` returned is lowercase and in the §3.4 enum.
- [ ] `GET /health` → `200` with `model_loaded: true`.
- [ ] It all works **with Wi-Fi off** (no Roboflow, no hosted API).

**Person B ships when all of these pass:**
- [ ] Backend calls `INFERENCE_URL` and persists what it returns, against the **stub**.
- [ ] Uploading an image with **zero** detections creates a report and shows *"no hazards found"* — no pin.
- [ ] Uploading a **non-road image produces no pothole pin.** ← the real fix for the fake-upload bug.
- [ ] AI service down → the dashboard shows a clear error, does not hang or crash.
- [ ] `model_version` is stored and visible on the report.
- [ ] All 10 existing fixtures + all 57 committed JSONs still ingest fine (backward compat).

---

## 9. Changing this contract

If either side needs a change: propose it, both agree, **bump the version in this file**, both update.
Never silently change a field name — that is exactly the class of bug this document exists to prevent.

---

## 10. Sign-off

- [ ] **Person A (Shlok — AI):** I will implement `POST /infer` and `GET /health` exactly as in §3,
      normalise classes to lowercase, emit `xyxy` absolute-pixel bboxes, own severity, and return
      `200 + []` when nothing is detected.
- [ ] **Person B (Platform):** I will call `INFERENCE_URL` per §3, build `POST /detect-image` per §4,
      store `severity` and `model_version` verbatim, never recompute severity or re-filter confidence,
      and build against my own stub until A's service is live.

**Once both boxes are ticked, stop talking and start coding. No further sync is needed until
Person A's service is up (S1).**
