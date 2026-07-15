# RoadSense AI — Post-Phase-1 Audit & Phase 2 Workflow

**Status date:** 2026-07-14
**Repo:** `RoadSense_AI/` (git, remote `github.com/vishnurj06/RoadSense_AI.git`)
**Local AI sandbox:** `roadsense-ai/` (**not** under version control — see D-4)

> **How this audit was produced:** by reading the source, the trained weights, the
> training metrics CSV, all 57 detection JSONs, the git history, and the CI config.
> The application was **not executed**. Every claim below cites a file. Anything I
> could not verify by reading is explicitly marked *UNVERIFIED*.

---

## Part 1 — What Is Actually Done

### 1.1 Person B (Platform) — substantially complete

| Component | Evidence | State |
|---|---|---|
| FastAPI app | `backend/main.py` | Working |
| `POST /detect` | `main.py:47` | Working |
| `GET /reports` | `main.py:101` | Working |
| `GET /map` (GeoJSON) | `main.py:107` | Working |
| `POST /upload` | `main.py:155` | Working |
| `GET /analytics` | `main.py:175` | Working |
| DB models + cascade | `backend/models.py` | Working |
| Pydantic contract | `backend/schemas.py` | Working |
| Postgres via Docker | `docker-compose.yml` | Working |
| Next.js + Leaflet map | `frontend/src/app/page.js`, `components/MapComponent.js` | Working |
| Severity colour pins | `MapComponent.js:21` | Working |
| Severity + class filters | `page.js:47`, `page.js:52` | Working |
| Report list view | `page.js:317` | Working |
| Stats tiles | `page.js:214` | Working |
| Bulk ingest scripts | `bulk_ingest.py`, `backend/load_fixtures.py` | Working |
| CI (ruff + pytest) | `.github/workflows/ci.yml`, `backend/test_api.py` | Present |

### 1.2 Person A (AI) — pipeline runs, but not the way the plan assumed

| Component | Evidence | State |
|---|---|---|
| Frame extraction | `roadsense-ai/extract_frames.py` | Working |
| Detection → contract JSON | `roadsense-ai/detect.py` | Working |
| Severity heuristic | `detect.py:23` (bbox-area ratio) | Working |
| Fake GPS jitter | `detect.py:33` | Working |
| 57 frames processed | `ai/outputs/*.json` (57 files, committed) | Done |
| **Custom trained model** | `runs/detect/train-2/weights/best.pt` | **Trained but UNUSED** |

**Training run that actually happened** (`runs/detect/train-2/`, from `args.yaml` + `results.csv`):

- Base: `yolov8n.pt` · Data: Roboflow `pothole-detection-3` · **12 epochs, CPU, imgsz 416**
- Final epoch metrics: **precision 0.588 · recall 0.542 · mAP50 0.556 · mAP50-95 0.239**
- Train **and** val losses were **still falling at epoch 12** → the model is **undertrained**, not converged.

Measured against the PRD targets (precision ≥95%, recall ≥90%), this model is far off. That is
completely normal for 12 CPU epochs — it just means training is unfinished, not that the approach is wrong.

### 1.3 Phase-1 verdict

**Phase 1 (PoC) is functionally achieved** — real video → detections → GPS-tagged JSON → DB → live map.
Everything the 2-day plan asked for exists. The gaps below are *debt created by hitting that deadline*,
not missing features. Deal with them first, because three of them will silently undermine Phase 2.

---

## Part 2 — Defects & Debt (fix before building anything new)

Ordered by how much damage they do if ignored.

### D-1 · The trained model is orphaned — **critical**
`detect.py:10-12` points at Roboflow's **hosted API**:
```python
API_KEY = "8ZUvzd7NLKIoKpzc5X3A"
MODEL_ID = "pothole-detection-jswnj/3"
API_URL = f"https://detect.roboflow.com/{MODEL_ID}?api_key={API_KEY}"
```
`best.pt` is never loaded by anything. Consequences: the whole pipeline needs **internet + a
third-party service** to run; you cannot demo offline; you have no control over the model version;
and the training work is currently worth nothing. **Fix: run inference locally from `best.pt`.**

### D-2 · The API key is hardcoded — **critical**
The key is in plaintext in `detect.py`. It is **not** in git history today only because `detect.py`
is untracked (verified with `git log -S`). The moment Person A commits their code — which D-4 requires —
**the key leaks publicly**. **Rotate the key and move it to `.env` before committing any AI code.**

### D-3 · The dashboard upload flow is fake — **high**
`page.js:134-151` uploads the image, then POSTs a **hardcoded, invented detection**:
```js
detections: [{ class: "pothole", confidence: 0.94,
               bbox: [120, 220, 310, 420], severity: "high" }]
```
No model runs. Every uploaded image — a cat, a blank wall — produces a 94%-confidence "high severity
pothole" pin. This is the single most likely thing to be caught in a demo. It must be wired to real
inference (that is the core of Phase 2's integration).

### D-4 · Person A's code is not in the repo — **high**
`git ls-files ai/` returns **only the 57 output JSONs**. `detect.py`, `extract_frames.py`,
`get_model.py`, and all training code live in the untracked `roadsense-ai/` folder. There is no
version control, no review, no backup, and no way for Person B to reproduce a detection run.

### D-5 · Detection yield is low
Of 57 frames: **45 produced zero detections**, 12 produced one each. Total = 12 detections. Also
`detect.py` sets **no confidence threshold**, so it accepts Roboflow's default (~0.4) — the sample in
`frame_0008.json` is a **0.415**-confidence detection. Low-confidence noise is entering the DB unfiltered.

### D-6 · Severity heuristic is unvalidated
Across all 12 detections: **10 high, 2 low, 0 medium**. The `medium` band
(`0.03 < ratio ≤ 0.08`, `detect.py:23`) has **never once fired**. The sample is too small to call it
broken, but it is entirely unvalidated and bbox area is a poor proxy for depth.

### D-7 · PRD scope not yet started
Not implemented at all: `POST /verify` (duplicate clustering), `POST /repair` (repair workflow), JWT
auth, role-based access, notifications, fleet dashboard, admin dashboard, PostGIS, Redis, S3.
6 of the 7 PRD detection classes are missing (only `Pothole` exists) — note the frontend already
offers a **`crack` filter that can never match anything** (`page.js:273`).

### D-8 · Minor
- `frontend/node_modules` is absent — a fresh clone needs `npm install`. (*Expected; noted for onboarding.*)
- `MapComponent.js:10` loads marker images from the **unpkg CDN** → map pins break offline.
- `POST /detect` handles a duplicate `report_id` by **delete-then-recreate** (`main.py:57-63`) — fine
  for a PoC, unsafe under concurrency.
- GPS is randomly jittered around Mumbai (`detect.py:33`). No real GPS anywhere in the system.
- *UNVERIFIED:* whether the frontend builds and renders — I read the code but never ran `npm run dev`.

---

## Part 3 — The Independence Model (read this before splitting work)

The 2-day plan kept you unblocked with a **JSON contract**. That worked because the AI side was a
*batch script* — it wrote files, Person B read them.

**Phase 2 breaks that**, because fixing D-3 means the backend must call the model **live**. That is a
real runtime dependency, and if handled naively Person B waits for Person A.

**The fix: Person A ships an HTTP inference service, and Person B builds against a stub of it.**

```
                    ┌─────────────────────────────────────────┐
                    │  THE ONLY SEAM: POST /infer             │
                    │  (contract v2, agreed once, §4)         │
                    └─────────────────────────────────────────┘
                            ▲                       ▲
             implements     │                       │   calls
                            │                       │
   ┌────────────────────────┴──────┐   ┌────────────┴─────────────────────┐
   │ PERSON A                      │   │ PERSON B                         │
   │ ai/infer_service.py           │   │ backend calls INFERENCE_URL      │
   │ (real YOLO, local best.pt)    │   │                                  │
   │                               │   │ Day 1: INFERENCE_URL → own stub  │
   │ Works on model quality,       │   │ Day N: INFERENCE_URL → A's real  │
   │ training, classes, severity   │   │        service. One env var.     │
   └───────────────────────────────┘   └──────────────────────────────────┘
```

**Rules that make this work:**

1. **Person B writes their own stub inference service on day one** (`backend/stub_infer.py`, ~20 lines,
   returns contract-shaped fake detections). B is never blocked, ever.
2. The switch from stub → real is **one environment variable**: `INFERENCE_URL`. No code change.
3. **Neither person edits the other's folder.** A owns `/ai`. B owns `/backend` + `/frontend`.
4. **Contract v2 is agreed once (§4), then frozen.** Any change to it = a 10-minute sync, not a rewrite.
5. Work on **separate git branches**, merge via PR. `ai/**` and `backend/**` never collide.

---

## Part 4 — Contract v2 (agree once, together, ~45 min — the ONLY mandatory sync)

### 4.1 Inference service — `POST /infer` (Person A implements, Person B consumes)

Request: `multipart/form-data` with `file` (an image).

Response `200`:
```json
{
  "model_version": "roadsense-yolov8n-v2",
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

**Frozen rules — these are what actually prevent integration pain:**
- `class` is **always lowercase** (today's JSONs say `"Pothole"` — normalise it).
- `bbox` is **always** `[x1, y1, x2, y2]` in **absolute pixels**.
- `severity` ∈ `{low, medium, high}` — **Person A owns this decision**, backend never recomputes it.
- `detections: []` (empty array) is a **valid, successful** response — not an error.
- Every response carries `model_version`, so a report can be traced to the model that produced it.

### 4.2 Report payload — additions to `POST /detect`

Extend, do not break, the existing contract:
```json
{
  "report_id": "uuid",
  "vehicle_id": "demo-vehicle-1",
  "timestamp": "ISO8601",
  "gps": { "lat": 19.0760, "lon": 72.8777 },
  "speed_kmph": 34.5,
  "model_version": "roadsense-yolov8n-v2",
  "detections": [ /* as above */ ],
  "image_url": "/static/uploads/frame_0008.jpg"
}
```
`speed_kmph` and `model_version` are **optional/nullable** — so **every existing fixture and all 57
committed JSONs keep working unchanged**. This is deliberate: nothing you have already built breaks.

---

## Part 5 — PERSON A TRACK (AI / Model)

> Owns `/ai` only. Never touches `/backend` or `/frontend`.
> Blocks nobody after §4 is agreed.

### A-0 · Repo hygiene — **do this first, before anything else**
- [ ] **Rotate the Roboflow API key** (the current one is compromised by exposure). *(D-2)*
- [ ] Move `roadsense-ai/*.py` into the repo at `ai/` — `detect.py`, `extract_frames.py`, `get_model.py`. *(D-4)*
- [ ] Key/config → `.env` + `ai/.env.example`. Confirm `.env` is gitignored (**it already is**). *(D-2)*
- [ ] Add `ai/requirements.txt` (`ultralytics`, `opencv-python`, `fastapi`, `uvicorn`, `python-dotenv`).
- [ ] Add `ai/README.md`: how to run detection end-to-end from a clean clone.
- [ ] **Never commit** `best.pt`, `venv/`, `dashcam.mp4`, or `pothole-detection-3/` (add to `.gitignore`).
- **Done when:** a teammate can clone, `pip install -r ai/requirements.txt`, and run detection. No secret in git.

### A-1 · Kill the hosted-API dependency — **the highest-value fix you have** *(D-1)*
- [ ] Rewrite `detect.py` to load a **local** checkpoint via `ultralytics.YOLO(...)` instead of `requests.post`.
- [ ] Make the weights path configurable (`MODEL_PATH` env var), defaulting to your trained `best.pt`.
- [ ] Add a **confidence threshold** (`conf=0.5`, configurable) — currently there is none. *(D-5)*
- [ ] Normalise class names to **lowercase** at the source. *(§4.1)*
- [ ] Re-run on the 57 frames; compare detection count against the current 12 and write down the delta.
- **Done when:** the pipeline runs with **Wi-Fi off** and emits contract-v2 JSON.

### A-2 · Train the model properly — this is your real deliverable
The current model is 12 CPU epochs and was still improving when it stopped.
- [ ] Move training to **GPU** — Google Colab / Kaggle free tier. CPU training is why you stopped at 12.
- [ ] Retrain: **≥100 epochs**, `imgsz=640` (up from 416), `patience=20` for early stopping.
- [ ] Consider `yolov8s` over `yolov8n` — nano is the smallest model; you have headroom.
- [ ] Log per-run metrics into `ai/experiments.md`: run name, epochs, imgsz, P / R / mAP50 / mAP50-95.
- [ ] **Baseline to beat: P 0.588 · R 0.542 · mAP50 0.556 · mAP50-95 0.239.**
- **Done when:** mAP50 ≥ 0.75 and the trend across runs is recorded. *(PRD's 95% is a Phase-3/4 target, not this one.)*

### A-3 · Expand the dataset & class list *(D-7)*
- [ ] Add **RDD2022** (Road Damage Detection) — it is the standard multi-class road-damage dataset.
- [ ] Target classes, in priority order: `pothole` → `crack` → `patch_repair` → the rest of the PRD's 7.
- [ ] **`crack` is the highest-value second class** — the dashboard already has a filter button for it
      that currently matches nothing (`page.js:273`). Shipping `crack` lights up existing UI for free.
- [ ] Re-run A-2 training on the combined dataset.
- **Done when:** the model emits ≥2 classes and `ai/experiments.md` shows per-class mAP.

### A-4 · Ship the inference service — **this is Person B's unblock** *(D-3)*
- [ ] Build `ai/infer_service.py`: a small FastAPI app exposing `POST /infer` exactly per §4.1.
- [ ] Load the model **once at startup**, not per request.
- [ ] Return `{"detections": []}` with `200` when nothing is found — never a 4xx/5xx.
- [ ] Include `inference_ms` (the PRD's <100ms/frame target is measured here).
- [ ] Add `ai/Dockerfile` so B can `docker compose up` it without a Python environment.
- **Done when:** `curl -F file=@frame.jpg localhost:8001/infer` returns contract-v2 JSON.
- **Deliver early.** Even a slow, mediocre-accuracy version unblocks B's real integration. **Ship it
  before A-2/A-3 are finished** — B can then swap off the stub while you keep improving the model
  behind the same unchanged endpoint.

### A-5 · Real severity estimation *(D-6)*
- [ ] Validate the current heuristic — the `medium` band has **never fired** across all 12 detections.
- [ ] Recalibrate thresholds against a hand-labelled set of ~50 detections.
- [ ] Upgrade beyond bbox-area: add **monocular depth** (MiDaS / Depth-Anything) for a real depth proxy,
      and/or normalise bbox size by vertical image position (things lower in frame are nearer the camera).
- **Done when:** all three severity buckets are populated and the mapping is documented.

### A-6 · Real GPS *(D-7)*
- [ ] Stop faking GPS (`detect.py:33`).
- [ ] Read GPS from video/EXIF metadata, or record a phone GPS track (GPX) and interpolate per frame timestamp.
- [ ] Emit `speed_kmph` per §4.2 (derive from consecutive GPS fixes).
- **Done when:** a recorded drive produces a coherent GPS track on the dashboard, not a random cloud.

---

## Part 6 — PERSON B TRACK (Platform)

> Owns `/backend` + `/frontend` only. Never touches `/ai`.
> **Blocked by nobody — B-0 exists precisely to guarantee that.**

### B-0 · Build the stub inference service — **do this first; it is your independence** *(§3)*
- [ ] Write `backend/stub_infer.py`: a tiny FastAPI app on port 8001 serving `POST /infer` per §4.1,
      returning **plausible random** detections (random class, confidence, bbox, severity — including
      sometimes an **empty** `detections: []`, so you handle the no-detection path from day one).
- [ ] Add `INFERENCE_URL` to backend config, defaulting to the stub.
- [ ] Add the stub to `docker-compose.yml` as a service.
- **Done when:** your backend calls `INFERENCE_URL` and gets contract-v2 JSON — **with Person A's work
  not yet started**. From here you can build every remaining item without ever waiting.

### B-1 · Make the upload flow real — **your highest-value fix** *(D-3)*
- [ ] New endpoint `POST /detect-image`: accept an image → save it → **call `INFERENCE_URL`** → persist
      the returned detections → return the created report.
- [ ] Rewrite `page.js:106` `handleImageUpload` to call `/detect-image` and **delete the hardcoded
      `confidence: 0.94` / `bbox: [120,220,310,420]` payload** (`page.js:134-151`).
- [ ] Handle the empty-detections case in the UI ("no hazards found") instead of always dropping a pin.
- [ ] Surface `model_version` on the report detail view.
- **Done when:** uploading a **non-road** image produces **no pothole pin**. That is the acceptance test.

### B-2 · PostGIS + real duplicate verification *(D-7 — the PRD's core differentiator)*
- [ ] Swap `postgres:15-alpine` → `postgis/postgis:15-3.4` in `docker-compose.yml`.
- [ ] Add a `geometry(Point, 4326)` column to `reports`; add a **GiST index**.
- [ ] Introduce **Alembic** migrations — `create_all()` (`main.py:15`) will not survive a schema change.
- [ ] Implement `POST /verify`: cluster reports within **~20 m** of the same class (`ST_DWithin`),
      collapse them into one **verified issue**, and count repeat detections.
- [ ] Add an `issues` table (a verified issue ← many reports). Track `detection_count` per issue.
- [ ] Surface on the map: one pin per **issue**, with a "confirmed by N reports" badge.
- **Done when:** ingesting the same pothole from 3 nearby frames yields **1** issue, not 3.
- *This is the PRD's "duplicate reduction >80%" metric — it is the feature that makes RoadSense more
  than a YOLO demo.*

### B-3 · Repair workflow *(D-7)*
- [ ] Add a `status` field to issues: `detected → verified → assigned → inspection → repair → completed → closed`.
- [ ] Implement `POST /repair` to transition status; **reject illegal transitions**.
- [ ] Add an `audit_log` table (who changed what, when) — the PRD requires audit logs.
- [ ] Frontend: status badge on each issue + a dropdown to advance it; add a status filter.
- **Done when:** an issue can be walked through the full lifecycle from the dashboard and the audit log shows it.

### B-4 · Auth & roles *(D-7)*
- [ ] JWT auth: `POST /auth/login`, `POST /auth/register`. Hash passwords with **bcrypt/argon2**.
- [ ] Roles: `authority`, `fleet`, `admin`. Enforce with a FastAPI dependency.
- [ ] Protect every mutating endpoint. Keep `GET /map` public **only if** you consciously choose to.
- [ ] Frontend: login page, token in an httpOnly cookie, route guards.
- [ ] **Lock down CORS** — `allow_origins=["*"]` (`main.py:24`) must not ship to production.
- **Done when:** an unauthenticated `POST /repair` returns **401**.

### B-5 · Dashboards *(D-7)*
- [ ] **Authority:** analytics charts (severity over time, hotspot ranking), pending-repair queue.
- [ ] **Fleet:** vehicle list, per-vehicle detection history, last-seen / camera-health indicator.
- [ ] **Admin:** user management, model-version registry (uses `model_version` from §4.2), system health.
- [ ] Extend `GET /analytics` (`main.py:175`) to serve the time-series these need.
- **Done when:** all three roles land on a distinct, working dashboard.

### B-6 · Production hardening
- [ ] **S3** (or MinIO locally) for images — replace `static/uploads` local disk (`main.py:31`).
- [ ] **Redis** cache for `/map` and `/analytics`.
- [ ] Pin marker icons **locally** — stop loading them from unpkg (`MapComponent.js:10`). *(D-8)*
- [ ] Pagination on `/reports` (`main.py:101` currently returns **every** row — it will not scale).
- [ ] Structured logging + a `/health` endpoint.
- [ ] Extend CI: frontend build + lint (it currently covers **backend only**).
- **Done when:** `/map` p95 < 2 s (the PRD's dashboard-load target) with ~10k reports seeded.

---

## Part 7 — Sync Points (deliberately few)

| # | When | Who | What | Duration |
|---|---|---|---|---|
| **S0** | **Before any Phase-2 code** | Both | **Agree & freeze Contract v2 (§4).** Mandatory. | ~45 min |
| S1 | A finishes A-4, B finishes B-1 | Both | Point `INFERENCE_URL` at A's real service. Delete the stub. | ~30 min |
| S2 | A finishes A-3 (multi-class) | Both | B confirms new classes render; enable the dead `crack` filter. | ~15 min |
| S3 | End of Phase 2 | Both | Full dry run on a fresh clone + demo rehearsal. | ~2 h |

Everything else is asynchronous. **After S0, neither person can block the other** — that is the whole
point of B-0 (the stub) and A-4 (shipping the service early, even when imperfect).

---

## Part 8 — Suggested Order

Each track is **strictly sequential within itself** and **fully parallel across tracks**.
Effort figures are rough estimates, not commitments.

```
        PERSON A                              PERSON B
        ─────────────────────────             ─────────────────────────
  S0 ── Contract v2 (§4) ────────────────────── Contract v2 (§4) ──┐  MANDATORY, TOGETHER
        │                                       │                  │
   1    A-0  repo hygiene + key rotation        B-0  stub service  │  ~0.5 d  ← unblocks B forever
   2    A-1  local inference (kill API)         B-1  real upload   │  ~1 d    ← kills D-1 / D-3
   3    A-4  ship /infer service ───────────▶   (B swaps stub out) │  ~1 d    ← EARLY, even if rough
   4    A-2  proper GPU training                B-2  PostGIS+verify│  ~2-3 d  ← the PRD differentiator
   5    A-3  multi-class + RDD2022              B-3  repair flow   │  ~2-3 d
   6    A-5  real severity                      B-4  auth + roles  │  ~2 d
   7    A-6  real GPS                           B-5  dashboards    │  ~2-3 d
   8    ─                                       B-6  hardening     │  ~2 d
        │                                       │                  │
  S3 ── Integration + demo ──────────────────── Integration ───────┘
```

**Note the ordering choice in step 3:** Person A ships the inference *service* **before** finishing
training. A rough model behind a correct endpoint unblocks Person B immediately; A then improves the
model behind an endpoint that never changes. Doing it the other way round — perfecting the model first —
would leave Person B stuck on the stub for a week.

---

## Part 9 — Definition of Done for Phase 2 (MVP)

- [ ] **No hosted-API dependency.** The whole pipeline runs offline. *(D-1)*
- [ ] **No secrets in the repo.** Old Roboflow key rotated. *(D-2)*
- [ ] **The upload flow is real.** A non-road image produces **zero** detections. *(D-3)*
- [ ] **All AI code is in git**, reproducible from a clean clone. *(D-4)*
- [ ] **Model beats the Phase-1 baseline** (P 0.588 / R 0.542 / mAP50 0.556) and it is written down. *(D-5)*
- [ ] **≥2 detection classes**, so the existing `crack` filter finally matches something. *(D-7)*
- [ ] **Duplicate clustering is real** (PostGIS), not a stub — 3 nearby reports → 1 issue. *(D-7)*
- [ ] **Repair workflow** walks an issue end-to-end, with an audit log. *(D-7)*
- [ ] **Auth works.** Unauthenticated writes are rejected. CORS is locked down. *(D-7)*
- [ ] **All three severity buckets** are populated by real data. *(D-6)*
- [ ] CI is green on backend **and** frontend.

---

## Part 10 — Honest Risk Notes

1. **The PRD's precision ≥95% / recall ≥90% targets are not a Phase-2 goal.** You are at P 0.588 /
   R 0.542. Getting to 95% needs a large, well-labelled, domain-matched dataset and serious training —
   not a weekend. Target **mAP50 ≥ 0.75** for Phase 2 and be transparent that 95% is a Phase-3/4 goal.
2. **`<100 ms/frame` will not hold on CPU.** That number implies GPU inference or a quantised/ONNX
   export. Measure it honestly (`inference_ms`, §4.1) and state the hardware alongside it.
3. **Do not skip Alembic (B-2).** `models.Base.metadata.create_all()` (`main.py:15`) does **not** alter
   existing tables. The first schema change will silently do nothing and cost you hours of confusion.
4. **Rotate the Roboflow key even though it never reached GitHub.** It has been sitting in plaintext on
   two machines; treat it as burned.
5. **Delete the `roadsense-ai/` folder once A-0 is done.** Two divergent copies of the AI code is a
   guaranteed source of "but it works on my machine".
