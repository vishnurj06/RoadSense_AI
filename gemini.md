# RoadSense AI — Continuous Memory and Context Log (Phase 2 - MVP)

This file tracks the project state, architectural decisions, completed tasks, and verification statuses for the RoadSense AI Platform (Backend & Frontend) Phase 2 MVP.

## Project Metadata
- **Project Name:** RoadSense AI (Platform)
- **Role:** Person B (Backend & Frontend Platform Owner)
- **Sprint Duration:** Phase 2 (Local Development focus)
- **Tech Stack:** FastAPI, Next.js, Tailwind CSS, Leaflet (OpenStreetMap), PostgreSQL + PostGIS (Docker)

---

## 1. Architectural Decisions

### A. Image Storage & Handling
- **Decision:** Use a shared relative folder (`backend/static/uploads/`). The AI pipeline / image upload endpoint will write images directly into this directory, and the FastAPI backend will serve them statically under `/static/uploads/`.
- **Rationale:** Simplifies local configuration since both frontend, backend, and AI service/stub run locally.

### B. Next.js Architecture
- **Decision:** Use Next.js App Router (JavaScript version) with Tailwind CSS. Disable SSR for the Leaflet MapComponent dynamically using `next/dynamic` to avoid `window is not defined` hydration errors.

### C. CI/CD Linting & Formatting
- **Decision:** Use `ruff` to perform rapid lint checks and code formatting verification in our GitHub Actions pipeline, avoiding slow multiple package dependencies.

### D. Database Schema & Mapping (PostGIS Upgrade)
- **Decision:** Upgrade plain PostgreSQL running in Docker (container name: `roadsense-db`) to PostGIS using the `postgis/postgis:15-3.4` image. Store GPS coordinates in a spatial geometry column `geometry(Point, 4326)` with a GiST index on the `reports` table. Use Alembic for database migrations.
- **Rationale:** Enables real spatial clustering (`ST_DWithin`) to support duplicate report verification (<20m radius) on the backend.

### E. AI Inference Integration (Contract v2)
- **Decision:** Introduce a decoupled, stateless AI inference HTTP service exposing `POST /infer` (multipart/form-data) on port 8001. Person B implements a local stub service `backend/stub_infer.py` to allow parallel, unblocked development. Switching between the stub and the real AI service is done via the `INFERENCE_URL` environment variable.
- **Rationale:** Prevents runtime coupling and blocking dependencies between Person A (AI) and Person B (Platform).

---

## 2. Phase 2 Progress Summary

| Phase / Task | Task Description | Status | Notes |
|---|---|---|---|
| **B-0** | Build the stub inference service (`backend/stub_infer.py`) | Completed | Port 8001, serves `POST /infer` with dynamic image sizes. |
| **B-1** | Real upload flow (`POST /detect-image` & Next.js integration) | Completed | Saves image, calls `INFERENCE_URL` asynchronously, triggers sliding toasts. |
| **B-2** | PostGIS + real duplicate verification (`POST /verify`) | Completed | `ST_DWithin` spatial clustering of mixed classes within 20m, map confirmation badges. |
| **B-3** | Repair workflow (`POST /repair` + status updates + audit log) | Completed | Issue status transitions, rich audit logs, map popup dropdowns, and status filtering. |
| **B-4** | Auth & Roles (JWT, bcrypt/argon2, role-based dependencies) | Completed | JWT cookies, bcrypt hashing, role checks, glassmorphic login page with presets. |
| **B-5** | Dashboards (Authority, Fleet, Admin views & charts) | Planned | Analytics feeds, user/model management. |
| **B-6** | Production hardening (S3/MinIO, Redis, marker local pinning) | Planned | Caching `/map`, pagination, pagination on `/reports`. |

---

## 3. Active Technical Notes
- **Local DB Credentials:** Host: `localhost`, Port: `5432`, DB: `roadsense`, User: `postgres`, Pass: `postgres`
- **FastAPI Port:** `http://localhost:8000`
- **Stub Inference Port:** `http://localhost:8001`
- **Next.js Port:** `http://localhost:3000`

## 4. Verification & Testing Status
- **Automated Tests:** 15 automated tests in `backend/test_api.py`, `backend/test_detect_image.py`, `backend/test_stub.py`, `backend/test_repair.py`, and `backend/test_auth.py` covering auth limits, state workflows, stub inference, upload pipelines, and spatial clustering are **PASSING**.


