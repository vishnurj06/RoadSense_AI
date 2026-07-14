# RoadSense AI — Sprint Checklist (Person B: Platform)

## Day 1 Checklist

### 1. Project Initialization & Mock Setup (Hour 0 - 0.5)
- [x] Create `gemini.md` context log.
- [x] Create `task.md` checklist.
- [x] Draft & lock JSON contract with Person A.
- [x] Create folder structure: `/backend`, `/frontend`, `/fixtures`.
- [x] Write 10 mock fixture JSON files in `/fixtures` matching the contract.

### 2. Backend & Database Skeleton (Hour 0.5 - 4)
- [x] Configure `docker-compose.yml` for PostgreSQL.
- [x] Initialize Python virtual environment / dependencies (`fastapi`, `uvicorn`, `psycopg2-binary`, `sqlalchemy`, `pydantic`).
- [x] Create database connection module & models (`Report`, `Detection`).
- [x] Implement `POST /detect` endpoint:
  - [x] Accepts JSON payload.
  - [x] Resolves local `image_url` or mock URLs.
  - [x] Inserts report and detection records.
- [x] Implement `GET /reports` endpoint (list all reports).
- [x] Implement `GET /map` endpoint (returns GeoJSON of reports for Leaflet).
- [x] Verify endpoints locally using Postman, curl, or simple Python script.

### 3. Frontend Map Dashboard Scaffold (Hour 0.5 - 4)
- [x] Initialize Next.js app in `/frontend` using Tailwind CSS.
- [x] Install and configure `leaflet` and `react-leaflet`.
- [x] Create a dashboard page layout with full-screen map.
- [x] Load and plot mock fixture reports from the backend on the Leaflet map.
- [x] Color-code map markers by severity (High = Red, Medium = Orange, Low = Green).
- [x] Verify that pins show up correctly on local Next.js server.

### 4. Integration Sync Point (Hour 4 - 4.5)
- [x] Integrate Person A's real model JSON output with `POST /detect`. (Completed successfully with Roboflow Cloud API)
- [x] Test the backend ingestion pipeline.
- [x] Resolve any mismatches in JSON structure.

### 5. Backend & Frontend Polish (Hour 4.5 - 8)
- [x] Add popup component to Leaflet pins showing:
  - [x] Image thumbnail.
  - [x] Severity badge.
  - [x] Confidence score.
  - [x] Timestamp & Vehicle ID.
- [x] Implement severity filters (toggles to show/hide Low, Medium, High).
- [x] Create the `POST /upload` endpoint for multipart image uploads.
- [x] Add basic upload UI on the dashboard to demo dropping a new image in and plotting it.
- [x] Setup GitHub Actions workflow `.github/workflows/ci.yml` for backend linting and basic checks.
- [x] Verify everything works, perform atomic git commits, and prepare for Day 2.

---

## Day 2 Checklist

### 6. Authority List View & Robustness (Hour 0 - 3)
- [x] Add side-by-side or collapsible Table List View of reports (ID, vehicle, severity, timestamp).
- [x] Add search/filter capabilities to the list view.
- [x] Implement clean loading spinners and basic error boundary handling.
- [x] Verify page loads under 2 seconds.

### 7. Pipeline Dry Run (Hour 3 - 3.5)
- [x] Feed a large batch of real detections from a processed video file.
- [x] Verify map updates and list updates smoothly without UI lag.

### 8. Bug Fixing & Polish (Hour 3.5 - 6)
- [x] Resolve memory leaks, styling glitches, or path resolution bugs.
- [x] Optimize database queries if needed.

### 9. Demo Prep & Narrative Rehearsal (Hour 6 - 8)
- [x] Review system flow and rehearse narrative structure.
- [x] Document final walkthrough.

