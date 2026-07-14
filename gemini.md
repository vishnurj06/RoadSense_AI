# RoadSense AI — Continuous Memory and Context Log

This file tracks the project state, architectural decisions, completed tasks, and verification statuses for the RoadSense AI Platform (Backend & Frontend) sprint.

## Project Metadata
- **Project Name:** RoadSense AI (Platform)
- **Role:** Person B (Backend & Frontend Platform Owner)
- **Sprint Duration:** 2 Days (Local Development focus)
- **Tech Stack:** FastAPI, Next.js, Tailwind CSS, Leaflet (OpenStreetMap), PostgreSQL (Docker)

---

## 1. Architectural Decisions

### A. Image Storage & Handling
- **Decision:** Use a shared relative folder (`backend/static/uploads/`). The AI pipeline script will write images directly into this directory, and the FastAPI backend will serve them statically under `/static/uploads/`.
- **Rationale:** Simplifies local configuration for a 2-day build since both frontend, backend, and AI pipeline run on the same machine.

### B. Next.js Architecture
- **Decision:** Use Next.js App Router (JavaScript version) with Tailwind CSS. Disable SSR for the Leaflet MapComponent dynamically using `next/dynamic` to avoid `window is not defined` hydration errors.

### C. CI/CD Linting & Formatting
- **Decision:** Use `ruff` to perform rapid lint checks and code formatting verification in our GitHub Actions pipeline, avoiding slow multiple package dependencies.

### D. Database Schema & Mapping
- **Decision:** Use plain PostgreSQL running in Docker (container name: `roadsense-db`). Skip PostGIS setup to avoid setup overhead during the 2-day sprint. Store GPS coordinates as separate `latitude` and `longitude` numeric columns.
- **Rationale:** Sufficient for faking GPS jitter, storing/retrieving reports, and generating GeoJSON on the `/map` endpoint. Simple distance duplicate checking can be stubbed in python if needed.

---

## 2. Sprint Progress Summary

| Phase / Hour | Task | Status | Notes |
|---|---|---|---|
| **Day 1: Hour 0-0.5** | Initialize workspace, establish JSON contract | Completed | Created `gemini.md`, `task.md`, Docker compose, and `/fixtures` mock data. |
| **Day 1: Hour 0.5-4** | FastAPI scaffold, Docker Postgres, Next.js Leaflet scaffold | Completed | Database models, schemas, and endpoints (/detect, /reports, /map, /upload, /analytics) are fully functional. Next.js Leaflet map pins are active. |
| **Day 1: Hour 4-4.5** | Integration Sync with Person A | Ready for Sync | Endpoint `/detect` is ready to ingest Person A's real model JSON payload. |
| **Day 1: Hour 4.5-8** | Polish Map Popups, filters, upload endpoint, CI workflow | Completed | Implemented custom severity pin SVGs, detailed popups, filters, upload button, and GitHub Actions workflow (.github/workflows/ci.yml). |
| **Day 2: Hour 0-3** | Add report list table, loading states | Completed | Sidebar report log table, live stats, filters, and loading states are integrated in page.js. |
| **Day 2: Hour 3-3.5** | End-to-end dry run on video batch | Not Started | Ready for sync payload. |
| **Day 2: Hour 3.5-6** | Bug-fixing buffer | Not Started | |
| **Day 2: Hour 6-8** | Demo narrative & rehearsal | Not Started | |

---

## 3. Active Technical Notes
- **Local DB Credentials:** Host: `localhost`, Port: `5432`, DB: `roadsense`, User: `postgres`, Pass: `postgres`
- **FastAPI Port:** `http://localhost:8000` (Running in background, Task ID: `task-126`)
- **Next.js Port:** `http://localhost:3000` (Running in background, Task ID: `task-132`)

## 4. Verification & Testing Status
- **Automated Tests:** `backend/test_api.py` contains 4 pytest tests covering database inserts, GET endpoints, GeoJSON formatting, and file uploads. Status: **PASSING (4/4)**.
- **Lint Check:** Ruff lint checks. Status: **PASSING (All checks passed)**.
- **Format Check:** Ruff format checks. Status: **PASSING (6 files formatted)**.
