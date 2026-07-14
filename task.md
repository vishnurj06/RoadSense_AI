# RoadSense AI — Phase 2 MVP Sprint Checklist (Person B: Platform)

## B-0: Stub Inference Service
- [x] Write `backend/stub_infer.py`: a tiny FastAPI app on port 8001.
  - [x] Expose `POST /infer` endpoint accepting `multipart/form-data` with `file`.
  - [x] Implement random/plausible contract-v2-shaped responses (random class, conf, bbox, severity, empty lists).
  - [x] Return standard error codes on invalid requests (e.g. 400 for non-image, 413 for size > 10MB).
  - [x] Expose `GET /health` endpoint returning model loaded status.
- [x] Configure `INFERENCE_URL` in the backend config (defaulting to port 8001).
- [x] Add the stub service to `docker-compose.yml`.
- [x] Verify using `curl` that it behaves exactly per Contract v2 rules.


## B-1: Make Upload Flow Real
- [ ] Implement `POST /detect-image` in FastAPI:
  - [ ] Accept `multipart/form-data` image file.
  - [ ] Save the file to `/static/uploads`.
  - [ ] Send request to `INFERENCE_URL` with image.
  - [ ] Persist detections + model_version if returned.
  - [ ] Return the created report response.
- [ ] Integrate with Next.js frontend:
  - [ ] Modify `handleImageUpload` to call `/detect-image`.
  - [ ] Remove hardcoded mock detections in frontend.
  - [ ] Handle empty detections gracefully in the UI (e.g., "no hazards found" message, no pin dropped).
  - [ ] Display `model_version` in the report detail view.
- [ ] Verify the upload flow: a non-road image yields no pothole pin.

## B-2: PostGIS + Real Duplicate Verification
- [ ] Upgrade Docker PostgreSQL to PostGIS (`postgis/postgis:15-3.4`).
- [ ] Add Alembic for migrations:
  - [ ] Initialize Alembic in `backend/`.
  - [ ] Add geometry column `geometry(Point, 4326)` to `reports`.
  - [ ] Add GiST index on the geometry column.
- [ ] Implement `issues` table:
  - [ ] Schema: issue ID, class, geometry, status, detection_count.
- [ ] Implement `POST /verify` (clustering logic):
  - [ ] Query nearby reports of the same class within ~20m using `ST_DWithin`.
  - [ ] Group reports into a verified `issue` and count detections.
- [ ] Update frontend map:
  - [ ] Load and plot issues instead of raw reports on the map.
  - [ ] Render a badge/indicator indicating number of reports verifying it.
- [ ] Verify clustering: ingesting 3 nearby frames yields 1 issue.

## B-3: Repair Workflow
- [ ] Add `status` field to issues: `detected` → `verified` → `assigned` → `inspection` → `repair` → `completed` → `closed`.
- [ ] Implement `POST /repair` endpoint:
  - [ ] Handle status transition and validate valid paths.
- [ ] Implement `audit_log` table:
  - [ ] Track timestamp, actor, issue_id, action, state change.
- [ ] Update frontend:
  - [ ] Render issue status badge.
  - [ ] Add dropdown/actions to advance status.
  - [ ] Add a status filter.
- [ ] Verify repair flow walks issue from end to end.

## B-4: Auth & Roles
- [ ] Implement `POST /auth/login` and `POST /auth/register` endpoints.
- [ ] Hash credentials using bcrypt/argon2.
- [ ] Implement role-based access: `authority`, `fleet`, `admin`.
- [ ] Protect mutating endpoints with FastAPI dependencies.
- [ ] Lock down CORS origins in `main.py` (remove `*`).
- [ ] Update frontend:
  - [ ] Login page & router guards.
  - [ ] Secure cookies / token handling.
- [ ] Verify that unauthenticated requests to mutating endpoints return 401.

## B-5: Dashboards
- [ ] Implement role-specific views on frontend:
  - [ ] **Authority:** analytics charts (severity over time, hotspots), pending-repair queue.
  - [ ] **Fleet:** vehicle list, vehicle health, health indicators.
  - [ ] **Admin:** user management, model-version registry, system health.
- [ ] Extend `GET /analytics` to serve required time-series data.
- [ ] Verify role routing and layout updates.

## B-6: Production Hardening
- [ ] Configure S3 (or local MinIO) for image uploads instead of local disk.
- [ ] Implement Redis cache for `/map` and `/analytics`.
- [ ] Pin Leaflet map pins locally in `/public` folder instead of loading from unpkg.
- [ ] Implement pagination on `/reports` endpoint and frontend list.
- [ ] Implement structured logging and `/health` endpoints.
- [ ] Extend CI to test and lint frontend.
- [ ] Verify dashboard load times and query scaling.
