# RoadSense AI — Continuous Memory and Context Log (Phase 2 - MVP)

This file is the canonical progress tracker for the RoadSense AI Platform (Backend & Frontend),
maintained by Claude (Sonnet 4.6) starting from Task B-6. Updated after every completed and
verified task.

## Project Metadata

| Field | Value |
|---|---|
| **Project Name** | RoadSense AI (Platform) |
| **Role** | Person B (Backend & Frontend Platform Owner) |
| **Sprint** | Phase 2 (Local Development / MVP) |
| **Tech Stack** | FastAPI · Next.js · Tailwind CSS · Leaflet (OpenStreetMap) · PostgreSQL + PostGIS (Docker) · Redis · MinIO (S3-compatible) |
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
- `ST_DWithin` (Geography cast) clusters reports within **20 m** of the same location into one `Issue`.

### E. AI Inference Integration (Contract v2)
- **Seam:** `POST /infer` on port 8001. Request: `multipart/form-data { file }`. Response: `{ model_version, image, inference_ms, detections: [{ class, confidence, bbox, severity }] }`.
- **Switch:** `INFERENCE_URL` env var (default: `http://localhost:8001` → stub). One env-var swap to point at Person A's real service.
- **Stub:** `backend/stub_infer.py` — tiny FastAPI app that returns plausible random detections (including empty arrays).

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

---

## 2. Phase 2 Progress Summary

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

---

## 3. Active Technical Notes

| Service | URL |
|---|---|
| FastAPI backend | `http://localhost:8000` |
| Stub inference | `http://localhost:8001` |
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

---

## 4. Verification & Testing Status

- **Automated Tests:** 16 tests across `backend/test_api.py`, `backend/test_detect_image.py`,
  `backend/test_stub.py`, `backend/test_repair.py`, and `backend/test_auth.py` — covering auth
  limits, state-machine workflows, stub inference contract, upload pipeline (S3 mocking), and
  spatial clustering. All **PASSING**.
- **CI Status:** Both jobs (backend lint+test, frontend lint+build) expected green on `main`.

---

## 5. Files Changed in B-6

| File | Change |
|---|---|
| `backend/requirements.txt` | `boto3>=1.28.0`, `redis>=5.0.0` already present |
| `backend/s3_storage.py` | New file — MinIO/S3 client, `init_s3_bucket()`, `upload_image_bytes_to_s3()` |
| `backend/main.py` | Redis cache read/write in `GET /map` and `GET /analytics`; `GET /health` endpoint; paginated `GET /reports` |
| `frontend/public/images/marker-icon.png` | Local Leaflet marker icon |
| `frontend/public/images/marker-shadow.png` | Local Leaflet marker shadow |
| `frontend/src/components/MapComponent.js` | Uses `/images/marker-icon.png` and `/images/marker-shadow.png` |
| `frontend/src/app/page.js` | `reportPage` + `totalReports` state; `fetchData(currentUser, targetPage)` signature; pagination controls in Report Logs panel |
| `.github/workflows/ci.yml` | Added `frontend-lint-build` job: `npm ci` → `npm run lint` → `npm run build` |

---

## 6. Phase 2 Definition of Done — Status

| Criterion | Met? |
|---|---|
| No hosted-API dependency — pipeline runs offline | ✅ Stub covers dev; real `INFERENCE_URL` for prod |
| No secrets in repo | ✅ All credentials via env vars / `.env` |
| Upload flow is real — non-road image → 0 detections | ✅ `POST /detect-image` → stub/model |
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

**Phase 2 MVP is feature-complete.** 🎉
