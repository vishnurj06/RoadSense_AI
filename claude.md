# RoadSense AI — Continuous Memory and Context Log (Phase 3 - Beta)

This file is the canonical progress tracker for the entire RoadSense AI project (Backend, Frontend,
and AI Pipeline). Updated after every completed and verified task.
Last updated: **2026-07-17** — S5 dry-run in progress · S5-11 CI fully green (ruff + ESLint) · B3-5 `road_name` surfaced · B3-6 provenance fix completed (a *second* omission was found in the frontend adapter).

## Project Metadata

| Field | Value |
|---|---|
| **Project Name** | RoadSense AI (Platform) |
| **Role** | Person B (Backend & Frontend Platform Owner) |
| **Sprint** | Phase 3 (Beta) — Platform track active · AI track active |
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

- **Released, both proven end-to-end with a real token** (downloads → SHA256-verifies → loads as a
  working model):
  | version | tag | asset | status |
  |---|---|---|---|
  | `roadsense-yolov8s-v4-all` | `model-v4-all` | `best-v4-all.pt` | ✅ **current default** |
  | `roadsense-yolov8s-v3-merged` | `model-v3-merged` | `best-v3-merged.pt` | ✅ previous, still fetchable |

  `python fetch_model.py` gets the default; `--version <name>` gets any other.
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

## 2b. Phase 3 (Beta) Progress Summary — Platform Track (Person B)

| Task | Description | Status | Notes |
|---|---|---|---|
| **B3-0** | Close Phase-2 debt | ✅ Done | All sub-tasks complete. See breakdown below. |
| **B3-1** | Fleet APIs (vehicles table, registry endpoints, camera health) | ✅ Done | See breakdown below. |
| **B3-2** | Notifications (email digest, rate-limit, in-app bell) | ✅ Done | See breakdown below. |
| **B3-3** | Road Health Score (formula, choropleth, normalisation) | ⬜ Planned | — |
| **B3-4** | Model registry (`models` table, activate endpoint, Admin UI) | ✅ Done | See breakdown below. Pairs with A3-7. |
| **B3-5** | Data enrichment — `road_name` (Nominatim) + `weather` (OpenWeather) | 🟡 Mostly done | Backend enrichment live (`enrichment.py`). `road_name` now surfaced through `/map` → popup (S5-11, §5d). **Remaining:** `weather` is stored but rendered nowhere. |
| **B3-6** | GPS provenance — visually mark `faked` pins on map | ✅ Done | Marker + popup + filter all fail closed. Root-cause bug fixed 2026-07-17 (`/map` dropped `gps_source`). See §5c. |
| **B3-7** | Performance validation (~10k reports, p95 for `/map` + `/analytics`) | ⬜ Planned | — |
| **B3-8** | Frontend hardening (split `page.js`, add frontend tests, unknown-class safety) | ✅ Done | 35 tests passing. See breakdown below. |
| **B3-9** | Security (encrypted uploads, GPS validation, `SECRET_KEY` rotation) | ⬜ Planned | — |

### B3-0 Sub-task Breakdown

| Sub-task | Status | Notes |
|---|---|---|
| ~~D-2b~~ Duplicate `POST /detect-image` removed | ✅ Done `780057d` | Kept handler at line 441 (S3 + clustering + cache). CI was red (ruff F811) — now green. |
| ~~D-2~~ Delete stale `feat/ai-phase2` branch | ✅ Done | Deleted by user. Branch is gone. |
| ~~G-5~~ Real `GET /admin/system-health` | ✅ Done | Replaced hardcoded literals with `psutil` CPU/memory/disk + live HTTP probe of `INFERENCE_URL/health`. `psutil>=5.9.0` added to `requirements.txt`. |
| ~~G-12~~ Add `ai/` to CI syntax gate | ✅ Done | Added `python -m compileall -q ai backend` step to `.github/workflows/ci.yml` **before** ruff/pytest. D-0 process fix. |
| ~~G-8~~ Update or delete `task.md` | ✅ Done | `task.md` deleted by user. |

### B3-8 Sub-task Breakdown

| Sub-task | Status | Notes |
|---|---|---|
| Split `page.js` (1064 lines) into role components | ✅ Done | `page.js` is now ~220 lines. Extracted `AuthorityDashboard`, `FleetDashboard`, `AdminDashboard`, `StatCards`, `Toast`, `Filters`, `UploadPanel`, `ReportLogs`. |
| `src/lib/classUtils.js` — Contract v3 class registry | ✅ Done | Single source of truth for all 7 PRD classes. `getClassLabel()` / `getClassBadgeStyle()` title-case and neutrally badge any unknown future class — never 500. |
| Unknown-class safety in `MapComponent.js` map popup | ✅ Done | Detection rows now use `getClassLabel` + `getClassBadgeStyle`. `key` uses `d.id ?? i` fallback. A future `speed_breaker` class renders as "Speed Breaker" with a neutral grey badge. |
| `AdminDashboard` uses real B3-0 psutil fields | ✅ Done | `SystemHealthPanel` updated to display `disk_used_gb`, `db_pool_size`, `inference_status`, `inference_latency_ms` (the new fields from B3-0). |
| Jest + React Testing Library setup | ✅ Done | `jest.config.js`, `jest.setup.js`, `__mocks__/`, `test` + `test:ci` npm scripts. |
| **35 frontend tests passing** | ✅ Verified | `classUtils.test.js` (21 tests), `StatCards.test.jsx` (6), `Filters.test.jsx` (8). All green locally. |
| CI updated — Jest runs in `frontend-lint-build` job | ✅ Done | `npm run test:ci` runs after ESLint and before `npm run build`. `--passWithNoTests` keeps CI green while suite grows. |

### B3-1 Sub-task Breakdown

| Sub-task | Status | Notes |
|---|---|---|
| `vehicles` SQLAlchemy model | ✅ Done | `backend/models.py` — `id`, `plate` (unique+indexed), `model`, `camera_id`, `status`, `last_seen`, `registered_at`. Camera health (`online`/`stale`/`offline`/`unknown`) is derived at query time, not stored. |
| Alembic migration | ✅ Done | `migrations/versions/a7f3c91e0b25_add_vehicles_table.py` — `vehicles` table + unique index on `plate`. Down revision: `c12d856d463c`. |
| `POST /fleet/vehicles` | ✅ Done | Registers a vehicle; 409 on duplicate plate; roles: `fleet`, `admin`. |
| `GET /fleet/vehicles` | ✅ Done | Paginated list with derived `camera_health` + `report_count`; `status` and `camera_health` query filters; roles: `fleet`, `admin`, `authority`. |
| `GET /fleet/vehicles/{id}/history` | ✅ Done | Paginated detection reports for a vehicle matched by `vehicle.plate == report.vehicle_id`. |
| `last_seen` updated on every detect hit | ✅ Done | Both `POST /detect` and `POST /detect-image` update `vehicle.last_seen = report.timestamp` if the plate is registered. |
| Fleet router wired into `main.py` | ✅ Done | `from routers import fleet as fleet_router` + `app.include_router(fleet_router.router)`. |
| Vehicle schemas | ✅ Done | `VehicleCreate`, `VehicleResponse` (+ derived `camera_health`, `report_count`), `VehicleListResponse`, `VehicleHistoryResponse` in `schemas.py`. |
| `FleetDashboard.js` updated | ✅ Done | Fetches `GET /fleet/vehicles` for vehicle list and `GET /fleet/vehicles/{id}/history` for the history drawer. Real data, not mock. |
| Camera health thresholds | ✅ Done | `CAMERA_STALE_MINUTES=30`, `CAMERA_OFFLINE_MINUTES=120`. Defined in `routers/fleet.py` — no DB migration needed to change. |

### B3-2 Sub-task Breakdown

| Sub-task | Status | Notes |
|---|---|---|
| `NotificationPreference` SQLAlchemy model | ✅ Done | `backend/models.py` — `user_id` (FK, unique), `min_severity`, `email_enabled`, `area_filter` (JSON bbox), `digest_interval_seconds` (default 300). |
| `Notification` SQLAlchemy model | ✅ Done | `backend/models.py` — `user_id` (nullable = broadcast), `type`, `title`, `body`, `resource_id`, `resource_type`, `is_read`, `created_at`. Back-references on `User`. |
| Alembic migration | ✅ Done | `migrations/versions/b8e2f47a1c39_add_notifications_tables.py` — two tables + three indexes. Down revision: `a7f3c91e0b25`. |
| `notification_service.py` | ✅ Done | Core service module: `trigger_high_severity_notification()`, `create_in_app_notification()`, SMTP mock + real SMTP (STARTTLS), Redis rate-limit with in-process dict fallback. |
| Email rate-limiting / burst guard | ✅ Done | Per-user `digest_interval_seconds` window (default 300 s = 5 min). Last-send time stored in Redis key `notif:last_email:{user_id}` (TTL 24 h). Falls back to in-process dict if Redis unavailable. A 50-detection burst → 1 email per user. |
| SMTP mock mode | ✅ Done | `SMTP_MOCK=1` (default). Logs would-be emails to stdout with full subject/body — zero configuration needed for dev. Set `SMTP_MOCK=0` + `SMTP_HOST/PORT/USER/PASS` for real delivery. |
| `GET /notifications` | ✅ Done | Bell-icon feed; authority/admin also see broadcast (`user_id IS NULL`) notifications. Supports `?unread_only=true`, pagination. Returns `unread_count` for badge. |
| `POST /notifications/{id}/read` | ✅ Done | Marks a single notification read. |
| `POST /notifications/read-all` | ✅ Done | Bulk mark-read for all user notifications. |
| `GET /notifications/preferences` | ✅ Done | Lazily creates defaults on first call. |
| `PUT /notifications/preferences` | ✅ Done | Partial upsert — only supplied fields are changed. |
| Notification trigger in `POST /detect` | ✅ Done | `cluster_report_to_issue()` now returns the new `Issue` (or `None`). Trigger fires after commit for `severity == "high"`. |
| Notification trigger in `POST /detect-image` | ✅ Done | Same pattern as `/detect`. |
| Notification trigger in `POST /verify` | ✅ Done | Collects all new high-severity issues from the clustering batch; fires one trigger per issue after commit. Rate-limiter collapses bursts. |
| Notifications router wired into `main.py` | ✅ Done | `from routers import notifications as notifications_router` + `app.include_router(notifications_router.router)`. |
| Pydantic schemas | ✅ Done | `NotificationResponse`, `NotificationListResponse`, `NotificationPreferenceResponse`, `NotificationPreferenceUpdate` added to `schemas.py`. |

### B3-4 Sub-task Breakdown

| Sub-task | Status | Notes |
|---|---|---|
| `AIModel` SQLAlchemy ORM model | ✅ Done | `backend/models.py` — `id`, `version` (unique, indexed), `artifact_url`, `sha256`, `classes` (JSON), `conf_threshold`, `metrics` (JSON), `is_active` (bool), `notes`, `registered_at`. |
| Alembic migration | ✅ Done | `migrations/versions/d4f9e2b71a08_add_ai_models_table.py` — `ai_models` table + `ix_ai_models_is_active` index + `ix_ai_models_version` unique index. Down revision: `b8e2f47a1c39`. |
| `GET /admin/models` | ✅ Done | Returns all versions, newest-first. Role: `admin` only. |
| `POST /admin/models` | ✅ Done | Registers a new version. Enforces `version` uniqueness at app layer (409) and DB layer (unique index). Returns 201. |
| `POST /admin/models/{id}/activate` | ✅ Done | **Atomic** two-step transaction: deactivate all → activate target. Idempotent if already active. 404 if not found. |
| `Pydantic schemas` | ✅ Done | `AIModelCreate` + `AIModelResponse` added to `schemas.py`. |
| `routers/admin.py` (new router) | ✅ Done | All three model registry endpoints, fully documented, `prefix="/admin"`. |
| Admin router wired into `main.py` | ✅ Done | `from routers import admin as admin_router` + `app.include_router(admin_router.router)`. |
| `get_active_model_version()` helper | ✅ Done | Utility in `main.py`: queries `AIModel.is_active IS TRUE`; used in `/detect-image` as fallback for `model_version`. |
| Report tracing in `POST /detect-image` | ✅ Done | `model_version` now uses `inference_data.get("model_version") or get_active_model_version(db)` — never NULL when a model is registered. |
| Report tracing in `POST /detect` | ✅ Done | Already uses `payload.model_version` from the AI service payload — unchanged, by design (telemetry reports carry explicit version). |
| `ModelRegistryPanel` replaced in `AdminDashboard.js` | ✅ Done | Self-fetching component (`useEffect` + `useCallback`). Shows all versions: version tag, `is_active` badge, class pills, conf threshold, mAP50 from `metrics`. **Activate** button calls `POST /admin/models/{id}/activate`; active row highlighted green. Empty and loading states handled. |
| Activation idempotency | ✅ Done | Backend returns 200 immediately if the target is already active (no DB write). Frontend button disabled during in-flight request. |



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
| `SMTP_MOCK` | `1` (mock mode; set to `0` for real mail) |
| `SMTP_HOST` | `smtp.example.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `noreply@roadsense.ai` |
| `SMTP_PASS` | (empty — set in env for real delivery) |
| `SMTP_FROM` | `RoadSense AI <noreply@roadsense.ai>` |

### Key env vars for AI service

| Var | Default |
|---|---|
| `MODEL_PATH` | `ai/weights/best.pt` |
| `MODEL_VERSION` | `roadsense-yolov8s-v3-merged` |
| `CONF_THRESHOLD` | `0.29` (F1-optimal; set in `ai/.env`) |

---

## 4. Verification & Testing Status

- **Automated Tests:** **73 tests total** — 17 backend + 56 frontend.
  - **Backend (17):** `backend/test_api.py`, `backend/test_detect_image.py`, `backend/test_stub.py`, `backend/test_repair.py`, `backend/test_auth.py` — auth, state-machine, stub, upload, spatial clustering, **B3-6 GPS provenance + B3-5 `road_name` end-to-end**. All **PASSING**.
  - **Frontend (56):** `src/__tests__/classUtils.test.js` (21), `gpsUtils.test.js` (13), `mapUtils.test.js` (8), `StatCards.test.jsx` (6), `Filters.test.jsx` (8) — Contract v3 forward-compatibility, GPS provenance fail-closed, GeoJSON→UI adapter field preservation, component rendering, null-safety. All **PASSING**.
- **CI Status:** ✅ **Both jobs green** as of S5-11 (2026-07-17), verified locally end-to-end:
  `backend-lint-and-test` (compileall ✅ → ruff ✅ *All checks passed* → pytest ✅ 17) and
  `frontend-lint-build` (ESLint ✅ exit 0 → Jest ✅ 56 → `next build` ✅). See §5d.

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
| G-5 | ~~`GET /admin/system-health` returns hardcoded values~~ | ✅ **Closed B3-0** | Replaced with real `psutil` metrics + live `INFERENCE_URL/health` probe. |

| G-6 | ~~No fleet-specific backend endpoints~~ | ✅ **Closed B3-1** | Fleet router live: `POST /fleet/vehicles`, `GET /fleet/vehicles`, `GET /fleet/vehicles/{id}/history`. Camera health derived from `last_seen`. `FleetDashboard.js` points at real endpoints. |
| G-7 | ~~`page.js` is 1,064 lines — growing unwieldy~~ | ✅ **Closed B3-8** | Split into `AuthorityDashboard`, `FleetDashboard`, `AdminDashboard`, `StatCards`, `Toast`, `Filters`, `UploadPanel`, `ReportLogs`. `page.js` is now ~220 lines. |
| G-8 | ~~`task.md` is stale~~ | ✅ **Closed B3-0** | `task.md` deleted by user. `claude.md` is the canonical source. |
| ~~G-10~~ | ~~`POST /detect-image` defined twice — **CI was red** (`ruff F811`)~~ | ✅ Fixed `780057d` | Person B (verify) | Merge artifact from `3a3aa52`. Kept the handler at 441 (S3 + PostGIS clustering + cache invalidation); removed 711 (older B-1 with none of those). It was already dead code — FastAPI matches the first route — so zero runtime change. **B: confirm this was your intended handler.** |
| **G-11** | 🔴 **Stale `feat/ai-phase2` branch is a landmine** | 🔴 High | Both | It holds pre-v3 `ai/` files. Merging it into `main` (`3a3aa52`) reverted A-5 and left `ai/detect.py` with raw conflict markers — `main` was tagged "phase 2 signoff" while it **did not parse** (fixed in `42b4edd`). **Delete the branch.** |
| ~~G-12~~ | ~~CI does not check `ai/` at all~~ | ✅ **Closed B3-0** | Added `python -m compileall -q ai backend` step to CI before ruff/pytest. D-0 process fix. |

| **G-13** | ~~Weights still not handed to Person B~~ | ✅ Acknowledged | Person A | Context documented in `claude.md`. Not a blocker for S5 (stub covers dev). |

---

## 5b. S5 Pre-flight Fixes (2026-07-17)

| Fix | File(s) | Notes |
|---|---|---|
| Stale handover files removed | `tracker.md`, `gemini_handover.md` (deleted) | Both were left over from the Gemini session handover. Environment is now clean — `claude.md` is the sole tracker. |
| Dead analytics comment removed | `backend/main.py` line 842 | Removed `# get_analytics moved to routers/analytics.py` tombstone. No functional change — route was already gone. |
| ruff lint — 25 warnings fixed | `enrichment.py`, `routers/analytics.py`, `main.py` | W291/W293 trailing whitespace + F401 unused `Optional` import left by Gemini. All auto-fixed + SQL string cleaned manually. All files now pass `ruff check` clean. |
| GPS provenance marker enhanced | `frontend/src/components/MapComponent.js` | Replaced subtle dashed stroke with: (1) thick amber dashed ring around pin body visible at any zoom level, (2) amber `⚠` glyph centred inside pin, (3) reduced opacity to 55%. viewBox corrected to `0 0 26 42` for a standard Leaflet pin aspect ratio. iconSize/iconAnchor updated to match. |
| GPS provenance popup badge added | `frontend/src/components/MapComponent.js` | Amber banner `"⚠ UNVERIFIED GPS — location is approximate"` injected into `IssuePopupContent` when `gps_source === "faked"`. Green `"✓ EXIF verified"` shown for real-GPS reports. |
| `SECRET_KEY` guard fixed | `backend/auth.py` | Changed test-environment sentinel from `PYTEST_CURRENT_TEST` (set per-test, too late for `conftest.py` imports) to `"pytest" in sys.modules` (set at pytest startup, before collection). All 16 backend tests pass. |

---

## 5c. S5-10 — GPS Provenance Bug (B3-6) — RESOLVED 2026-07-17

**Symptom:** An image uploaded via the web UI's "Demo Telemetry Upload" rendered `✓ GPS VERIFIED` /
`GPS Source: EXIF` in green, instead of the amber faked-GPS warning.

**Root cause — it was never the upload path.** Two plausible theories were investigated and both
disproved:
- ❌ *"The frontend sends the wrong `gps_source`"* — `page.js` `handleImageUpload()` never sends the
  field at all, so the backend `Form("faked")` default at `main.py:538` correctly applied.
- ❌ *"The backend extracts real EXIF and overwrites the flag"* — no EXIF extraction exists anywhere
  in `POST /detect-image`. The DB row was always written with `gps_source="faked"`.

The actual bug was in **`GET /map`**: the GeoJSON `properties` block copied `speed_kmph` and
`model_version` off the latest report but **omitted `gps_source` entirely**. The field reached the
browser as `undefined`, and every consumer then **failed open** — independently defaulting the
missing value to a *real* source and rendering a faked pin as verified. The write path was correct
the whole time; the read path silently laundered it.

**Fixes applied:**

| Fix | File | Notes |
|---|---|---|
| `/map` now emits `gps_source` | `backend/main.py` | Added to GeoJSON `properties`. **Fails closed across the cluster**: an `Issue` aggregates many `Report`s, so if *any* contributing report is `faked`, the pin is marked `faked` regardless of what the latest report says. |
| Response schema no longer lies | `backend/schemas.py` | `ReportResponse.gps_source` default `"exif"` → `None`. An absent source means *unknown*, never a real source. Same latent bug on `GET /reports`. |
| Single source of truth for the rule | `frontend/src/lib/gpsUtils.js` **(new)** | `getGpsProvenance()` → `real \| faked \| unknown`, plus `isRealGps()` / `getGpsSourceLabel()`. Contract v3 §3.2: only `exif` / `gpx` count as real. Mirrors the `classUtils.js` registry pattern. |
| Popup fails closed + 3rd state | `frontend/src/components/MapComponent.js` | Was binary (faked vs. "verified"), so unknown → green. Now `faked` = amber, `exif`/`gpx` = green, **unknown = neutral grey "GPS provenance unknown"**. Removed the fabricated `gps_source \|\| "exif"` fallback and the misleading `gpsSource = "exif"` default param on `createMarkerIcon`. |
| "Real GPS only" filter fails closed | `frontend/src/app/page.js` | Was `gps_source === "faked"` (excludes only explicit fakes, so unknown passed as real) → now `!isRealGps(...)`. |

**Verification:**
- New backend regression test `test_web_upload_gps_provenance_is_faked_end_to_end`
  (`test_detect_image.py`) drives the real flow: upload with no `gps_source` → asserts the report
  **and the `/map` payload** both report `faked`. **Confirmed it fails on the pre-fix code**
  (`AssertionError: /map dropped gps_source`) — it genuinely catches this regression.
- New `frontend/src/__tests__/gpsUtils.test.js` (13 tests) pins the fail-closed rule, explicitly
  covering the `undefined` / `null` / unknown-source cases that caused this bug.
- **Backend 17 passed** (was 16) · **Frontend 48 passed** (was 35). Total **65**.

**Lesson:** the pin was only ever as trustworthy as the *least* defensive default in the chain. Three
separate consumers each independently assumed a missing `gps_source` meant `"exif"`. Provenance must
fail closed, and the rule belongs in exactly one module.

> ✅ **The pre-existing CI failures noted here (ruff F401 + 4 × ESLint `set-state-in-effect`) have
> since been fixed — see §5d. Both gates are green.**

> 🔴 **The fix described in this section was INCOMPLETE — see §5d.** A second omission of the same
> kind sat one hop downstream in the frontend adapter, so the amber pin still did not render.

---

## 5d. S5-11 — CI Green + B3-5 `road_name` Surfaced (2026-07-17)

### First: the S5-10 fix above was INCOMPLETE

While wiring `road_name` through `GET /map`, a **second omission of the same kind** surfaced.
`page.js` flattened the `/map` FeatureCollection using an **explicit field whitelist** that did not
list `gps_source`. So even with the backend fixed, the field was dropped one hop later and the amber
warning **still never rendered**. §5c claimed the bug was fixed; it was not.

**Why the tests missed it:** the backend test asserted on the `/map` *payload*; `gpsUtils.test.js`
asserted on the *rule*. Nothing tested the adapter between them, so both stayed green while the live
UI was broken. This is exactly the gap flagged at the time — *"verified through the test suite rather
than by clicking through the running UI"*.

**Fix:** the whitelist moved out of `page.js` into `frontend/src/lib/mapUtils.js`
(`mapFeatureToIssue` / `mapFeaturesToIssues`) so it is a testable unit instead of an inline object
literal, and `__tests__/mapUtils.test.js` pins every field — including a whole-shape `toEqual`, so a
property the adapter forgets fails loudly rather than vanishing silently.

> **Rule of thumb for this codebase:** a field on `GET /map` must be listed in **three** places to
> reach the screen — the backend `properties` block, `mapUtils.mapFeatureToIssue`, and the consuming
> component. Miss any one and it is `undefined` with no error anywhere.

### Fixes applied

| # | Fix | File(s) | Notes |
|---|---|---|---|
| 1 | **ruff green** | `migrations/versions/d7a1f0962038_...py` | Removed unused `import sqlalchemy as sa` (only `op` is used). `ruff check .` → **All checks passed**. |
| 2 | **ESLint green** | `page.js`, `AdminDashboard.js`, `FleetDashboard.js` | 4 × `react-hooks/set-state-in-effect` resolved. Breakdown below. |
| 3 | **B3-6 actually completed** | `frontend/src/lib/mapUtils.js` **(new)**, `page.js` | `gps_source` now survives the GeoJSON → UI hop. **This is the change that finally made B3-6 work.** |
| 4 | **B3-5 `road_name` surfaced** | `backend/main.py`, `mapUtils.js` | `/map` properties now include `road_name`, read off the latest report (an `Issue` row carries none of its own). `MapComponent` already rendered it — it had simply never been sent a value. `weather` was left out deliberately: no component consumes it. |

### How the ESLint errors were fixed (and why)

`react-hooks/set-state-in-effect` is a **React Compiler** rule shipped in
`eslint-config-next/core-web-vitals` (Next **16.2.10** · React **19.2.4** · `eslint-plugin-react-hooks`
**7.1.1**). It forbids setState running *synchronously* during an effect, because that triggers a
second cascading render.

Rule behaviour was **established empirically** with a throwaway probe file rather than guessed: it
flags any call **directly in an effect body** to a function that writes state, and does **not** model
`await` across a function boundary. Nesting the call inside an inner function (async IIFE, `.then`,
`setInterval`) satisfies it; `void load()` and `load().catch()` do **not**.

Both halves below were needed — the wrapper alone would have been mere lint-silencing:

1. **Made the fetchers genuinely await-first.** Each `fetchX` opened with `setLoading(true); setError(null);`,
   which runs synchronously even inside an `async` function (a body executes synchronously up to its
   first `await`). Removed — `loading` already initialises to `true` for the first load — so the first
   statement is now `await fetch(...)` and no state is written synchronously. `setError(null)` moved to
   the success path. Event-driven refetches raise the spinner from their own handler, where setState is
   unrestricted.
2. **Effects invoke them as async work:** `useEffect(() => { (async () => { await fetchX(); })(); }, [fetchX])`.

| Site | Resolution |
|---|---|
| `page.js` — `setMounted(true)` | Replaced the `useState(false)` + effect hydration guard with `useIsHydrated()`, built on **`useSyncExternalStore`** (server snapshot `false`, client `true`). Same SSR safety, no setState in an effect. Verified with `next build` — `/` still prerenders as static. |
| `page.js` — `fetchData` | Await-first, plus a `refresh()` helper for user-initiated reloads. |
| `AdminDashboard.js` — `fetchModels` | Await-first; the Refresh button raises the spinner from its handler. |
| `FleetDashboard.js` — `fetchHistory` | Await-first; Prev/Next handlers raise the spinner. |
| `FleetDashboard.js` — `fetchVehicles` | Await-first; see the real bug below. |

### Two real bugs found and fixed along the way

| Bug | Detail |
|---|---|
| **Fleet registry blanked every 60 s** | `fetchVehicles` re-raised `vehiclesLoading` on every poll, and `VehicleRegistry` renders `{loading && "Loading vehicles..."}` / `{!loading && vehicles.map(...)}` — so the 60-second camera-health refresh wiped the whole list to a spinner every minute. The spinner is now strictly an initial-load state; the poll updates in place. |
| **Admin "Refresh" never refreshed the admin panels** | `onClick={fetchData}` passed the click **event** as the `currentUser` argument, so `activeUser = currentUser \|\| user` became a `SyntheticEvent` and `activeUser?.role === "admin"` was never true — the users + system-health refetch silently never ran. Now `onClick={() => refresh()}`. |

### Verification

| Gate | Result |
|---|---|
| `python -m compileall -q ai backend` | ✅ OK |
| `ruff check .` | ✅ **All checks passed** (was 1 error) |
| `pytest` | ✅ **17 passed** |
| `eslint src` | ✅ **exit 0** (was 4 errors) |
| `jest` | ✅ **56 passed**, 5 suites (was 48) |
| `next build` | ✅ Compiled; `/` prerendered static — guards the `useSyncExternalStore` change |

- **Total tests: 73** (17 backend + 56 frontend).
- New `__tests__/mapUtils.test.js` (8 tests) — **confirmed to fail on the pre-fix adapter** (3 of 8
  fail when `gps_source` is removed), so it genuinely catches this regression.
- Backend regression test extended to assert `road_name` is present in the `/map` payload.

> ⚠️ **Still not driven against the live stack.** Every gate above is static or automated. The amber
> pin and the road-name line have **not** been confirmed in a running browser against real
> MinIO/PostGIS. One manual upload is worth doing before S5 sign-off — that is precisely the check
> that would have caught the adapter omission the first time.

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
