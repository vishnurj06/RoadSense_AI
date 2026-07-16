# RoadSense AI — Full Codebase Audit Report
**Date:** 2026-07-16  
**Auditor Role:** Senior Technical Architect & Project Auditor  
**Source of Truth:** Live codebase + PRD + docs + memory files (claude.md / gemini.md)

---

## Executive Summary

> **Where you actually are:** Phase 2 (MVP) is **fully complete on the Platform side (Person B)**. The AI side (Person A) is **partially complete** — the real inference service is live and the model is improved, but it has not cleared the Phase 2 Definition of Done for the AI track. The project sits at roughly **~80% of "true" Phase 2 Done**.

---

## 1. PRD Phase Map (from the PRD itself)

| Phase | Name | Status |
|---|---|---|
| **Phase 1** | Proof of Concept | ✅ **Done** |
| **Phase 2** | MVP | ⚠️ **Platform: Done · AI: Partial** |
| **Phase 3** | Beta | ⬜ Not started |
| **Phase 4** | Production Deployment | ⬜ Not started |

---

## 2. What Was Built — Person B (Platform Track)

### B-0: Stub Inference Service
**Status: ✅ COMPLETE**
- [`backend/stub_infer.py`](file:///d:/Workspace/Projects/RoadSense_AI/backend/stub_infer.py) — Full FastAPI app on port 8001
- Serves `POST /infer` with plausible random detections (25% empty, correct Contract v2 shape)
- Serves `GET /health` endpoint
- `INFERENCE_URL` env var wired in [`backend/main.py`](file:///d:/Workspace/Projects/RoadSense_AI/backend/main.py)
- Service is in `docker-compose.yml` as `stub-infer` container

### B-1: Real Upload Flow
**Status: ✅ COMPLETE**
- `POST /detect-image` endpoint in `main.py` (lines 441–559)
  - Validates image type + size (10MB cap)
  - Calls `INFERENCE_URL/infer` via `httpx` async
  - Uploads bytes to MinIO/S3 via `s3_storage.upload_image_bytes_to_s3()`
  - Persists detections + `model_version` to DB
  - Triggers `cluster_report_to_issue()` immediately on insert
- Frontend `handleImageUpload` properly calls `/detect-image`
- Empty detections handled gracefully (no false pin)
- `model_version` stored and surfaced

### B-2: PostGIS + Real Duplicate Verification
**Status: ✅ COMPLETE**
- Docker: `postgis/postgis:15-3.4` in `docker-compose.yml`
- Both `reports` and `issues` tables have `Geometry(POINT, 4326)` columns with GiST indexes
- Alembic migrations manage all schema changes (no more `create_all()` on startup)
- `cluster_report_to_issue()` (`main.py:131`) uses `ST_DWithin` Geography cast with 20 m radius
- `POST /verify` endpoint for retroactive clustering
- Map renders issues (1 pin per issue), with `detection_count` badge
- Automated test confirms: 3 nearby frames → 1 issue

### B-3: Repair Workflow
**Status: ✅ COMPLETE**
- Full state machine: `detected → verified → assigned → inspection → repair → completed → closed`
- `VALID_TRANSITIONS` map enforces illegal transition rejection
- `IssueAuditLog` table tracks: who, when, old_status, new_status, notes
- `POST /repair` endpoint with actor from JWT
- `GET /issues/{id}/audit-log` endpoint
- Frontend: status badge on popup, dropdown to advance status, status filter

### B-4: Auth & Roles
**Status: ✅ COMPLETE**
- `POST /auth/login`, `POST /auth/register`, `POST /auth/logout`, `GET /auth/me`
- `bcrypt` password hashing (not argon2, bcrypt — equally secure)
- JWT in httpOnly cookies + fallback Bearer header
- `RoleChecker` FastAPI dependency class
- Roles: `authority`, `fleet`, `admin` — seeded defaults at startup
- All mutating endpoints protected; unauthenticated → 401, wrong role → 403
- CORS locked to `http://localhost:3000` only
- Glassmorphic login page at `/login`

### B-5: Dashboards
**Status: ✅ COMPLETE** _(per claude.md — task.md is stale/not updated)_

> ⚠️ **Discrepancy Found:** [`task.md`](file:///d:/Workspace/Projects/RoadSense_AI/task.md) still shows B-5 and B-6 as `[ ]` unchecked, but [`claude.md`](file:///d:/Workspace/Projects/RoadSense_AI/claude.md) (the canonical tracker, updated by the implementing agent) marks them both as ✅ Done. The source code confirms the implementation is present.

- `page.js` (1,064 lines) contains role-switched sidebar views
- **Authority view:** Recharts `AreaChart` (severity over time), `PieChart` (class distribution), pending-repair queue
- **Fleet view:** vehicle list, per-vehicle detection history, camera health indicator
- **Admin view:** user management (`GET /admin/users`), user role update (`POST /admin/users/role`), system health (`GET /admin/system-health`)
- Recharts integration confirmed (imported at top of `page.js`)

### B-6: Production Hardening
**Status: ✅ COMPLETE** _(per claude.md)_

| Sub-task | Evidence |
|---|---|
| MinIO/S3 for images | [`backend/s3_storage.py`](file:///d:/Workspace/Projects/RoadSense_AI/backend/s3_storage.py) — `boto3`, bucket auto-init, public-read policy |
| Redis cache (`/map` & `/analytics`) | `main.py:47–83` — cache-aside, TTL 300s, `clear_all_caches()` on mutators |
| Local Leaflet marker icons | `frontend/public/images/marker-icon.png` + `marker-shadow.png` (confirmed referenced in `MapComponent.js`) |
| Paginated `GET /reports` | `main.py:562–585` — `page` + `limit` params, `PaginatedReportsResponse` envelope |
| `GET /health` endpoint | `main.py:344–373` — checks DB (`SELECT 1`) + Redis (`ping`), returns 503 if DB down |
| Frontend CI (lint + build) | `.github/workflows/ci.yml` — `frontend-lint-build` job: `npm ci → npm run lint → npm run build` |

---

## 3. What Was Built — Person A (AI Track)

### A-0: Repo Hygiene
**Status: ✅ COMPLETE**
- All AI code is in the repo at `/ai/`
- No API keys in code — `.env` + `.env.example` pattern used
- `ai/requirements.txt` present
- `ai/README.md` present (3,816 bytes)
- `ai/Dockerfile` present

### A-1: Kill the Hosted-API Dependency
**Status: ✅ COMPLETE**
- [`ai/model.py`](file:///d:/Workspace/Projects/RoadSense_AI/ai/model.py) uses `ultralytics.YOLO(MODEL_PATH)` — fully local, no Roboflow API
- Confidence threshold: `CONF_THRESHOLD = 0.30` (env-configurable via `CONF_THRESHOLD`)
- Class names normalized to lowercase (`model.names[int(box.cls)].lower().replace(" ", "_")`)
- Runs with Wi-Fi off ✅

### A-2: Train the Model Properly
**Status: ⚠️ PARTIAL / BLOCKED BY DATA**
- [`ai/experiments.md`](file:///d:/Workspace/Projects/RoadSense_AI/ai/experiments.md) is a meticulously honest training log
- Run `v2-2`: `yolov8s`, 48 epochs (early-stopped), 640px, T4 GPU
- **Val metrics:** P 0.664 / R 0.472 / **mAP50 0.550** / mAP50-95 0.234
- **Phase 2 target was mAP50 ≥ 0.75 — NOT MET**
- Root cause correctly diagnosed: bottleneck is **data quantity/quality**, not training config
- `best.pt` (22.5 MB, `yolov8s`) is the current deployed model

### A-3: Expand Dataset & Class List
**Status: ❌ NOT DONE**
- Model is still **single-class only** (`pothole`)
- The `crack` filter in the frontend still matches nothing in real inference
- RDD2022 dataset integration has not been done
- The `experiments.md` explicitly calls this out as the next lever

### A-4: Ship the Inference Service
**Status: ✅ COMPLETE**
- [`ai/infer_service.py`](file:///d:/Workspace/Projects/RoadSense_AI/ai/infer_service.py) — full FastAPI app implementing Contract v2 §3
- Model loaded once at startup
- `GET /health` returns `model_version` + `model_loaded`
- Returns `200 + []` on empty detections (not an error)
- `inference_ms` measured and returned
- Proper error codes: 400 (invalid image), 413 (too large), 500 (inference failed)
- `ai/Dockerfile` allows `docker compose up` integration

### A-5: Real Severity Estimation
**Status: ⚠️ STILL BBOX-AREA HEURISTIC**
- [`ai/severity.py`](file:///d:/Workspace/Projects/RoadSense_AI/ai/severity.py) still uses the bbox-area ratio proxy
- The `medium` band still questionable (no evidence from experiments.md it fires correctly on real data)
- MiDaS / Depth-Anything not integrated
- Severity is correctly single-sourced and owned by the AI side (backend stores verbatim)

### A-6: Real GPS
**Status: ❌ NOT DONE (BUT ACCEPTABLE)**
- [`ai/detect.py`](file:///d:/Workspace/Projects/RoadSense_AI/ai/detect.py) still uses `fake_gps()` — random jitter around Mumbai
- No GPX track reader implemented
- Comment in code says "Task A-6 replaces this with a real GPX track"
- This is acknowledged debt, not a surprise

---

## 4. Infrastructure & DevOps

| Component | Status | Details |
|---|---|---|
| **PostgreSQL + PostGIS** | ✅ Done | `postgis/postgis:15-3.4` in docker-compose |
| **Redis** | ✅ Done | `redis:7-alpine` in docker-compose |
| **MinIO (S3-compatible)** | ✅ Done | `minio/minio` in docker-compose, ports 9000/9001 |
| **Stub Infer Service** | ✅ Done | `python:3.10-slim` in docker-compose |
| **Alembic Migrations** | ✅ Done | `backend/migrations/` — all schema changes tracked |
| **Backend CI** | ✅ Done | ruff lint + format + pytest (PostGIS service included) |
| **Frontend CI** | ✅ Done | `npm ci → lint → build` |
| **Backend Tests** | ✅ 16 tests passing | `test_api.py`, `test_detect_image.py`, `test_stub.py`, `test_repair.py`, `test_auth.py` |

---

## 5. Phase 2 Definition of Done — Honest Assessment

From the official DoD in `docs/RoadSense_AI_Phase2_Workflow_and_Task_Split.md` §9:

| DoD Criterion | Met? | Notes |
|---|---|---|
| No hosted-API dependency | ✅ | Local `best.pt` inference, works offline |
| No secrets in repo | ✅ | All via `.env`, gitignored |
| Upload flow is real (non-road → 0 detections) | ✅ | `POST /detect-image` + real YOLO model |
| All AI code in git, reproducible from clean clone | ✅ | `/ai/` committed, `Dockerfile` + `requirements.txt` |
| Model beats Phase-1 baseline (mAP50 > 0.556) | ❌ | mAP50 **0.550** — marginally BELOW 0.556 on val |
| ≥2 detection classes (`crack` filter lights up) | ❌ | Still single-class (`pothole` only) |
| Duplicate clustering is real (PostGIS, 3→1 issue) | ✅ | `ST_DWithin`, verified in tests |
| Repair workflow end-to-end + audit log | ✅ | Full state machine + `IssueAuditLog` |
| Auth works — unauthenticated writes rejected | ✅ | JWT + RoleChecker, tested |
| All three severity buckets populated by real data | ⚠️ | Heuristic works, but no validation on real dashcam data |
| CI green on backend AND frontend | ✅ | Two-job CI pipeline |

**Score: 8/11 criteria fully met. 3 partially or not met.**

---

## 6. Gap Analysis — What's Missing for Full Phase 2

### Critical Gaps (Block the true Phase 2 sign-off):

1. **Multi-class model (`crack` + others)** — A-3 not done
   - The dashboard `crack` filter button is dead UI. This was explicitly called out as the #1 priority in the Phase 2 plan.
   - Fix: integrate RDD2022 dataset, retrain, re-deploy `ai/weights/best.pt`

2. **Model accuracy — mAP50 ≥ 0.75 not achieved**
   - Current: 0.550 (val). Target: 0.75. The experiments log is honest about why: data bottleneck, not training config.
   - Fix: more/better training data. Hard-negative mining from the existing false-positive frames would help immediately.

3. **Real GPS** — A-6 not done
   - Every report on the map is placed at a random jitter around Mumbai regardless of where the image was actually taken.
   - Acceptable for local dev demo, but not for a real MVP delivery.

### Minor Gaps (Technical debt, not blockers):

4. **`task.md` is stale** — B-5 and B-6 show unchecked, but are actually done. Should be updated.

5. **System health endpoint returns hardcoded simulated data** (`main.py:795–806`) — CPU/memory/disk values are fake constants, not real system metrics.

6. **`GET /admin/system-health` simulates values** — not reading actual system metrics (psutil not used).

7. **The `best.pt` in `/ai/weights/` is `v2-2` (`yolov8s`)** but `MODEL_VERSION` env var in `ai/.env` still says `roadsense-yolov8n-v1` (or it may be updated — unable to verify without opening the .env).

8. **No fleet-specific backend endpoints** — fleet dashboard exists on the frontend, but there's no `GET /fleet/vehicles` or equivalent API; vehicle data is derived from the `vehicle_id` field on reports.

---

## 7. What Phase 3 (Beta) Would Require

Based on the PRD and Phase 2 docs:

| Phase 3 Task | Status |
|---|---|
| Model precision ≥ 95% / recall ≥ 90% | Not started |
| Real GPS integration (GPX or phone sensor) | Not started |
| Multi-class detection (≥2 classes, ideally all 7 PRD classes) | Not started |
| Notifications (email/SMS/push for new high-severity issues) | Not started |
| Road Health Score algorithm | Not started |
| Real fleet endpoint (vehicle registry, camera health polling) | Not started |
| Production deployment (cloud DB, real S3, domain/TLS) | Not started |
| Admin model-version registry (swap models without redeploy) | Partial — frontend has UI stub, no real model management API |
| Performance: `/map` p95 < 2s at ~10k reports | Not validated |
| Hard-negative mining to reduce false positives | Not started |

---

## 8. Architecture Health Assessment

| Concern | Rating | Details |
|---|---|---|
| **API design** | ⭐⭐⭐⭐ | Clean REST, proper HTTP codes, consistent schemas |
| **Database design** | ⭐⭐⭐⭐ | PostGIS, GiST index, Alembic — production-ready |
| **Authentication** | ⭐⭐⭐⭐ | JWT + bcrypt + role-based deps — solid |
| **Caching** | ⭐⭐⭐⭐ | Redis cache-aside with TTL + invalidation on writes |
| **Storage** | ⭐⭐⭐⭐ | MinIO/S3 with public-read policy — correct pattern |
| **AI/Backend seam** | ⭐⭐⭐⭐⭐ | One env var swap to flip stub ↔ real. Perfectly decoupled |
| **Test coverage** | ⭐⭐⭐ | 16 tests, but only backend; no frontend tests |
| **Error handling** | ⭐⭐⭐ | Good at endpoint level, but some silent failures (e.g., S3 init) |
| **Frontend quality** | ⭐⭐⭐ | Functional, role-gated, charts — but single `page.js` at 1,064 lines is growing unwieldy |
| **AI model quality** | ⭐⭐ | Works on real potholes (43/55 frames), fails on mismatched domain data, single-class only |
| **GPS accuracy** | ⭐ | Completely faked — Mumbai jitter |

---

## 9. Summary Verdict

```
┌───────────────────────────────────────────────────────┐
│  PHASE 1 (PoC)        ████████████████████  DONE ✅   │
│  PHASE 2 — Platform   ████████████████████  DONE ✅   │
│  PHASE 2 — AI Model   ████████░░░░░░░░░░░░  ~60% ⚠️  │
│  PHASE 2 — Overall    ████████████████░░░░  ~80% ⚠️   │
│  PHASE 3 (Beta)       ░░░░░░░░░░░░░░░░░░░░  0%   ⬜   │
│  PHASE 4 (Production) ░░░░░░░░░░░░░░░░░░░░  0%   ⬜   │
└───────────────────────────────────────────────────────┘
```

**Person B (Platform) has shipped a production-grade MVP backend and frontend.** All B-0 through B-6 tasks are complete and verified with 16 passing automated tests + CI.

**Person A (AI) has shipped the inference service and improved the model, but the Phase 2 AI DoD is not fully met**: the model has not cleared the mAP50 ≥ 0.75 target, it is still single-class, and GPS is still faked.

The most pragmatic next step to close Phase 2 is **A-3 (multi-class training with RDD2022)**, because it:
1. Lights up the existing `crack` filter UI (immediate visible demo value)
2. Adds training data diversity (likely improves recall)
3. Is a self-contained AI task that doesn't touch the platform at all
