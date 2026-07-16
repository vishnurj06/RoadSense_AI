# RoadSense AI — Continuous Memory and Context Log (Phase 2 - MVP)

This file is the canonical progress tracker for the entire RoadSense AI project (Backend, Frontend,
and AI Pipeline). Updated after every completed and verified task.
Last audited: **2026-07-16** (full codebase read-through by Senior Technical Architect).

## Project Metadata

| Field | Value |
|---|---|
| **Project Name** | RoadSense AI (Platform) |
| **Role** | Person B (Backend & Frontend Platform Owner) |
| **Sprint** | Phase 2 (Local Development / MVP) — Platform ✅ Done · AI ⚠️ Partial |
| **Tech Stack** | FastAPI · Next.js · Tailwind CSS · Leaflet (OpenStreetMap) · PostgreSQL + PostGIS (Docker) · Redis · MinIO (S3-compatible) · YOLOv8s (ultralytics) |
| **Repo** | `github.com/vishnurj06/RoadSense_AI` |

---

## 1. Architectural Decisions

### A. Image Storage & Handling
- **Decision (B-1 → B-6 upgrade):** Images are uploaded directly to MinIO (local S3-compatible object store)
  via `backend/s3_storage.py`. The FastAPI backend calls `upload_image_bytes_to_s3()` and stores the
  resulting public URL (`http://localhost:9000/roadsense/<uuid>_<filename>`) in the `reports.image_url`
  column. `backend/static/uploads/` is no longer used for new uploads.
- **Bucket:** `roadsense` (auto-created with public-read policy on startup via `init_s3_bucket()`).
- **Config env vars:** `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`.

### B. Next.js Architecture
- **Decision:** Next.js App Router (JavaScript) with Tailwind CSS. Leaflet `MapComponent` is loaded
  with `next/dynamic` + `{ ssr: false }` to avoid `window is not defined` SSR errors.

### C. CI/CD Linting & Formatting
- **Decision:** `ruff` for backend checks. ESLint (`npm run lint`) + production build (`npm run build`)
  for the frontend. Both run as separate parallel jobs in `.github/workflows/ci.yml`.

### D. Database Schema & Spatial (PostGIS)
- **Decision:** `postgis/postgis:15-3.4` image (`roadsense-db`). `reports` and `issues` tables both
  have a `geometry(Point, 4326)` column with a GiST index. Alembic manages all schema migrations.
  `models.Base.metadata.create_all()` is intentionally disabled — all schema changes go through Alembic.
- `ST_DWithin` (Geography cast) clusters reports within **20 m** of the same location into one `Issue`.

### E. AI Inference Integration (Contract v2)
- **Seam:** `POST /infer` on port 8001. Request: `multipart/form-data { file }`. Response: `{ model_version, image, inference_ms, detections: [{ class, confidence, bbox, severity }] }`.
- **Switch:** `INFERENCE_URL` env var (default: `http://localhost:8001` → stub). One env-var swap to point at Person A's real service.
- **Stub:** `backend/stub_infer.py` — tiny FastAPI app that returns plausible random detections (including empty arrays).
- **Real service:** `ai/infer_service.py` — Contract v2-compliant FastAPI app loading `ai/weights/best.pt` (yolov8s **v3-merged**, 2 classes) once at startup.

### F. Redis Caching (B-6)
- **Decision:** `redis:7-alpine` container (`roadsense-redis`, port 6379).
- `GET /map` and `GET /analytics` read from cache key before hitting the DB. TTL: **300 s (5 min)**.
- **Invalidation:** `clear_all_caches()` is called at the end of every mutating endpoint
  (`POST /detect`, `POST /detect-image`, `POST /repair`, `POST /verify`), ensuring instant
  consistency when data changes.
- **Graceful degradation:** If Redis is unavailable at startup, `redis_client` is set to `None`
  and all cache operations are no-ops — the server never crashes due to a missing cache.

### G. MinIO / S3 Integration (B-6)
- `boto3` connects to `http://localhost:9000` (or `S3_ENDPOINT_URL`). Credentials default to
  `minioadmin / minioadmin`. `init_s3_bucket()` is called at module load time.

### H. AI Model (A-1 / A-2 / A-3)
- **Current weights:** `ai/weights/best.pt` = **`v4-all`** (yolov8s, 22.5 MB, T4 GPU), trained on
  `pothole-detection-3` + **RDD2022 all 6 countries** (non-pothole images subsampled 1-in-3 to
  balance; every pothole kept) + 57 hard negatives = **11,976 images** (8,750 pothole / 13,443 crack
  boxes).
- **Two classes:** `pothole` **and `crack`** — the dashboard's `crack` filter matches.
- **Confidence threshold:** `CONF_THRESHOLD=0.29` (F1-optimal, 0.54 at 0.292; env-configurable).
- **Inference:** fully offline — no Roboflow, no API key, no network required.
- **Real-footage validation (the ship gate — RDD test AP has never decided anything here):**
  **109/122 pothole frames** across two videos, **0/57 false positives**. vs `v3-merged`: better on
  potholevideos (45→**51**/55, at every threshold) but worse on the india video (60→**58**/67); net
  **+15% detections** (178→204). An honest marginal call, not a clean win. See `ai/experiments.md`.
- **Previous:** `v3-merged` preserved at `weights/best-v3-merged.pt` (registry keeps its entry too).

> 🔬 **The most important result in the project.** `v4-all` was the **data-scale experiment**: 4x the
> data (5.4k → 27k images, 6 countries) produced a **marginal, mixed** real-world change. Together
> with `v2-2` (bigger model + 4x epochs + higher res → **0.556 → 0.550**, i.e. nothing), that is
> **two falsified hypotheses**. **The ceiling is LABEL QUALITY, not data quantity and not training
> config.** mAP50 ≥ 0.75 and the PRD's 95% precision are **not reachable by scaling this approach** —
> show anyone who proposes "just train longer / feed it more" the table in `ai/experiments.md`.

### H2. Model registry (A3-7) — **how to get the weights, no longer "ask Person A"**
- **`ai/models.json`** is the registry: the single source of truth for which model is current, its
  classes, `CONF_THRESHOLD`, real-footage numbers and **known weaknesses**.
- **`python fetch_model.py`** downloads the default model to `weights/best.pt` and **verifies SHA256**
  before installing; a mismatch is a hard error (exit 1), never a warning.
  `python fetch_model.py --list` prints every version with its real numbers.
- Repo is private → set `GITHUB_TOKEN` (repo scope). GitHub returns **404, not 401**, for a private
  asset without auth, so the script calls that out explicitly.
- Weights still never enter git — only the registry entry does.

- **Released:** tag `model-v3-merged` → asset `best-v3-merged.pt` (proven end-to-end with a real
  token: downloads, SHA256-verifies, loads).
  ⚠️ **`model-v4-all` is registered in `models.json` but the release asset is NOT published yet** —
  Person A must upload `best-v4-all.pt` under tag `model-v4-all`, or `fetch_model.py` will 404 on the
  new default. Until then, `--version roadsense-yolov8s-v3-merged` still works.
- **Token:** a collaborator needs a **classic** token with `repo` scope — a *fine-grained* token is
  scoped to its resource owner and cannot see a repo owned by someone else. The owner can use either.

> ⚠️ **`best.pt` is gitignored** — the repo alone cannot tell you the model's class count or version.
> That gap caused the 2026-07-16 audit to report the model as single-class, **and** caused the
> `3a3aa52`/`1f01eb2` merge to revert A-5 (the person merging could not run the AI code to see which
> side of the conflict was current). **`fetch_model.py` + `models.json` end this — use them instead
> of asking.** *(D-1 closed 2026-07-16.)*

### I. GPS (A-6)
- `ai/gps.py` resolves each report's position from **EXIF GPS tags**, else an interpolated **GPX
  track** (`--gpx` + `--fps`), else faked jitter as a loud last resort.
- `speed_kmph` (Contract v2 §4.2) is now emitted — `null` when genuinely unknown.
- Faked GPS is no longer silent: runs print `WARNING: N of M reports carry FAKED GPS` and a
  `GPS sources: {...}` breakdown.

---

## 2. Phase 2 Progress Summary

### Platform Track (Person B)

| Task | Description | Status | Verified Notes |
|---|---|---|---|
| **B-0** | Stub inference service (`backend/stub_infer.py`) | ✅ Completed | Port 8001, `POST /infer`, plausible random detections + empty arrays. |
| **B-1** | Real upload flow (`POST /detect-image` + Next.js) | ✅ Completed | Saves image to S3, calls `INFERENCE_URL`, returns report, sliding toasts. |
| **B-2** | PostGIS + spatial duplicate verification (`POST /verify`) | ✅ Completed | `ST_DWithin` 20 m clustering, GiST index, Alembic migrations. |
| **B-3** | Repair workflow (`POST /repair` + audit log) | ✅ Completed | Full lifecycle state machine, `IssueAuditLog` table, map popup dropdowns. |
| **B-4** | Auth & Roles (JWT, bcrypt, role-based deps) | ✅ Completed | JWT httpOnly cookies, bcrypt hashing, `RoleChecker`, glassmorphic login. |
| **B-5** | Dashboards (Authority / Fleet / Admin views + charts) | ✅ Completed | Recharts area + pie charts, pending-repair queue, admin user controls. |
| **B-6** | Production hardening | ✅ Completed | See sub-tasks below. |

### B-6 Sub-task Breakdown

| Sub-task | Status | Notes |
|---|---|---|
| S3 / MinIO object storage | ✅ Done | `backend/s3_storage.py`, `boto3`, `POST /detect-image` uploads bytes to MinIO. |
| Redis cache for `/map` & `/analytics` | ✅ Done | Cache-aside pattern, TTL 300 s, `clear_all_caches()` on every mutator. |
| Local Leaflet marker assets | ✅ Done | `marker-icon.png` & `marker-shadow.png` in `frontend/public/images/`. `MapComponent.js` uses `/images/` path — no CDN dependency. |
| Paginated `GET /reports` | ✅ Done | `page` + `limit` params (default 1 / 10, cap 100). `PaginatedReportsResponse` envelope. Frontend pagination controls. |
| `GET /health` endpoint | ✅ Done | Checks DB (`SELECT 1`) and Redis (`ping`). Returns 503 if DB is down. |
| Frontend CI (lint + build) | ✅ Done | New `frontend-lint-build` job in `.github/workflows/ci.yml`: `npm ci` → `npm run lint` → `npm run build`. |

### AI Track (Person A)

| Task | Description | Status | Notes |
|---|---|---|---|
| **A-0** | Repo hygiene — all AI code in git, no secrets | ✅ Completed | `/ai/` committed, `.env` pattern, `requirements.txt`, `README.md`, `Dockerfile`. |
| **A-1** | Kill Roboflow hosted API, use local weights | ✅ Completed | `ai/model.py` uses `ultralytics.YOLO(best.pt)`. Runs fully offline. |
| **A-2** | Proper GPU training (target mAP50 ≥ 0.75) | ⚠️ Partial | `v3-merged` beats the old model on real footage (45/55 frames, 0 false positives), but mAP50 ≥ 0.75 still NOT met. Bottleneck is data, not training config. |
| **A-3** | Multi-class dataset (crack + RDD2022) | ✅ Completed | `v3-merged` = **`pothole` + `crack`** (RDD2022 India merged with pothole-detection-3). Crack AP50 0.499. The UI `crack` filter now matches. |
| **A-4** | Ship the inference HTTP service (`ai/infer_service.py`) | ✅ Completed | Contract v2-compliant. `POST /infer` + `GET /health`. Model loaded once at startup. |
| **A-5** | Real severity estimation | ✅ Completed | `ai/severity.py` is now **perspective-normalised**: the old bbox-area version scored `corr(depth, severity) = +0.711` (it measured camera distance, not pothole size). Now **−0.157** — 78% of the bias gone, all 3 buckets populated. Still *relative* not metric; MiDaS/depth remains the upgrade path. |
| **A-6** | Real GPS (GPX track / phone sensor) | ✅ Completed | `ai/gps.py`: EXIF GPS → GPX interpolation → faked (loudly warned). Emits `speed_kmph`. Code verified; awaiting a real recorded drive to exercise it. |

### Phase 3 — AI Track (Person A)

| Task | Description | Status | Notes |
|---|---|---|---|
| **A3-7** | Model release artifact / registry | ✅ Completed | `ai/models.json` + `ai/fetch_model.py`. Release `model-v3-merged` published; GitHub's SHA256 matches the registry. **Closes D-1.** |
| **A3-6** | Latency — PRD <100 ms/frame | ✅ Completed | **Already passing: 93.7 ms** (AMD Ryzen 5 5600H, 12 cores, torch 6 threads, CPU, imgsz 640, median of 25). The old "103 ms failing" was a sloppy benchmark. **ONNX (132 ms) and OpenVINO (177 ms) are 1.4-1.9x SLOWER** — not shipped. See `ai/experiments.md`. ⚠️ Margin is 6%; depth (A3-3) + segmentation (A3-4) will blow it. 93.7 ms ≈ 10 fps, **not** real-time for 30 fps video. |
| **A3-1** | Remaining 5 PRD classes | ⬜ Not started | 2 of 7 (`pothole`, `crack`). |
| **A3-2** | Accuracy to agreed target | ✅ **Experiment complete — target proven unreachable by scaling** | `v4-all` (11,976 imgs, all 6 RDD countries, **4x v3's data**) → **marginal, mixed** real-world change: 51/55 on potholevideos (v3: 45) but 58/67 on india (v3: 60); net +15% detections, FP still 0. **Shipped.** Combined with `v2-2` (config changes → nothing), **two falsified hypotheses now say the ceiling is LABEL QUALITY**, not data quantity or config. mAP50 ≥ 0.75 / 95% precision are **not reachable by scaling this approach** — this is the evidence for the D-4 target renegotiation. |
| **A3-3** | Metric severity (depth) | ⬜ Not started | Will add a second model — watch the 6% latency margin. |
| **A3-4** | Road segmentation | ❌ **Not built — premise measured dead** | Meant to kill treeline/dashboard FPs. **There are none left**: FP = **0/57 at deployed 0.29**, still 0 at 0.10; highest latent off-road detection is conf **0.077** (3.8x below threshold). The 57 hard negatives already solved it at zero latency cost. And **38% of real potholes sit in the same zone as those FPs**, so a filter costs 38% recall. Strictly negative trade. Reopen only if FP > 0 on real footage. |
| **A3-5** | Field validation (real drive) | ⬜ Not started | Still no dashcam footage containing potholes. |

---

## 3. Active Technical Notes

| Service | URL |
|---|---|
| FastAPI backend | `http://localhost:8000` |
| Stub inference | `http://localhost:8001` |
| Real AI inference | `http://localhost:8001` (swap `INFERENCE_URL` to point here from `ai/`) |
| Next.js frontend | `http://localhost:3000` |
| PostgreSQL (PostGIS) | `localhost:5432` DB: `roadsense` / User: `postgres` / Pass: `postgres` |
| Redis | `redis://localhost:6379/0` |
| MinIO API | `http://localhost:9000` |
| MinIO Console | `http://localhost:9001` (user: `minioadmin` / pass: `minioadmin`) |

### Default Seed Users (seeded at startup)

| Username | Role | Password |
|---|---|---|
| `admin` | admin | `password` |
| `officer` | authority | `password` |
| `driver` | fleet | `password` |

### Key env vars for backend

| Var | Default |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/roadsense` |
| `INFERENCE_URL` | `http://localhost:8001` |
| `REDIS_URL` | `redis://localhost:6379/0` |
| `S3_ENDPOINT_URL` | `http://localhost:9000` |
| `S3_ACCESS_KEY` | `minioadmin` |
| `S3_SECRET_KEY` | `minioadmin` |
| `S3_BUCKET_NAME` | `roadsense` |
| `SECRET_KEY` | (set in `auth.py` — rotate before production) |

### Key env vars for AI service

| Var | Default |
|---|---|
| `MODEL_PATH` | `ai/weights/best.pt` |
| `MODEL_VERSION` | `roadsense-yolov8s-v3-merged` |
| `CONF_THRESHOLD` | `0.29` (F1-optimal; set in `ai/.env`) |

---

## 4. Verification & Testing Status

- **Automated Tests:** 16 tests across `backend/test_api.py`, `backend/test_detect_image.py`,
  `backend/test_stub.py`, `backend/test_repair.py`, and `backend/test_auth.py` — covering auth
  limits, state-machine workflows, stub inference contract, upload pipeline (S3 mocking), and
  spatial clustering. All **PASSING**.
- **CI Status:** Both jobs (backend lint+test, frontend lint+build) expected green on `main`.
- **AI model validation:** `potholevideos.mp4` — 43/55 frames detected at conf=0.30. Boxes correctly
  placed on real potholes. `dashcam.mp4` (Oregon highway, no potholes) — 3/57 frames fire (all false
  positives: treeline, dashboard bezel). See `ai/experiments.md` for full details.

---

## 5. Known Gaps & Open Debt

| # | Gap | Severity | Owner | Notes |
|---|---|---|---|---|
| ~~G-1~~ | ~~Multi-class model — `crack` filter is dead UI~~ | ✅ Closed | Person A | **Done.** `v3-merged` ships `pothole` + `crack` (RDD2022 India merged in). |
| G-2 | mAP50 ≥ 0.75 not achieved | 🔴 High | Person A | Data bottleneck, confirmed by experiment: v2-2 (more epochs/bigger model/higher res) did **not** beat the 12-epoch baseline. Only more/better data moves it. |
| ~~G-3~~ | ~~GPS is faked (Mumbai random jitter)~~ | ✅ Closed | Person A | **Done (A-6).** `ai/gps.py` — EXIF + GPX interpolation + `speed_kmph`; faking is now a loudly-warned last resort. Needs a real recorded drive to exercise end-to-end. |
| ~~G-4~~ | ~~Severity heuristic unvalidated~~ | ✅ Closed | Person A | **Done (A-5).** Validated on 81 real detections: the old heuristic was measuring camera distance (corr +0.711), now perspective-normalised (−0.157). Residual: score is relative, not metric — thresholds need per-camera calibration. |
| G-9 | `crack` class is conservative / unverified in the field | 🟡 Medium | Person A | Validated on RDD test (AP 0.499) but emits no cracks on `potholevideos.mp4`. Needs real crack footage to confirm. |
| G-5 | `GET /admin/system-health` returns hardcoded values | 🟡 Medium | Person B | **Verified 2026-07-16:** `main.py:902` returns literal `cpu_usage_pct: 34.5` etc., comment says "Simulated system stats". `psutil` not in requirements. An admin will trust these numbers. |
| G-6 | No fleet-specific backend endpoints | 🟢 Low | Person B | Fleet dashboard derives data from `vehicle_id` on reports — no registry API. |
| G-7 | `page.js` is 1,064 lines — growing unwieldy | 🟢 Low | Person B | Refactor into role-specific sub-components before Phase 3 frontend work. |
| G-8 | `task.md` is stale | 🟢 Low | — | Shows B-5/B-6 unchecked. `claude.md` is the canonical source. |
| ~~G-10~~ | ~~`POST /detect-image` defined twice — **CI was red** (`ruff F811`)~~ | ✅ Fixed `780057d` | Person B (verify) | Merge artifact from `3a3aa52`. Kept the handler at 441 (S3 + PostGIS clustering + cache invalidation); removed 711 (older B-1 with none of those). It was already dead code — FastAPI matches the first route — so zero runtime change. **B: confirm this was your intended handler.** |
| **G-11** | 🔴 **Stale `feat/ai-phase2` branch is a landmine** | 🔴 High | Both | It holds pre-v3 `ai/` files. Merging it into `main` (`3a3aa52`) reverted A-5 and left `ai/detect.py` with raw conflict markers — `main` was tagged "phase 2 signoff" while it **did not parse** (fixed in `42b4edd`). **Delete the branch.** |
| **G-12** | 🔴 **CI does not check `ai/` at all** | 🔴 High | Person B | CI runs `ruff check backend/` only. A `SyntaxError` in `ai/detect.py` reached `main` with **green CI**. Add at minimum `python -m compileall ai backend`. |
| **G-13** | Weights still not handed to Person B | 🔴 High | Person A | Root cause of the two wrong AI audits *and* of G-11 (B cannot run the AI code, so cannot know which side of an `ai/` conflict is current). 2-minute fix, still open. |

---

## 6. Phase 2 Definition of Done — Status

| Criterion | Met? |
|---|---|
| No hosted-API dependency — pipeline runs offline | ✅ Stub covers dev; real `INFERENCE_URL` for prod |
| No secrets in repo | ✅ All credentials via env vars / `.env` |
| Upload flow is real — non-road image → 0 detections | ✅ `POST /detect-image` → stub/model |
| All AI code in git, reproducible from clean clone | ✅ `/ai/` committed, `Dockerfile` + `requirements.txt` |
| Duplicate clustering is real (PostGIS `ST_DWithin`) | ✅ B-2 |
| Repair workflow + audit log | ✅ B-3 |
| Auth works — unauthenticated writes rejected | ✅ B-4 (JWT + `RoleChecker`) |
| CORS locked down | ✅ `allow_origins=["http://localhost:3000"]` |
| All three dashboards (Authority / Fleet / Admin) | ✅ B-5 |
| S3/MinIO for image storage | ✅ B-6 |
| Redis cache for read-heavy endpoints | ✅ B-6 |
| Local Leaflet marker assets (no CDN) | ✅ B-6 |
| Paginated `GET /reports` | ✅ B-6 |
| `GET /health` checking DB + Redis | ✅ B-6 |
| CI green on backend **and** frontend | ✅ B-6 |
| Model beats Phase-1 baseline | ⚠️ On **real footage** yes (45/55 frames + 0 false positives, vs 43 + 3). On RDD test mAP50 ≥ 0.75 still unmet. |
| ≥2 detection classes (`crack` filter matches something) | ✅ `v3-merged` = `pothole` + `crack` |
| All three severity buckets populated by real data | ✅ A-5 — 28/26/27 on 81 real detections, perspective-normalised |
| GPS is real, not faked | ✅ A-6 — EXIF/GPX + `speed_kmph`; faking is warned, not silent |

**Platform (Person B): Feature-complete. ✅**
**AI (Person A): A-0…A-6 all complete except the mAP50 ≥ 0.75 target, which is data-bound
(proven: more epochs / bigger model / higher resolution did not move it — only more data will). ⚠️**

---

## 7. Phase 3 (Beta) — What's Next

These are NOT current tasks — they define the scope of Phase 3:

- Multi-class model: ≥2 classes (`crack` priority), working toward all 7 PRD classes
- Real GPS: GPX track reader or phone-sensor interpolation
- Model precision ≥ 95% / recall ≥ 90% (PRD production targets — Phase 3/4 goal)
- Hard-negative mining from `dashcam.mp4` frames to reduce false positives
- Notifications (email/SMS/push for new high-severity issues)
- Road Health Score algorithm
- Real fleet endpoint (vehicle registry, camera health polling API)
- Production cloud deployment (cloud DB, real S3, domain, TLS)
- Admin model-version registry (swap deployed model without redeploy)
- Frontend refactor: split `page.js` into role-specific route components
- Performance validation: `/map` p95 < 2 s at ~10k reports
