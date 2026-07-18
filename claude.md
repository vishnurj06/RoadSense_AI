# RoadSense AI — Continuous Memory and Context Log (Phase 3 - Beta)

This file is the canonical progress tracker for the entire RoadSense AI project (Backend, Frontend,
and AI Pipeline). Updated after every completed and verified task.
Last updated: **2026-07-18** — **🏗️ POST-AUDIT BUILD STARTED (§10)** — PRD review complete (`docs/PRD_Review_and_Actions.md`), **7 product decisions locked** (`docs/PRD_Decisions_To_Make.md`), and an ordered code plan written (`docs/PRD_Implementation_Plan.md`). **Shipped so far: (1) B3-9 login rate-limiting** (`backend/rate_limit.py` + `/auth/login`) — 429 after 5 failed attempts/15 min, Redis-backed with in-process fallback; **(2) B3-2 notification bell UI** (`shell/NotificationBell.js`) — the built-but-unconsumed notifications backend now has a bell + unread badge + dropdown; **(3) code item #2 — workflow status `verified`→`approved`** (surgical rename, backend + frontend + Alembic data migration `e5c1a2f3b6d7`, GPS-provenance "verified" left untouched); **(4) code item #1 — verification threshold** (`Issue.is_verified` flips on ≥2 distinct vehicles; migration `f2a7b9c4d1e8`) — **and its test exposed + fixed a real bug: the teleportation guard 500'd on the 2nd tz-aware report from any vehicle** (`to_naive_utc`, partial G-15). **(5) code item #9 — verified-vs-pending UI** (map popup badge + green ✓ marker for ≥2-vehicle issues); **(6) code item #3 — priority score** (`Issue.priority` computed property, urgency 0-100 = severity + sightings + verified + age; exposed on `/map` + `IssueResponse`); **(7) code item #10 — repair queue sorted by priority** (⚡ indicator per row); **(8) code item #5 — privacy blur** (`privacy.py`, OpenCV Haar face+plate blur before S3, **gated off** via `PRIVACY_BLUR`; adds `opencv-python-headless<5.0`+`numpy` — CI/Docker must install). **99 tests** (34 backend + 65 frontend); alembic head `f2a7b9c4d1e8`. **8 of 9 code items done — only #6 frame sampling left (deferred: needs video upload, which doesn't exist yet).** Earlier today: **📋 PRD COMPLETION AUDIT (§9)** — tracker was stale on **B3-3 (Road Health Score DONE)** and **B3-9 (`SECRET_KEY` hardened)**; large **frontend restructure** (shell/views/ui) also landed. Previous: **2026-07-17** — ✅ SYNC POINT S5 VERIFIED · S5-13 fixed the UTC teleportation-guard bug (§5f) · 🔴 **PRD 95% precision target falsified — needs renegotiation (D-4)**.

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
| **A3-3** | Metric severity (depth) | ❌ **Measured impossible — not built** | Monocular depth **cannot resolve pothole depth**: it reads a pothole as a dip only **44% (Small) / 50% (Base)** of the time — chance is 50% — with SNR ≈ 1.0 vs the road's own texture. **A 4x bigger model gave zero improvement** = physics limit, not capacity. Physics: a 2-15 cm hole at 3-10 m is a 0.5-5% delta vs 5-15% model error. Tested on the *easiest* case (close, large, water-filled). **`depth_cm` stays `null`** — Contract v3 says "never a guess". Needs **stereo hardware or SfM**. See `ai/experiments.md`. |
| **A3-4** | Road segmentation | ❌ **Not built — premise measured dead** | Meant to kill treeline/dashboard FPs. **There are none left**: FP = **0/57 at deployed 0.29**, still 0 at 0.10; highest latent off-road detection is conf **0.077** (3.8x below threshold). The 57 hard negatives already solved it at zero latency cost. And **38% of real potholes sit in the same zone as those FPs**, so a filter costs 38% recall. Strictly negative trade. Reopen only if FP > 0 on real footage. |
| **A3-5** | Field validation (real drive) | ⬜ Not started | Still no dashcam footage containing potholes. |

---

## 2b. Phase 3 (Beta) Progress Summary — Platform Track (Person B)

| Task | Description | Status | Notes |
|---|---|---|---|
| **B3-0** | Close Phase-2 debt | ✅ Done | All sub-tasks complete. See breakdown below. |
| **B3-1** | Fleet APIs (vehicles table, registry endpoints, camera health) | ✅ Done | See breakdown below. |
| **B3-2** | Notifications (email digest, rate-limit, in-app bell) | 🟡 **Backend done, UI missing** (§9 audit correction) | Backend fully done (see breakdown). But the **"in-app bell" has no frontend** — no bell icon, no notification center, no unread feed anywhere in `frontend/src`; only transient `Toast.js` popups exist. `GET /notifications` is unconsumed by the UI. Build the bell in Phase 4. |
| **B3-3** | Road Health Score (formula, choropleth, normalisation) | ✅ **Done** (tracker was stale) | Backend `GET /analytics/road-health` (`routers/analytics.py:83`) — PostGIS `ST_HexagonGrid` scoring, severity weights (high=10/med=5/low=2) + age escalation + resolved-decay, coverage-normalised to 0–100. Frontend choropleth: `MapComponent.js` renders hex `<Polygon>`s (toggle `showRoadHealth` + legend), worst-segments panel in `AnalyticsView.js`, 4-bucket `healthColor`/`healthLabel` in `theme.js`. **Not yet load-tested** — see B3-7. |
| **B3-4** | Model registry (`models` table, activate endpoint, Admin UI) | ✅ **Done** | DB registry + **`ai/models.json` → DB sync** (S5-12). Admin UI shows Person A's real `v3-merged`/`v4-all`. Pairs with A3-7. See §5e. |
| **B3-5** | Data enrichment — `road_name` (Nominatim) + `weather` (OpenWeather) | 🟡 Mostly done | Backend enrichment live (`enrichment.py`). `road_name` surfaced through `/map` → popup (S5-11, §5d). **Remaining (confirmed by §9 audit):** `weather` is stored but rendered **nowhere** — zero `weather` references in `frontend/src`. Surface it or drop the column (Phase-4 §7). |
| **B3-6** | GPS provenance — visually mark `faked` pins on map | ✅ Done | Marker + popup + filter all fail closed. Root-cause bug fixed 2026-07-17 (`/map` dropped `gps_source`). See §5c. |
| **B3-7** | Performance validation (~10k reports, p95 for `/map` + `/analytics`) | ⬜ Planned | — |
| **B3-8** | Frontend hardening (split `page.js`, add frontend tests, unknown-class safety) | ✅ Done | 35 tests passing. See breakdown below. |
| **B3-9** | Security (encrypted uploads, GPS validation, `SECRET_KEY` rotation, **login rate-limiting**) | 🟡 **Partial** (was "⬜ Planned" — understated) | **`SECRET_KEY` done**: `auth.py:14-25` reads it from env and **hard-fails (`ValueError`) if unset** — the only fallback is a test key under pytest. No dev default in prod. **Login rate-limiting DONE (§10, 2026-07-18)**: `backend/rate_limit.py` — `/auth/login` returns **429 after 5 failed attempts / 15 min**, keyed per `{ip}:{username}`, Redis `INCR`+`EXPIRE` with in-process-dict fallback (mirrors `notification_service`). Regression test `test_login_rate_limiting`. **GPS validation done**: `validate_gps_and_teleportation()` (bounds + Null Island + >300 km/h haversine), guard fixed in S5-13/G-14 — but still never exercised on a real non-UTC deployment. **Encrypted uploads PARTIAL**: `s3_storage.py:39` sets `ServerSideEncryption=AES256` **only when `ENVIRONMENT=production`**; dev/default uploads are unencrypted. Audit-logs + RBAC done. **Privacy blur DONE (§10 #5, gated off via `PRIVACY_BLUR`)** — OpenCV Haar face+plate blur before S3. Remaining: verify prod encryption end-to-end, re-audit the GPS guard in anger, validate blur on real faces + enable it for launch. |

### B3-0 Sub-task Breakdown

| Sub-task | Status | Notes |
|---|---|---|
| ~~D-2b~~ Duplicate `POST /detect-image` removed | ✅ Done `780057d` | Kept handler at line 441 (S3 + clustering + cache). CI was red (ruff F811) — now green. |
| ~~D-2~~ Delete stale `feat/ai-phase2` branch | ✅ Done **(S5-12)** | ⚠️ This row previously read "Deleted by user. Branch is gone." — that was **not true**: the local branch survived until 2026-07-17. Actually deleted in S5-12. See G-11. |
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

- **Sync Point S5:** ✅ **VERIFIED** (2026-07-17) — full Phase-3 dry-run against the live stack. Person B confirmed the B3-6 amber GPS warning renders correctly on a real web-UI upload through MinIO/PostGIS.
- **Automated Tests:** **99 tests total** — 34 backend + **65 frontend** (jest actual as of 2026-07-18).
  - **Backend (34):** `test_api.py` (**+ verification-threshold #1**), `test_detect_image.py`, `test_stub.py`, `test_repair.py`, `test_auth.py` (**+ `test_login_rate_limiting`**), `test_model_registry.py` (8), **`test_privacy.py` (6 — #5 blur module + gate)** — auth, state-machine, stub, upload, spatial clustering, **≥2-vehicle verification threshold**, **priority score**, **login rate-limiting**, **privacy blur (fail-closed + /detect-image gate)**, **B3-6 GPS provenance + B3-5 `road_name`**, **B3-4 `models.json` sync**, **UTC/teleportation-guard regression (§5f)**. All **PASSING** (verified under `TZ=UTC`).
  - **Frontend (65, 5 suites):** `src/__tests__/classUtils.test.js`, `gpsUtils.test.js`, `mapUtils.test.js` (**+ is_verified (#1) & priority (#3) adapter regressions**), `StatCards.test.jsx`, `Filters.test.jsx` — Contract v3 forward-compatibility, GPS provenance fail-closed, GeoJSON→UI adapter field preservation (incl. `is_verified`), component rendering, null-safety. All **PASSING**. **NotificationBell (#8) has no unit test yet** — shell components aren't covered by this suite.
- **CI Status:** ✅ **Both jobs green** as of S5-13 (`8abbe91`, 2026-07-17). Every step run locally
  exactly as CI runs it **and in CI's timezone** (`TZ=UTC`): `backend-lint-and-test` (compileall ✅ →
  `ruff check backend/` ✅ → `ruff format --check backend/` ✅ 32 files → pytest ✅ **26 under TZ=UTC**)
  and `frontend-lint-build` (ESLint ✅ exit 0 → Jest ✅ 56 → `next build` ✅).
- **⚠️ How to verify CI locally — this bit us twice.** A local pass is *not* evidence about CI:
  1. §5d claimed green having run only `ruff check`, missing the separate `ruff format --check` step.
  2. §5e claimed green from a **UTC+5:30** box; CI runs **UTC** and went red on a timezone-dependent bug (§5f).

  Run **every** gate, **in CI's environment**: `cd backend && TZ=UTC python -m pytest -q` (TZ works via
  the Bash tool, not PowerShell). **Verify the gate you claim, in the environment that claims it.**

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
| ~~G-11~~ | ~~Stale `feat/ai-phase2` branch is a landmine~~ | ✅ **Closed S5-12** | Both | **Actually closed now.** This row previously claimed "deleted by user" — the local branch (`ce9ef0c`) was still present as late as 2026-07-17. Verified merged into `main`, then deleted; the remote copy was already gone. Its damage is on the record: merging it (`3a3aa52`) reverted A-5 and left `ai/detect.py` with raw conflict markers on a `main` tagged "phase 2 signoff" that **did not parse** (fixed in `42b4edd`). The CI `compileall` gate (G-12) now makes that class of failure impossible to merge. |
| ~~G-12~~ | ~~CI does not check `ai/` at all~~ | ✅ **Closed B3-0** | Added `python -m compileall -q ai backend` step to CI before ruff/pytest. D-0 process fix. |
| ~~G-14~~ | ~~GPS teleportation guard inert on non-UTC servers~~ | ✅ **Closed S5-13** `8abbe91` | Person B | `/detect-image` stamped reports with naive **local** `datetime.now()` while the guard compares to `utcnow()`; the offset lands in the speed **denominator** (via `abs()`), so on UTC+5:30 a 202.6 km jump read as **37 km/h** and passed. Anti-spoofing was **off** on every non-UTC deployment, and reports were stored on a different clock to `issues.updated_at`. Found only because CI runs UTC. See §5f. |
| **G-15** | `datetime.utcnow()` is deprecated (~7× in `main.py`, plus `models.py` column defaults) | 🟡 Medium | Person B | Warns throughout the suite; scheduled for removal. Durable form is `datetime.now(datetime.UTC)`. Deliberately **not** bundled into `8abbe91` to keep that commit scoped to the defect. Also worth making the `reports.timestamp` column timezone-**aware** rather than naive-UTC-by-convention — the convention is what failed in G-14. Phase-4 sweep. |

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

> ✅ **Confirmed against the live stack (2026-07-17).** Person B ran a manual upload through the web
> UI against real MinIO/PostGIS: the amber "UNVERIFIED GPS" warning rendered correctly. **B3-6 is
> verified end-to-end, not just test-green.**

---

## 5e. S5-12 — Sync with Person A's `v4-all` + B3-4 model registry bridge (2026-07-17)

### Repo sync

Merged 9 commits from `origin/main` (`46d7e6e`) — `v4-all`, `ai/models.json`, `ai/fetch_model.py`,
`ai/experiments.md`. Merge commit `56c81cb`. Only `claude.md` conflicted (Person A added the Phase-3
AI-track table where this side had nothing); resolved by keeping his block whole. Verified
afterwards: **zero conflict markers anywhere in the repo** and `compileall` passes — the two checks
that `3a3aa52` failed.

> 🔴 **The Phase-3 platform track had never been committed.** The sync found **34 untracked files** —
> `routers/`, `lib/`, all tests, all migrations, `enrichment.py`, `notification_service.py`. Every
> B3-1/B3-2/B3-4/B3-8 "✅ Done" in this tracker existed only in one working tree; a disk failure
> would have erased Phase 3. Now committed as `36127bf`. **Lesson: "Done" in this file must mean
> "committed", not "works on my machine."**

### Corrections to the directive's premises

Three of the five instructions were based on state that no longer matched the repo:

| Directive | Reality |
|---|---|
| Delete `feat/ai-phase2` local **and** remote | Remote copy was **already gone**; `git push origin --delete` had nothing to delete. Local branch **did still exist** despite this tracker claiming otherwise (G-11 was never actually closed) — now deleted (`ce9ef0c`, verified merged). **G-11 closed for real.** |
| Delete dead B-1 code at `main.py:711` | **Already removed in `780015d`/`780057d` (G-10).** Only one `/detect-image` exists (line ~526). Line 711 is now inside the **live `GET /map` handler** — deleting it would have destroyed the endpoint B3-5/B3-6 depend on. **No action taken.** |
| Add `python -m compileall ai backend` to CI | **Already present** at `ci.yml:47` as `compileall -q ai backend` (G-12, added in B3-0). Adding it again would duplicate the step. **No action taken.** |

### B3-4 — how the two registries were reconciled

`GET /admin/models` already existed (DB-backed, with atomic activate + wired UI). Adding a second
route on the same path is precisely the **G-10 duplicate-route bug** — FastAPI serves the first and
silently ignores the second. So instead of a competing endpoint, the two registries were **bridged**:

| Registry | Owner | Answers |
|---|---|---|
| `ai/models.json` | Person A (A3-7) | **Distribution** — what is published, where to fetch it, SHA256, known weaknesses |
| `ai_models` table | Person B (B3-4) | **Deployment** — what is registered *here*, and which version an admin activated |

| Change | File | Notes |
|---|---|---|
| Sync module | `backend/model_registry.py` **(new)** | Upsert-by-version. `load_registry()` + `sync_registry_to_db()` + `seed_model_registry()`. |
| Sync endpoint | `routers/admin.py` | `POST /admin/models/sync` (admin only), idempotent. 404 if `models.json` missing, 422 if malformed. |
| Startup seed | `main.py` | Best-effort, mirrors `seed_users()`. A missing registry never blocks boot. |
| Admin UI | `AdminDashboard.js` | New **Sync** button; empty state points at it. |

**Design rule — activation is never overridden.** `is_active` is *deployment* state (the admin's
intent); `models.json`'s `default` is *distribution* state (Person A's recommendation). Sync only
activates when **nothing** is active (fresh install). A deliberate admin pin survives any re-sync —
covered by `test_resync_is_idempotent_and_never_overrides_admin_activation`.

**Metrics are copied verbatim, and the UI does not launder them.** Person A is explicit that RDD test
AP is **not comparable across versions** (v3 scored on India-only, v4 on all six countries) and that
the real-footage numbers are the ship gate. The Admin UI therefore headlines **real-footage hit rate**
(`109/122`, `0/57` FP) and demotes RDD mAP50 to a secondary line carrying his own `_note` as tooltip.
Rendering `rdd_test_map50` as a bare "mAP50" would have laundered exactly the caveat he attached.
`known_weaknesses` are folded into `notes` so they face the admin choosing a model.

### ⚠️ Correction: §5d's "CI green" claim was wrong

CI runs **two** ruff steps — `ruff check backend/` (lint) *and* `ruff format --check backend/`
(`ci.yml:53`). §5d ran only the first and declared CI green. `ruff format --check` was in fact **red
on 17 files**. Confirmed via a clean worktree at `46d7e6e` that it was **green before Phase 3**
(18 files, all formatted) — so the Phase-3 work broke it and the claim was simply unverified.
`ruff format backend/` applied; now **32 files, all formatted**. *Verify the gate you claim, not an
adjacent one.*

### Verification

| Gate (exactly as CI runs it) | Result |
|---|---|
| `python -m compileall -q ai backend` | ✅ PASS |
| `ruff check backend/` | ✅ All checks passed |
| `ruff format --check backend/` | ✅ 32 files already formatted (**was 17 red**) |
| `pytest` | ✅ **25 passed** (was 17; +8 registry tests) |
| `eslint src` | ✅ exit 0 |
| `jest` | ✅ **56 passed**, 5 suites |
| `next build` | ✅ Compiled successfully |

**Total tests: 81** (25 backend + 56 frontend). New `backend/test_model_registry.py` runs against the
**real** `ai/models.json`, so a schema change on Person A's side breaks a test rather than the UI.

> 🔴 **This "green" claim was also wrong — GitHub CI went red on the push.** Every gate above was run
> locally and passed, but *locally* is a UTC+5:30 machine and CI runs UTC. Two `/detect-image` tests
> failed there only. See **§5f** — it turned out to be a real production bug, not a test problem.

> ⚠️ **Not yet verified live:** the Admin UI Sync button has not been clicked against a running
> backend + Postgres. The endpoint is covered by an API-level test (`TestClient` → real DB), but the
> button itself is untested in a browser. Worth one click before Phase 4.

---

## 5f. S5-13 — CI went red on push, and it found a real bug (`8abbe91`, 2026-07-17)

**Symptom:** GitHub CI red — `test_detect_image_inference_down` and `test_detect_image_inference_fails`
returned **422** instead of 503/502. Both pass locally. 23 passed, 2 failed.

Two causes, tangled together. The second is a genuine production defect.

### 1. Test pollution (introduced by the B3-6 work)

`test_web_upload_gps_provenance_is_faked_end_to_end` committed a report under
`vehicle_id="demo-web-upload"` — the **`Form` default** that the two failing tests inherit when they
post no `vehicle_id`. They then looked like the *same vehicle* jumping **202.6 km** instantly, and
`validate_gps_and_teleportation()` correctly rejected them with 422 before the inference mock was
ever reached. Fixed: the test now owns `provenance-test-vehicle`.

### 2. 🔴 Report timestamps were local time, not UTC — the teleportation guard was inert

`POST /detect-image` stamped `timestamp=datetime.now()` (naive **local**) while
`validate_gps_and_teleportation()` compares against `datetime.utcnow()`. Because that delta is
`abs()`'d into the speed **denominator**, a non-UTC server does not merely skew the check — **it
disables it**:

| Environment | now() − utcnow() | 202.6 km jump computes as | Guard |
|---|---|---|---|
| Dev box (IST, UTC+5:30) | **+5.5 h** phantom gap | **37 km/h** | ❌ passes — **guard inert** |
| GitHub CI (UTC) | ~0.05 s | **14,589,304 km/h** | ✅ 422 fires |

So **GPS teleportation validation has never functioned on any non-UTC deployment** — the exact
anti-spoofing check B3-9 is meant to harden. It also stored reports in local time while
`issues.updated_at`/`/repair` use UTC — **two clocks in one schema**, which would skew the `/analytics`
time-series and the map's timestamp by the offset.

**Fix:** stamp with the same `current_time` the guard already validated against — one clock, one
instant. Regression test `test_report_timestamp_is_utc_not_local_time` **confirmed to fail on the old
code**: *"report timestamp sits 5.5 h outside the UTC window"*.

> ⚠️ **That regression test is only *sensitive* on a non-UTC machine** — in CI, `now()` and `utcnow()`
> coincide and it passes either way. This is the right way round (the bug only manifests in a real
> timezone, i.e. on a dev box or a real deployment) but **a green CI run is not proof it stays fixed.**

### The interaction — why local was green and CI was red

**The timezone bug was masking the test pollution.** The 5.5 h phantom gap made the 202.6 km jump look
like a leisurely 37 km/h, so locally the guard stayed quiet and the polluted state was invisible.
Remove the timezone offset (i.e. run in UTC, i.e. run CI) and both surface at once.

### Process fix — reproduce CI's environment, don't trust the ambient one

A local pass was never evidence about CI, because this machine is not in CI's timezone. **`TZ=UTC`
works through the Bash tool** (verified: offset drops to −0.00 h), so the suite is now run in CI's
zone before any claim of green:

| Zone | Result |
|---|---|
| `TZ=UTC` (**CI-equivalent**) | ✅ **26 passed** |
| ambient IST (+5:30) | ✅ 26 passed |
| `TZ=America/Los_Angeles` (−7, **opposite sign**) | ✅ 26 passed |

The opposite-sign zone is deliberate — it proves the fix is not merely correct in one direction.
`ruff format` also caught the new test file, the same gate §5d had missed.

**Totals: 82** (26 backend + 56 frontend).

> 📌 **Debt noted, deliberately not fixed here:** `datetime.utcnow()` is **deprecated** and warns
> throughout the suite; the durable form is `datetime.now(datetime.UTC)`. It appears ~7× in `main.py`
> plus `models.py` defaults. Left alone to keep `8abbe91` scoped to the defect — worth a dedicated
> sweep in Phase 4 (see §7).

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

## 6b. 🔴 D-4 — The PRD's accuracy targets are falsified. Renegotiate before Phase 4.

**This is a product decision, not an engineering task, and it is now blocking.**

The PRD specifies **precision ≥ 95% / recall ≥ 90%**; Phase 2 specified **mAP50 ≥ 0.75**. Person A has
**experimentally falsified both as reachable by scaling this approach** — two independent hypotheses,
each tested and each dead:

| Hypothesis | Experiment | Result |
|---|---|---|
| "It's under-trained" — more epochs, bigger model, higher resolution | `v2-2` | ❌ **Falsified** — 0.556 → **0.550**. Moved *along* the precision/recall curve, not the curve itself. |
| "It needs more data" | `v4-all` — **4x the data** (5.4k → 27k images, 1 → 6 countries) | ❌ **Falsified as a step-change** — net **+4 frames** (105/122 → 109/122). Mixed, not a clean win: better on `potholevideos` (45→51/55), *worse* on `india` (60→58/67). |

**The ceiling is LABEL QUALITY**, not data quantity and not training config. RDD's labels are
inconsistent — the same damage is boxed differently across countries, and much is unlabelled.
This is evidence, not opinion. Anyone proposing "just train it longer / feed it more" should be
shown the table in `ai/experiments.md` §"What it actually proves".

**The three remaining levers** (per `ai/experiments.md`):
1. **Better labels** — relabel a domain-matched subset to a consistent standard. Expensive, slow, and the only lever with real headroom.
2. **A domain-matched dataset** — real vehicle-mounted dashcam footage. **Also closes A3-5**, the largest untested risk (see below).
3. **Accept a lower, honest target** — cheapest, and defensible *because* it is measured.

**Recommendation:** re-baseline the PRD on the **real-footage ship gate** the AI track has actually
been using — `109/122` frames hit with `0/57` false positives — rather than on an RDD mAP50 number
that Person A has repeatedly shown "has never decided anything here" and is not even comparable
across versions. **Person B cannot make this call alone — it needs the PRD owner.**

> ⚠️ **The risk that dwarfs the target debate:** *no model has ever been validated from a moving
> vehicle.* Every positive result — v3 and v4 alike — comes from the same low, road-filling camera
> domain (median detection height 0.39 vs 0.41). The product is a **windshield dashcam**. A3-5 is
> ⬜ Not started for want of footage. Renegotiating a number measured only in the wrong domain risks
> agreeing a target that is still meaningless. **Get dashcam footage first.**

---

## 7. Phase 4 (Deployment & Edge Cases) — Starting Position

**Phase 3 platform status: feature-complete except B3-7, plus residual UI gaps.** (Updated by the §9
audit: **B3-3 is done**, **B3-9 is partial not unbuilt**.) Everything is committed and pushed, CI is
green on every gate, 82 tests pass, and S5 is verified live. **Remaining platform gaps:** B3-7
(performance never measured), the B3-2 notification **bell UI** (backend done, no frontend), `weather`
display (B3-5), and B3-9 loose ends (prod-only upload encryption, GPS guard never run in anger).

### Entry criteria — carried over, must land before/early in Phase 4

| # | Item | Owner | Why it blocks |
|---|---|---|---|
| **D-4** | **PRD target renegotiation** (§6b) | **PRD owner** + A | Phase 4 cannot declare "done" against a target proven unreachable. |
| **A3-5** | Field validation from a real vehicle | A | Largest untested risk. Every accuracy claim is out-of-domain until this exists. |
| ~~**B3-3**~~ | ~~Road Health Score~~ | B | ✅ **Done** — built (backend hex-grid + frontend choropleth). Load-testing folds into B3-7. |
| **B3-7** | Performance validation (~10k reports, p95 `/map` + `/analytics` **+ `/analytics/road-health`** < 2 s) | B | Indexes exist (`d7a1f0962038`) + `scripts/seed_10k_reports.py`; **never actually measured**. The road-health hex-grid query is heavy (per-hex correlated subqueries) — measure it too. |
| **B3-9** | Security — `SECRET_KEY` rotation, GPS validation, encrypted uploads | B | ✅ `SECRET_KEY` **hard-fails without env var** — no dev default (the old claim here was wrong; `auth.py:14-25`). Remaining: upload encryption is **prod-only** (`ENVIRONMENT=production`), dev unencrypted; ⚠️ the GPS teleportation guard was *inert on every non-UTC server* until S5-13 (G-14) and has **never run in anger** — re-audit, don't assume. |

### Phase 4 scope

1. **Deployment** — cloud Postgres+PostGIS, real S3, managed Redis, domain + TLS, secrets out of code. `docker-compose` → a real target.
2. **Model hot-swap** — `POST /admin/models/{id}/activate` records *intent* only; the inference process is not reloaded. Close the loop with a watcher on `is_active` + `fetch_model.py` (SHA256-verified). **The registry bridge in §5e is the groundwork for this.**
3. **Edge cases** — offline/intermittent capture, duplicate suppression across drives, clock skew, GPS dropout mid-drive (`gps_source` provenance already carries this), 10 MB upload cap under real 4G.
4. **Latency headroom** — A3-6 passes at **93.7 ms against a 100 ms budget: a 6% margin**. Depth (A3-3) or segmentation would blow it. 93.7 ms ≈ **10 fps — not real-time for 30 fps video**; decide the sampling story explicitly.
5. **`weather` enrichment** — stored by `enrichment.py`, rendered nowhere. Either surface it or drop the column (B3-5 residue).
6. **Observability** — `/health` and `/admin/system-health` are live; no metrics, tracing or alerting.
7. **Time hygiene sweep (G-15)** — migrate `datetime.utcnow()` → `datetime.now(datetime.UTC)` (deprecated, warns throughout the suite) and consider timezone-**aware** datetime columns. G-14 proved that "naive UTC by convention" is a convention that silently breaks; a server in a real timezone is a Phase-4 certainty, not a hypothetical.

### Known Phase-4 traps, learned the hard way

- **A field must be listed in 3 places** to reach the map (backend `properties` → `mapUtils.mapFeatureToIssue` → component). Miss one and it is `undefined` with **no error anywhere** — this bit B3-6 twice.
- **Fail closed on provenance and trust.** Every `gps_source` consumer independently defaulted a missing value to `"exif"` and rendered faked pins as verified.
- **Verify the gate you claim, in the environment that claims it.** §5d called CI green having run one of two ruff steps; §5e called it green from a UTC+5:30 box while CI runs UTC. Both were wrong. Run `TZ=UTC` (§4).
- **Never mix `now()` and `utcnow()`.** G-14: one naive-local timestamp silently disabled a security check for months, and was invisible in UTC. If a check divides by a time delta, a clock mismatch doesn't skew it — it *disables* it.
- **A test that commits data must own its `vehicle_id`.** Sharing a `Form` default let one test's report trip another's teleportation guard (§5f).
- **"Done" must mean committed.** 34 files of "✅ Done" Phase-3 work were never in git.
- **Green tests ≠ working feature.** B3-6 was test-green end-to-end while broken in the browser. The manual click found it. **Drive the UI.**

---

## 8. Phase 3 (Beta) — Original Scope (reference)

These were the Phase-3 scope items as defined at kickoff:

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

---

## 9. PRD Completion Audit (2026-07-18)

Full codebase-vs-PRD verification (two parallel Explore sweeps over `backend/`, `ai/`, `frontend/src`
+ direct reads). **No servers were spun up** — the one thing that can't be re-measured from code
(model accuracy) is already documented (§H) and blocked on dashcam footage (A3-5).

### Headline: platform ≈ 90%, AI ≈ 40%, overall ≈ 75%.

The backend/frontend platform is essentially feature-complete. The **AI model is the gap**, and its
accuracy targets are experimentally falsified (§6b / D-4).

### Scorecard vs the PRD

| PRD area | Status | Note |
|---|---|---|
| **7 APIs** (`/detect`,`/upload`,`/reports`,`/map`,`/analytics`,`/verify`,`/repair`) | ✅ 100% | All present + auth, fleet, notifications, admin registry, health |
| **Verification engine** (PostGIS clustering) | ✅ | `ST_DWithin` 20 m + duplicate merging |
| **Dashboards** (Authority/Fleet/Admin) | ✅ | Role-scoped view sets in one page, not 3 routes — all PRD sub-items present |
| **Repair workflow + audit log** | ✅ | State machine + `IssueAuditLog` |
| **Security** (JWT, roles, GPS validation, audit) | 🟡 ~80% | Encrypted uploads prod-only; see B3-9 |
| **Data enrichment** (road name / weather) | 🟡 | `road_name` wired; `weather` stored, shown nowhere |
| **Notifications** | 🟡 | Backend done; **no in-app bell UI** |
| **Road Health Score** *(PRD "future")* | ✅ | Already built (backend + choropleth) |
| **Detection classes** (7 required) | 🔴 **2/7** | Model = `pothole`+`crack`. UI *registry* knows 7; filter buttons show 2 |
| **AI pipeline** (YOLO→segmentation→depth→severity) | 🔴 | YOLO ✅, severity ✅ (relative), GPS ✅ — **segmentation & depth NOT built** |
| **Accuracy** (precision ≥95% / recall ≥90%) | 🔴 | Best real footage 109/122 (~89%), 0 FP. Falsified as reachable by scaling (D-4) |
| **Latency <100 ms/frame** | ✅ | 93.7 ms — 6% margin, fragile |

### Corrections this audit made to the tracker

1. **B3-3 Road Health Score** was `⬜ Planned` — it is **built** end-to-end (`routers/analytics.py:83`
   hex-grid + `MapComponent.js` choropleth + `AnalyticsView.js` worst-segments). **Fixed above.**
2. **B3-9 `SECRET_KEY`** — §7 claimed "still has a dev default in `auth.py`." **False:** `auth.py:14-25`
   hard-fails with `ValueError` if the env var is unset (test key only under pytest). **Fixed above.**
3. **B3-2 notification bell** — was `✅ Done`; the **UI half does not exist** (only `Toast.js`).
   Downgraded to 🟡. **Fixed above.**

### New findings not previously tracked

- **Large frontend restructure landed** beyond B3-8's original component split — now a full app shell:
  `components/shell/` (Sidebar, PageHeader, ⌘K CommandPalette), `components/views/` (six swappable
  views: Map/Queue/Reports/Analytics/Fleet/Admin), `components/ui/` (design-system primitives, Panel,
  Gauge), `components/marketing/LiveNetwork.js` (animated login backdrop — **not** a landing page;
  `/` redirects to `/login`), `lib/motion.js` + `lib/theme.js` (motion + design tokens). Uses
  `motion/react`, `recharts ^3`, `react-leaflet 5`, `lucide-react`. Working tree is clean (committed).
- **Class filter UI is hardcoded to 2 classes** (`Filters.js` `knownClasses` defaults to
  `["pothole","road_crack"]`, not overridden in `page.js`) even though `classUtils.js` registers all 7.
  Cheap win: pass the full list once the model emits more classes.
- **Auth is cookie/session** (`credentials:"include"` + localStorage user), not client-side bearer-JWT
  token handling — functionally fine, just not literally what "JWT" implies on the frontend.

### What actually blocks "PRD done" (all AI/data, not platform)

1. **D-4** — renegotiate the 95%/90% targets (proven unreachable by scaling).
2. **A3-5** — validate from a moving vehicle; every accuracy number is out-of-domain (handheld footage).
3. **5 missing detection classes** + **road segmentation** + **depth estimation**.

---

## 10. Post-Audit Build Log (2026-07-18 →)

After the §9 audit, a full section-by-section PRD review was run with the user (Person B / PRD owner).
Three deliverables live in `docs/` (with PDFs):

- **`docs/PRD_Review_and_Actions.md`** — all 20 PRD sections: reality → insight → actions, + a 4-bucket
  Master Action List (Decisions · PRD edits · Code · Tests).
- **`docs/PRD_Decisions_To_Make.md`** — the product decisions only the owner can make.
- **`docs/PRD_Implementation_Plan.md`** — the code items with concrete file/line anchors, ordered
  quick-wins-first.

> The PRD itself (`docs/RoadSense_AI_PRD.md`) was deliberately **left unedited** — the review docs are
> the working layer; the PRD edits are queued, not yet applied.

### 7 product decisions — LOCKED (2026-07-18)

| # | Decision | Call |
|---|---|---|
| 1 | Cloud vs edge | **Cloud now, edge later** |
| 2 | Class scope | **4 classes + water flag** (pothole, crack, broken road, edge damage; drop speed breaker + patch repair) |
| 3 | Weather field | **Keep, label "future use"** → weather UI items deferred |
| 4 | #1 user | **Authority first** (⚠️ needs a data-seeding step so the map isn't empty) |
| 5 | Real dashcam footage | **Yes — commit** (highest-value action; unblocks D-4 + A3-5) |
| 6 | Privacy (blur faces/plates) | **Commit, build before launch** (not blocking private testing) |
| 7 | Accuracy target | **Measure first, then commit** — the footage drive sets the number (this is how D-4 resolves) |

### Code items — plan vs done

Plan = 11 code items (7 backend + 4 frontend). Decision 3 defers the 2 weather items → **9 active**.
Build order: quick wins first.

| # | Item | Layer | Status |
|---|---|---|---|
| 4 | **Login rate-limiting** | Backend | ✅ **DONE** — see below |
| 8 | **Notification bell UI** | Frontend | ✅ **DONE** — see below |
| 2 | **Rename workflow "verified" → "approved"** | Both | ✅ **DONE** — see below |
| 1 | **Verification threshold (≥2 vehicles)** | Backend | ✅ **DONE** — see below |
| 9 | **Show verified vs pending** | Frontend | ✅ **DONE** — see below |
| 3 | **Priority score** | Backend | ✅ **DONE** — see below |
| 10 | **Sort queue by priority** | Frontend | ✅ **DONE** — see below |
| 5 | **Privacy blur (faces/plates)** | Backend | ✅ **DONE** (built now, gated off) — see below |
| 6 | Frame sampling | Backend | ⬜ deferred — only if video upload added |
| 7 / 11 | Weather (map + display) | Both | ⏸️ deferred (Decision 3) |

### ✅ #4 — Login rate-limiting (DONE)

- **`backend/rate_limit.py` (new)** — per-key failed-attempt limiter. Redis `INCR` + `EXPIRE` window is
  the source of truth; degrades to an in-process dict when Redis is `None` (mirrors
  `notification_service`'s pattern). Config: `LOGIN_MAX_ATTEMPTS=5`, `LOGIN_WINDOW_SECONDS=900`.
- **`backend/main.py` `/auth/login`** — added `request: Request`; key = `{client_ip}:{username}` (limits
  a targeted account without locking a shared IP). Returns **429 + `Retry-After`** once the window is
  hit; records a failure on bad password; **resets on success**.
- **Test:** `test_login_rate_limiting` — 5×401 → 429, correct password also blocked during the window,
  a different username unaffected. **Owns its counter state** (resets the key via the real
  `main.redis_client` at both ends) — an early version passed `None` and left the Redis key dirty,
  failing the *next* full-suite run (`assert 429 == 401`). Fixed. Ran twice under `TZ=UTC` to confirm.
- **Gates:** compileall ✅ · `ruff check` ✅ · `ruff format --check` ✅ (33 files) · pytest ✅ **27** under `TZ=UTC`.

> **Lesson reinforced (again):** a test that writes to a persistent store (Redis here) must reset that
> store with the *same* client the app uses — not a `None` stand-in. Same class of bug as §5f's
> `vehicle_id` pollution.

### ✅ #8 — Notification bell UI (DONE)

The notifications backend (`routers/notifications.py`) was fully built but **completely unconsumed** —
alerts were computed and never shown. This is the missing UI.

- **`frontend/src/components/shell/NotificationBell.js` (new)** — bell icon + unread-count badge +
  dropdown feed. Fetches `GET /notifications?limit=20` on mount and **polls every 60 s**; badge from
  `unread_count`. Click a row → `POST /notifications/{id}/read` (optimistic); "Mark all read" →
  `POST /notifications/read-all`. Outside-click closes the dropdown. Uses `motion/react` + `lucide-react`
  + the design tokens, matching the shell.
- **`frontend/src/app/page.js`** — imported the bell and passed it to `PageHeader` via the existing
  `actions` slot (`PageHeader.js:64`).
- **await-first discipline:** the fetcher reaches `await fetch(...)` before any `setState`, so the mount
  effect + interval never trip `react-hooks/set-state-in-effect` (the rule §5d fought). ESLint confirms.
- **Gates:** `eslint src` ✅ exit 0 · `jest` ✅ **63** · `next build` ✅ (`/` still prerenders static — the
  bell didn't break SSR).
- ⚠️ **Not yet clicked in a live browser** against a running backend (same caveat as the Admin Sync
  button, §5e). Automated gates pass; a manual click-through is the one remaining check. Also, no unit
  test was added — the Jest suite doesn't cover shell components (it tests `classUtils`/`gpsUtils`/
  `mapUtils`/`StatCards`/`Filters`); worth a fetch-mocked test later.

### ✅ #2 — Rename workflow status "verified" → "approved" (DONE)

The workflow status `verified` clashed with the *automatic* verification-by-sightings concept that #1
introduces. Renamed to **`approved`** in lockstep across backend + frontend + tests + a data migration.

- ⚠️ **The rename was surgical, NOT a blind find-replace.** "verified" appears in two unrelated
  meanings: (a) the workflow status — renamed; (b) **GPS provenance** ("✓ GPS VERIFIED", "unverified
  location", the fail-closed `gpsUtils` rule) — **left untouched**. A blanket replace would have broken
  the B3-6 provenance work. Every occurrence was classified by grep before editing.
- **Backend:** `main.py` `VALID_TRANSITIONS` (key + both value-sets), `models.py` status comment,
  `test_repair.py`, `test_auth.py`.
- **Data migration:** `migrations/versions/e5c1a2f3b6d7_...py` — updates `issues.status` **and**
  `issue_audit_logs.old_status/new_status` (`verified`→`approved`), with a symmetric `downgrade`. Chains
  onto `d7a1f0962038`; **alembic head is now `e5c1a2f3b6d7` (single head, verified).**
- **Frontend:** `classUtils.js` `STATUS_ORDER`, `QueueView.js` + `MapView.js` (`NEXT_STATUS`,
  `ACTION_LABEL` — the button label also changed "Verify"→"Approve"), `MapComponent.js`
  `statusTransitionMap`, `Filters.js` dropdown option, `page.js` queue subtitle, + `Filters.test.jsx`
  and `classUtils.test.js`. (Status badges render `{status}` under CSS `capitalize`, so "approved"
  auto-displays "Approved" — no separate label map needed.)
- **Gates:** backend — compileall ✅ · ruff check ✅ · ruff format ✅ (34) · pytest ✅ **27** (`TZ=UTC`) ·
  alembic single head ✅. Frontend — eslint ✅ · jest ✅ **63** · next build ✅.
- ⚠️ **Migration not yet run against the live DB** (`alembic upgrade head`) — tests use
  `create_all`, not migrations, so the data migration is unexercised. Run it on the dev DB before relying
  on it. Same "drive it for real" caveat.

### ✅ #1 — Verification threshold (≥2 distinct vehicles) (DONE)

An Issue was "created" from a single report and `detection_count` incremented **per report regardless
of vehicle** — so "verified" meant nothing (one circling car could inflate it). Now an Issue is
**`is_verified=True` only once ≥2 DISTINCT vehicles have reported it.**

- **`models.py`** — new `Issue.is_verified` (Boolean, `server_default false`). Migration
  `f2a7b9c4d1e8_add_is_verified_to_issues.py` (chains onto `e5c1a2f3b6d7`; **alembic head is now
  `f2a7b9c4d1e8`, single head**).
- **`main.py` `cluster_report_to_issue`** — on attach, gathers **distinct non-empty `vehicle_id`s** among
  the issue's reports (+ the current report) and sets `is_verified` when ≥2. New issues start `False`.
  Only non-empty vehicle_ids count, so anonymous/demo-web-upload reports never self-verify.
- **Exposed:** `/map` properties + `schemas.IssueResponse.is_verified`; **whitelisted in
  `mapUtils.js`** (the 3-places rule — else it vanishes) + a `mapUtils.test.js` regression.
- **Tests:** `test_verification_threshold_needs_two_distinct_vehicles` — 1 vehicle (even repeated) stays
  unverified, a 2nd distinct vehicle flips it; plus an assertion on the existing 4-vehicle cluster test.

> 🔴 **This task's test exposed and fixed a real production bug (partial G-15 / §5f-class).**
> `validate_gps_and_teleportation` did `aware_timestamp − naive_db_timestamp` → **`TypeError` 500 on the
> SECOND report from ANY vehicle** whenever timestamps are tz-aware (the normal Contract-v2 `+05:30`
> case). The existing clustering test never caught it because it used all-distinct vehicles (guard never
> compares two same-vehicle reports). Fix: new `to_naive_utc()` helper — `/detect` now **stores** naive
> UTC and the guard **normalises both operands** before subtracting. Reports from different offsets now
> share one clock. `/detect-image` was already UTC (S5-13). **Still open in G-15:** the ~7 `datetime.utcnow()`
> deprecations and tz-aware columns; this only fixed the `/detect` ingest path.

### ✅ #9 — Show verified vs pending (DONE)

Surfaces the `is_verified` field (#1) in the UI so authorities can tell a corroborated issue from a
single unconfirmed sighting. Frontend-only — no backend, no migration.

- **`MapComponent.js` popup** — a corroboration badge below the GPS-provenance block: green
  "✓ VERIFIED — corroborated by ≥2 vehicles" vs neutral "⏳ UNVERIFIED — awaiting a second vehicle".
  Explicitly **orthogonal to GPS provenance** (location trust vs sighting trust) — commented as such.
- **`MapComponent.js` marker** — verified pins get a small green ✓ badge at the **top-left** corner
  (`createMarkerIcon` gained an `isVerified` arg; render passes `report.is_verified`). Its own corner,
  so it never collides with the count badge (top-right) or the faked-GPS ring. Uses `STATUS.good`.
- **Gates:** eslint ✅ · jest ✅ **64** · next build ✅. No new unit test — map/shell components aren't
  covered by the Jest suite; the `mapUtils` `is_verified` regression (#1) already guards the data hop.
- ⚠️ Not clicked in a live browser (same standing caveat).

### ✅ #3 — Priority score (DONE)

Severity answers "how bad"; **priority answers "how urgent"** — the number an authority triages on
(the Authority-first decision made this the core dashboard signal). Backend-only.

- **`models.py` `Issue.priority`** — a **computed `@property`** (0-100), so it's the single source of
  truth read by both `/map` (manual dict) and `IssueResponse` (Pydantic `from_attributes`). Formula:
  severity (high 50 / med 30 / low 10) + sightings `min(25, count*5)` + verified `+15` + age escalation
  `min(10, age_days)`; **completed/closed → 0** (resolved work isn't urgent).
  ⚠️ **Traffic density / road importance are NOT in the formula** — that data doesn't exist yet; a
  busy-road pothole can't yet outrank a quiet one. TODO documented on the property. (Matches the PRD
  review's severity-vs-priority split.)
- **Exposed:** `/map` properties + `schemas.IssueResponse.priority`; **whitelisted in `mapUtils.js`**
  (+ whole-shape `toEqual` and a dedicated regression in `mapUtils.test.js`).
- **Test:** `test_spatial_clustering` asserts the high-severity, 4-vehicle, verified cluster scores
  exactly **85** (50+20+15+0).
- **Gates:** backend ruff ✅ · pytest ✅ **28** (`TZ=UTC`). Frontend eslint ✅ · jest ✅ **65** · build ✅.
- Pairs with **#10** (sort the queue by this) — done below.

### ✅ #10 — Sort repair queue by priority (DONE)

Completes the Authority-first triage pair with #3. Frontend-only.

- **`views/QueueView.js`** — the `pending` useMemo now sorts by **`issue.priority` descending** (was
  severity-only), with severity as the tiebreak. A missing priority sinks to the bottom (`?? -1`) rather
  than jumping the queue. Each row shows a compact **⚡{priority}** indicator so the ordering is legible
  (otherwise the reorder looks arbitrary). Doc comment updated: the queue answers "what needs someone
  next" = urgency, not severity/chronology.
- **Gates:** eslint ✅ · jest ✅ **65** · next build ✅. (QueueView isn't covered by the Jest suite; the
  `priority` data hop is guarded by the `mapUtils` regression from #3.)
- ⚠️ Not clicked in a live browser (standing caveat).

### ✅ #5 — Privacy blur (faces + plates) (DONE — built now, gated off per Decision 6)

Street imagery captures faces + plates = personal data (DPDP/GDPR). Now redacted **before** storage.

- **`backend/privacy.py` (new)** — `blur_faces_and_plates(bytes, content_type, filename)`:
  cv2 decode → **OpenCV Haar cascades** (face + plate) → `GaussianBlur` each region → re-encode
  (format preserved: png/webp/jpg). **Fail-closed** — raises on any error so the caller never stores
  un-redacted PII. `is_blur_enabled()` reads `PRIVACY_BLUR` **live** (default `0`).
- **Why Haar:** cascades **ship bundled with opencv** → no separate weight files (sidesteps the
  gitignored-weights problem the YOLO model has). ⚠️ **BASIC best-effort** — frontal faces + a
  region-specific plate cascade; NOT production-grade anonymisation. Upgrade path = a DNN detector.
  Documented on the module.
- **`main.py` `/detect-image`** — after inference (runs on the CLEAR image), before S3 upload:
  `if privacy.is_blur_enabled(): contents = privacy.blur_faces_and_plates(contents, ...)`. Default off,
  so current testing is unaffected; flip `PRIVACY_BLUR=1` before any public launch.
- **Deps:** `requirements.txt` — `opencv-python-headless>=4.10,<5.0` + `numpy`. **Pinned `<5.0`:**
  OpenCV 5.x's headless wheel **stopped bundling the Haar XMLs** (hit this live — 5.0 installed but
  `cv2.data.haarcascades` was empty; 4.13 has all 17). ⚠️ **CI/Docker must `pip install` these** — first
  non-pure-Python backend addition; opencv is a chunky wheel.
- **Tests:** `test_privacy.py` (6) — module (env gate, real decode→blur→encode round-trip preserving
  dimensions + png format, **fail-closed on garbage bytes**) + integration (blurred bytes reach S3 when
  enabled; blur skipped when disabled). Distinct `vehicle_id`s to avoid the §5f teleport-pollution trap.
- **Gates:** compileall ✅ · ruff ✅ · pytest ✅ **34** (`TZ=UTC`).
- ⚠️ **Not validated on a real face/plate image** — tests prove the *pipeline* runs and the *gate*
  works, not Haar's detection accuracy (which is known-mediocre). Validate on real footage before
  trusting it as a compliance control. Also un-exercised end-to-end with `PRIVACY_BLUR=1` against live S3.

### ✅ Live verification (2026-07-18, Person B, running stack)

All 5 applicable items confirmed **in a real browser** against the live stack (real `ai/infer_service`
on :8001, Postgres, Redis, MinIO): #8 bell renders, #2 queue shows Detected/**Approved**/Assigned/
Repair, #4 login 429 after 5 fails, #3/#10 queue shows ⚡ priority ordered highest-first, and **#1/#9
verified end-to-end** — two `/detect` reports at one spot from `car-A`+`car-B` clustered into a single
pin that flipped to green **"✓ VERIFIED — corroborated by ≥2 vehicles"** with the ✓ marker; a single
report shows **"⏳ UNVERIFIED"**.

> ⚠️ **New known gap (demo tool, not a bug): the web "Demo Telemetry Upload" cannot demonstrate
> clustering or verification.** `page.js:378-380` **hardcodes `vehicle_id="demo-web-upload"`** and
> **jitters GPS randomly** per upload — so repeated UI uploads are always one vehicle at scattered
> locations, never ≥2 vehicles at one spot. Verification is only reachable via the API (or a real
> multi-vehicle fleet). Worth letting the demo uploader pick a vehicle_id + reuse a location so #1/#9
> are demoable without curl. Migration note: the dev `roadsense` DB is shared with the test suite
> (`create_all`), so it drifted ahead of Alembic — `alembic upgrade head` hit a DuplicateColumn and was
> resolved with `alembic stamp head` (schema already matched). Fresh deploys upgrade cleanly.

## 11. Post-audit UI/UX iteration (2026-07-18, Person B)

Front-end polish beyond the 8 code items, all gate-green (eslint · jest 65 · next build), most
verified via headless-Chrome screenshots.

### Login redesign (committed `11854a8`)
- **`marketing/LiveNetwork.js`** rewritten: backdrop tours random **inland** Indian cities (fly-in →
  hold → repeat) so the viewport is always land; each hold generates a **fresh random scene** (8–12
  hazards, 5–7 vehicles) on a jittered grid. Vehicles drive **straight segments with sharp turns** and
  **jolt** on crossing a hazard. **Root-cause fix:** heading was computed in %-space but the viewport
  isn't square → cars visibly *slanted* on diagonals; now **aspect-corrected** (`atan2(dy·H, dx·W)`) so
  the nose points along true travel. No easing → no wobble.
- **`components/ui/Logo.js` (new)** — custom mark (road-in-perspective → detection node + sensing arcs),
  replacing the generic pulse icon; used in the enlarged top-left brand lockup + card header.
- **`app/login/page.js`** — slim sign-in console mounted on a glowing **beacon** (opens to the right on
  click); **minimalist light/dark toggle** scoped to the login via `data-theme` on `<main>` (dashboard
  untouched); deep-linkable `?theme=light|dark`. Light palette + `.glass`/leaflet overrides in
  `globals.css`.

### Admin = operator console (this batch — view/act model)
Decision (with Person B): **admin is the internal operator, not a super-authority.** It ACTS only on
operator tasks and VIEWs customer data read-only — keeping the repair audit log honest (a status change
always means the authority acted).
- **`app/page.js`** — `SECTIONS.admin` is now `["map","reports","analytics","health","users","models"]`
  (dropped **queue** + **fleet**); the old combined "Admin Panel" is split into **three sidebar tabs**
  (System Health / User Management / Model Registry) via `AdminView` `fixedTab`. `canAct = role !==
  "admin"` gates map actions.
- **Read-only map for admin:** `MapComponent` gained `canRepair` — the popup shows status + lifecycle
  but hides the change controls for admin; `MapView` quick-action buttons hidden (`onQuickAction`
  undefined).
- **User CRUD (backend, admin-gated):** `POST /admin/users` (create), `DELETE /admin/users/{id}`
  (guards: no self-delete, no last-admin), `POST /admin/users/{id}/password` (reset). Frontend
  `UserDirectory` now has an **Add-user form** + per-row **reset-password** (inline) and **delete**
  (trash, hidden on own row). Tests: `test_admin_create_user`, `test_admin_delete_and_reset_password`
  (auth 401/403, 409 dup, self/last-admin guards).
- **Telemetry Upload removed from admin System Health** — an image-upload (data-creation) box didn't
  belong in a monitoring tab or the view-only operator model. Still available in the Fleet dashboard.

### ✅ Security: public `/auth/register` removed (2026-07-18)

The public `POST /auth/register` was **unauthenticated and accepted an arbitrary `role`** → anyone
could self-register as **admin** (privilege escalation). **Removed entirely** — user creation now goes
**only** through the admin-gated `POST /admin/users`. The old register/login test was repointed at
`/admin/users` (`test_create_login_me_logout`). **Backend 36 tests, all green.** *(Historical planning
docs still mention `/auth/register` — left as-is; they describe past intent, not current code.)*
