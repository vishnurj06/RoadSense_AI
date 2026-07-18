import os
import sys
import uuid
from datetime import datetime, timezone
from typing import List, Optional
import httpx
import math
import psutil
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    File,
    UploadFile,
    status,
    Form,
    Request,
    Response,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, inspect, text
from geoalchemy2 import Geography

import models
import schemas
from database import get_db, SessionLocal, engine
import auth
import s3_storage
from routers import fleet, notifications, admin, analytics
import notification_service
import model_registry
import rate_limit
import privacy
from enrichment import enrich_report

INFERENCE_URL = os.getenv("INFERENCE_URL", "http://localhost:8001")

# Redis Caching Config
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
redis_client = None
try:
    import redis

    redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    redis_client.ping()
    print("Connected to Redis successfully.", flush=True)
except Exception as e:
    print(
        f"Warning: Redis cache not available: {e}. Servicing requests live.", flush=True
    )
    redis_client = None


def get_cache(key: str):
    if not redis_client:
        return None
    try:
        data = redis_client.get(key)
        if data:
            import json

            return json.loads(data)
    except Exception as e:
        print(f"Redis get error: {e}", flush=True)
    return None


def set_cache(key: str, value: dict, expire: int = 300):
    if not redis_client:
        return
    try:
        import json

        redis_client.set(key, json.dumps(value), ex=expire)
    except Exception as e:
        print(f"Redis set error: {e}", flush=True)


def invalidate_cache(key: str):
    if not redis_client:
        return
    try:
        redis_client.delete(key)
    except Exception as e:
        print(f"Redis delete error: {e}", flush=True)


def clear_all_caches():
    invalidate_cache("cache_map_geojson")
    invalidate_cache("cache_analytics")


def seed_users():
    # Skip seeding during automated testing
    if "pytest" in sys.modules or os.getenv("TESTING") == "1":
        return

    db = SessionLocal()
    try:
        inspector = inspect(engine)
        if inspector.has_table("users"):
            default_users = [
                {"username": "admin", "role": "admin"},
                {"username": "officer", "role": "authority"},
                {"username": "driver", "role": "fleet"},
            ]
            seeded = False
            for u in default_users:
                existing = (
                    db.query(models.User)
                    .filter(models.User.username == u["username"])
                    .first()
                )
                if not existing:
                    print(f"Seeding default user: {u['username']}...", flush=True)
                    user = models.User(
                        username=u["username"],
                        hashed_password=auth.hash_password("password"),
                        role=u["role"],
                    )
                    db.add(user)
                    seeded = True
            if seeded:
                db.commit()
                print("Default users seeding completed.", flush=True)
    except Exception as e:
        print(f"Error seeding default users: {e}", flush=True)
        db.rollback()
    finally:
        db.close()


seed_users()
# B3-4: populate the model registry from Person A's ai/models.json (A3-7) so a
# fresh install shows real versions. Best-effort — never blocks startup.
model_registry.seed_model_registry()
s3_storage.init_s3_bucket()


# Helper function for spatial clustering
def cluster_report_to_issue(
    db: Session, report: models.Report
) -> "models.Issue | None":
    """Cluster *report* into an existing Issue or create a new one.

    Returns the newly-created Issue if one was created, or None if the report
    was merged into an existing Issue.  Callers use the return value to decide
    whether to fire high-severity notifications.
    """
    if not report.detections:
        return None

    primary_class = report.detections[0].class_name
    point_wkt = f"POINT({report.longitude} {report.latitude})"

    # Find matching issue within 20m (regardless of class)
    matching_issue = (
        db.query(models.Issue)
        .filter(
            func.ST_DWithin(
                cast(models.Issue.geom, Geography),
                cast(func.ST_GeomFromText(point_wkt, 4326), Geography),
                20.0,
            )
        )
        .order_by(
            func.ST_Distance(
                cast(models.Issue.geom, Geography),
                cast(func.ST_GeomFromText(point_wkt, 4326), Geography),
            )
        )
        .first()
    )

    if matching_issue:
        # Associate report with the existing issue
        report.issue_id = matching_issue.id
        matching_issue.detection_count += 1
        matching_issue.updated_at = datetime.utcnow()

        # code item #1 — verification threshold: an Issue becomes "verified" only
        # once >=2 DISTINCT vehicles have reported it (detection_count counts
        # reports, which one circling vehicle could inflate on its own). Only
        # non-empty vehicle_ids count, so anonymous/demo uploads never self-verify.
        seen_vehicles = {
            v
            for (v,) in db.query(models.Report.vehicle_id)
            .filter(models.Report.issue_id == matching_issue.id)
            .distinct()
            if v
        }
        if report.vehicle_id:
            seen_vehicles.add(report.vehicle_id)
        if len(seen_vehicles) >= 2:
            matching_issue.is_verified = True

        # Update severity to maximum
        severity_priority = {"low": 1, "medium": 2, "high": 3}
        current_priority = severity_priority.get(matching_issue.severity, 0)

        report_severities = [d.severity for d in report.detections]
        report_max_severity = "low"
        if "high" in report_severities:
            report_max_severity = "high"
        elif "medium" in report_severities:
            report_max_severity = "medium"

        report_priority = severity_priority.get(report_max_severity, 0)
        if report_priority > current_priority:
            matching_issue.severity = report_max_severity

        # Update class_name and image_url if new report has higher confidence
        max_report_conf = 0.0
        best_report_class = primary_class
        for d in report.detections:
            if d.confidence > max_report_conf:
                max_report_conf = d.confidence
                best_report_class = d.class_name

        # Query highest confidence among existing reports of this issue
        existing_max_conf = (
            db.query(func.max(models.Detection.confidence))
            .join(models.Report, models.Report.id == models.Detection.report_id)
            .filter(models.Report.issue_id == matching_issue.id)
            .scalar()
            or 0.0
        )

        if max_report_conf > existing_max_conf:
            matching_issue.class_name = best_report_class
            if report.image_url:
                matching_issue.image_url = report.image_url
        elif not matching_issue.image_url and report.image_url:
            matching_issue.image_url = report.image_url

        return None  # merged into existing issue; no notification needed
    else:
        # Create a new issue
        report_severities = [d.severity for d in report.detections]
        report_max_severity = "low"
        if "high" in report_severities:
            report_max_severity = "high"
        elif "medium" in report_severities:
            report_max_severity = "medium"

        # Determine best class of new issue
        max_report_conf = 0.0
        best_report_class = primary_class
        for d in report.detections:
            if d.confidence > max_report_conf:
                max_report_conf = d.confidence
                best_report_class = d.class_name

        new_issue = models.Issue(
            id=str(uuid.uuid4()),
            class_name=best_report_class,
            status="detected",
            severity=report_max_severity,
            image_url=report.image_url,
            latitude=report.latitude,
            longitude=report.longitude,
            geom=f"POINT({report.longitude} {report.latitude})",
            detection_count=1,
            is_verified=False,  # a single vehicle's first sighting is unverified
            created_at=report.timestamp,
            updated_at=report.timestamp,
        )
        db.add(new_issue)
        db.flush()
        report.issue_id = new_issue.id
        return new_issue  # caller should trigger notifications if high severity


# Note: We commented out models.Base.metadata.create_all(bind=engine)
# to ensure we rely purely on Alembic migrations in production/docker.
# But for tests, we will keep setup_db dropping and recreating them.
# The endpoint startup won't create tables automatically now.


app = FastAPI(title="RoadSense AI API", version="1.0.0")

# Enable CORS for the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure static directories exist and mount them
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount(
    "/static",
    StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")),
    name="static",
)

# ── Routers ─────────────────────────────────────────────────────────────────────────────────
app.include_router(fleet.router)
app.include_router(notifications.router)
app.include_router(admin.router)
app.include_router(analytics.router)


def get_active_model_version(db: Session) -> str | None:
    """Return the version string of the currently active registered model.

    Used as a fallback in /detect-image when the inference response doesn't
    carry a model_version field (e.g. the stub, or an older infer_service).
    Returns None if the registry is empty (no models registered yet).
    """
    active = db.query(models.AIModel).filter(models.AIModel.is_active.is_(True)).first()
    return active.version if active else None


@app.post(
    "/auth/register",
    response_model=schemas.UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_user(payload: schemas.UserRegister, db: Session = Depends(get_db)):
    existing = (
        db.query(models.User).filter(models.User.username == payload.username).first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered.",
        )

    db_user = models.User(
        username=payload.username,
        hashed_password=auth.hash_password(payload.password),
        role=payload.role,
    )
    db.add(db_user)
    try:
        db.commit()
        db.refresh(db_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )
    return db_user


@app.post("/auth/login")
def login_user(
    payload: schemas.UserLogin,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    # B3-9: throttle brute-force. Key per-source-IP + username so a single account
    # under attack is limited without locking out a whole shared IP.
    client_ip = request.client.host if request.client else "unknown"
    rl_key = f"{client_ip}:{payload.username}"

    if rate_limit.is_rate_limited(rl_key, redis_client):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please try again later.",
            headers={
                "Retry-After": str(
                    rate_limit.retry_after_seconds(rl_key, redis_client)
                    or rate_limit.WINDOW_SECONDS
                )
            },
        )

    user = (
        db.query(models.User).filter(models.User.username == payload.username).first()
    )
    if not user or not auth.verify_password(payload.password, user.hashed_password):
        rate_limit.record_failure(rl_key, redis_client)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Successful auth clears the counter for this key.
    rate_limit.reset(rl_key, redis_client)
    token = auth.create_access_token(data={"sub": user.username})

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=3600,
    )

    return {
        "user": {"id": user.id, "username": user.username, "role": user.role},
        "token": token,
    }


@app.post("/auth/logout")
def logout_user(response: Response):
    response.delete_cookie("access_token")
    return {"message": "Logged out successfully."}


@app.get("/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@app.get("/")
def read_root():
    return {
        "message": "Welcome to the RoadSense AI API. Refer to /docs for API documentation."
    }


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    status_checks = {
        "status": "healthy",
        "database": "unhealthy",
        "cache": "unhealthy",
    }

    try:
        db.execute(text("SELECT 1"))
        status_checks["database"] = "healthy"
    except Exception as e:
        status_checks["status"] = "unhealthy"
        status_checks["database"] = f"unhealthy: {e}"

    if redis_client:
        try:
            redis_client.ping()
            status_checks["cache"] = "healthy"
        except Exception as e:
            status_checks["cache"] = f"unhealthy: {e}"
    else:
        status_checks["cache"] = "disabled"

    if status_checks["status"] == "unhealthy":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=status_checks,
        )
    return status_checks


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0  # Earth radius in kilometers
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = (
        math.sin(dLat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dLon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def to_naive_utc(dt: datetime) -> datetime:
    """Coerce *dt* to naive UTC — the storage convention across this schema.

    Contract-v2 timestamps arrive tz-aware (e.g. '+05:30'), but the DateTime
    columns are naive and the rest of the code compares against naive utcnow().
    An aware value is converted to UTC then stripped; a naive value is assumed
    already-UTC and returned unchanged. Without this, the teleportation guard
    500s on the SECOND report from any vehicle (aware − naive subtraction), and
    reports from different offsets would sit on different clocks — the exact
    class of skew that disabled the guard in S5-13/§5f (see also G-15).
    """
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def validate_gps_and_teleportation(
    db: Session, vehicle_id: str, lat: float, lon: float, timestamp: datetime
):
    # Bounds Check
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Out-of-bounds GPS coordinates.",
        )
    # Null Island Check
    if lat == 0.0 and lon == 0.0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Null Island (0,0) is not allowed.",
        )

    # Teleportation Check
    last_report = (
        db.query(models.Report)
        .filter(models.Report.vehicle_id == vehicle_id)
        .order_by(models.Report.timestamp.desc())
        .first()
    )
    if last_report:
        # Normalise both sides to naive UTC before subtracting (see to_naive_utc).
        time_diff_hours = (
            abs(
                (
                    to_naive_utc(timestamp) - to_naive_utc(last_report.timestamp)
                ).total_seconds()
            )
            / 3600.0
        )
        if time_diff_hours > 0:
            distance_km = haversine(
                last_report.latitude, last_report.longitude, lat, lon
            )
            speed_kmh = distance_km / time_diff_hours
            if speed_kmh > 300.0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Teleportation detected: Implied speed {speed_kmh:.1f} km/h exceeds 300 km/h limit.",
                )


@app.post(
    "/detect",
    response_model=schemas.ReportResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_report(
    payload: schemas.ReportCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["fleet", "admin"])),
):
    # 0. Validate GPS and Teleportation
    validate_gps_and_teleportation(
        db, payload.vehicle_id, payload.gps.lat, payload.gps.lon, payload.timestamp
    )

    # 1. Determine Report ID
    report_id = payload.report_id or str(uuid.uuid4())

    # 2. Check if report already exists (to support re-running/idempotency)
    existing_report = (
        db.query(models.Report).filter(models.Report.id == report_id).first()
    )
    if existing_report:
        # Delete existing report and its detections to overwrite
        db.delete(existing_report)
        db.commit()

    # 3. Create new Report record
    db_report = models.Report(
        id=report_id,
        vehicle_id=payload.vehicle_id,
        # Store naive UTC so all reports share one clock (see to_naive_utc).
        timestamp=to_naive_utc(payload.timestamp),
        latitude=payload.gps.lat,
        longitude=payload.gps.lon,
        geom=f"POINT({payload.gps.lon} {payload.gps.lat})",
        image_url=payload.image_url,
        speed_kmph=payload.speed_kmph,
        model_version=payload.model_version,
        gps_source=payload.gps_source,
    )
    db.add(db_report)

    # 4. Add associated detections
    for det in payload.detections:
        db_detection = models.Detection(
            id=str(uuid.uuid4()),
            report_id=report_id,
            class_name=det.class_name,
            confidence=det.confidence,
            bbox=det.bbox,
            severity=det.severity,
        )
        db_report.detections.append(db_detection)

    try:
        db.flush()
        new_issue = cluster_report_to_issue(db, db_report)
        db.commit()
        db.refresh(db_report)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database insertion failed: {e}",
        )

    # B3-2: fire notification for new high-severity issues (non-blocking)
    if new_issue and new_issue.severity == "high":
        notification_service.trigger_high_severity_notification(
            new_issue, db, redis_client
        )
        db.commit()  # persist in-app notification rows

    clear_all_caches()

    # B3-1: Update vehicle last_seen so camera health reflects telemetry cadence
    vehicle_rec = (
        db.query(models.Vehicle)
        .filter(models.Vehicle.plate == db_report.vehicle_id)
        .first()
    )
    if vehicle_rec:
        vehicle_rec.last_seen = db_report.timestamp
        db.commit()

    return db_report


@app.post(
    "/detect-image",
    response_model=schemas.ReportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def detect_image(
    file: UploadFile = File(...),
    latitude: float = Form(..., description="GPS latitude"),
    longitude: float = Form(..., description="GPS longitude"),
    vehicle_id: str = Form("demo-web-upload", description="Vehicle identifier"),
    speed_kmph: Optional[float] = Form(
        None, description="Optional vehicle speed in km/h"
    ),
    gps_source: str = Form("faked", description="Source of GPS"),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["fleet", "admin"])),
):
    # 1. Validate image format
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_image: Uploaded file is not an image.",
        )

    # First, read the file bytes
    image_bytes = await file.read()
    file_size = len(image_bytes)
    # Check size (max 10MB)
    if file_size > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="image_too_large: Image exceeds 10 MB limit.",
        )

    # 1.5 Validate GPS and Teleportation
    # detect_image doesn't receive a timestamp in Form, so we use utcnow
    current_time = datetime.utcnow()
    validate_gps_and_teleportation(db, vehicle_id, latitude, longitude, current_time)

    # 2. Call INFERENCE_URL/infer using httpx
    async with httpx.AsyncClient() as client:
        try:
            files = {"file": (file.filename, image_bytes, file.content_type)}
            response = await client.post(
                f"{INFERENCE_URL}/infer",
                files=files,
                data={"conf": 0.5},
                timeout=15.0,
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Inference service failed with status code {response.status_code}: {response.text}",
                )

            inference_data = response.json()
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Inference service is unreachable at {INFERENCE_URL}: {exc}",
            )

    # 3. Extract detections and rewind file pointer (CRITICAL)
    detections = inference_data.get("detections", [])
    await file.seek(0)

    # 4. Save file with UUID prepended to prevent overwrites, upload to S3
    unique_filename = f"{uuid.uuid4()}_{file.filename}"
    try:
        contents = await file.read()
        # code item #5: redact faces + plates BEFORE storage (after inference, which
        # ran on the clear image). Gated by PRIVACY_BLUR (default off) so private
        # testing is unaffected. Fail-closed — a blur error aborts the upload rather
        # than persisting un-redacted PII.
        if privacy.is_blur_enabled():
            contents = privacy.blur_faces_and_plates(
                contents,
                content_type=file.content_type,
                filename=file.filename,
            )
        # Upload bytes directly to S3/MinIO
        s3_image_url = s3_storage.upload_image_bytes_to_s3(
            contents=contents,
            filename=unique_filename,
            content_type=file.content_type,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload image file to S3: {e}",
        )

    # 5. Insert Report
    report_id = str(uuid.uuid4())
    # B3-4: resolve model_version — prefer what the inference service reports,
    # fall back to the active registry entry so the field is never NULL when a
    # model is registered.
    resolved_model_version = inference_data.get(
        "model_version"
    ) or get_active_model_version(db)

    db_report = models.Report(
        id=report_id,
        vehicle_id=vehicle_id,
        # MUST be UTC. This was datetime.now() (naive *local* time) while
        # validate_gps_and_teleportation() above compares against utcnow(), so on
        # any non-UTC server the two disagree by the TZ offset. Because that
        # delta is abs()'d into the speed denominator, it silently *disables* the
        # teleportation guard: on a UTC+5:30 box a 202 km jump reads as 37 km/h
        # and sails through. It also stored report timestamps in local time while
        # issues.updated_at is UTC — two clocks in one schema.
        timestamp=current_time,
        latitude=latitude,
        longitude=longitude,
        geom=f"POINT({longitude} {latitude})",
        speed_kmph=speed_kmph,
        model_version=resolved_model_version,
        image_url=s3_image_url,
        gps_source=gps_source,
    )

    db.add(db_report)

    # 6. Insert associated Detections
    for det in detections:
        db_detection = models.Detection(
            id=str(uuid.uuid4()),
            report_id=report_id,
            class_name=det["class"],
            confidence=det["confidence"],
            bbox=det["bbox"],
            severity=det["severity"],
        )
        db_report.detections.append(db_detection)

    try:
        db.flush()
        new_issue = cluster_report_to_issue(db, db_report)
        db.commit()
        db.refresh(db_report)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database insertion failed: {e}",
        )

    # B3-2: fire notification for new high-severity issues (non-blocking)
    if new_issue and new_issue.severity == "high":
        notification_service.trigger_high_severity_notification(
            new_issue, db, redis_client
        )
        db.commit()  # persist in-app notification rows

    clear_all_caches()

    # B3-1: Update vehicle last_seen so camera health reflects telemetry cadence
    vehicle_rec = (
        db.query(models.Vehicle).filter(models.Vehicle.plate == vehicle_id).first()
    )
    if vehicle_rec:
        vehicle_rec.last_seen = db_report.timestamp
        db.commit()

    if background_tasks:
        background_tasks.add_task(
            enrich_report,
            db_report.id,
            db_report.latitude,
            db_report.longitude,
            db_report.timestamp,
        )

    return db_report


@app.get("/reports", response_model=schemas.PaginatedReportsResponse)
def get_reports(
    page: int = 1,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if page < 1:
        page = 1
    if limit < 1:
        limit = 10
    elif limit > 100:
        limit = 100

    offset = (page - 1) * limit
    total = db.query(models.Report).count()
    reports = (
        db.query(models.Report)
        .order_by(models.Report.timestamp.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {"reports": reports, "total": total, "page": page, "limit": limit}


@app.get("/map")
def get_map_geojson(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # --- Redis Cache Read ---
    cache_key = "cache_map_geojson"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    issues = db.query(models.Issue).all()

    # ── N+1 elimination ──────────────────────────────────────────────────────
    # This loop used to fire THREE queries per issue (latest report, distinct
    # GPS sources, lazy-loaded detections). At ~9.5k issues that is ~28,500
    # round-trips and ~2.5 s per /map — slow enough that the browser choked on
    # the response and the map rendered nothing, which read as "the backend is
    # disconnected." All of it is now pre-computed in TWO queries below.
    from sqlalchemy.orm import joinedload

    reports = (
        db.query(models.Report)
        .filter(models.Report.issue_id.isnot(None))
        .options(joinedload(models.Report.detections))
        .order_by(models.Report.timestamp.desc())
        .all()
    )

    latest_by_issue = {}  # issue_id → newest Report (first seen wins: desc order)
    sources_by_issue = {}  # issue_id → set of gps_source values across the cluster
    for r in reports:
        if r.issue_id not in latest_by_issue:
            latest_by_issue[r.issue_id] = r
        sources_by_issue.setdefault(r.issue_id, set()).add(r.gps_source)

    features = []
    for issue in issues:
        latest_report = latest_by_issue.get(issue.id)

        # B3-6: an Issue clusters many Reports. Provenance must fail closed —
        # if any contributing report carries faked GPS, the pin is unverified,
        # regardless of what the latest report happens to say.
        cluster_sources = sources_by_issue.get(issue.id, set())
        if "faked" in cluster_sources or None in cluster_sources:
            issue_gps_source = "faked" if "faked" in cluster_sources else None
        else:
            issue_gps_source = latest_report.gps_source if latest_report else None

        detections_list = []
        if latest_report:
            for d in latest_report.detections:
                detections_list.append(
                    {
                        "id": d.id,
                        "class": d.class_name,
                        "confidence": d.confidence,
                        "bbox": d.bbox,
                        "severity": d.severity,
                    }
                )

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [
                    issue.longitude,
                    issue.latitude,
                ],  # GeoJSON is [lon, lat]
            },
            "properties": {
                "report_id": issue.id,  # Alias for compatibility with map component
                "issue_id": issue.id,
                "class_name": issue.class_name,
                "status": issue.status,
                "max_severity": issue.severity,
                "image_url": issue.image_url,
                "detection_count": issue.detection_count,
                # code item #1: True once >=2 distinct vehicles corroborate.
                "is_verified": issue.is_verified,
                # code item #3: urgency score 0-100 (severity + sightings + age).
                "priority": issue.priority,
                "timestamp": issue.updated_at.isoformat(),
                "vehicle_id": f"Clustered ({issue.detection_count} reports)",
                "speed_kmph": latest_report.speed_kmph if latest_report else None,
                "model_version": latest_report.model_version if latest_report else None,
                "gps_source": issue_gps_source,
                # B3-5: enrichment is written onto the Report by the background
                # task, so the map has to read it off the latest report — the
                # Issue row carries no road_name of its own.
                "road_name": latest_report.road_name if latest_report else None,
                "detections": detections_list,
            },
        }
        features.append(feature)

    result = {"type": "FeatureCollection", "features": features}
    # --- Redis Cache Write (TTL: 5 minutes) ---
    set_cache(cache_key, result, expire=300)
    return result


@app.post("/verify")
def verify_reports(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["authority", "admin"])),
):
    unclustered_reports = (
        db.query(models.Report).filter(models.Report.issue_id.is_(None)).all()
    )
    count = 0
    new_high_issues = []
    for r in unclustered_reports:
        new_issue = cluster_report_to_issue(db, r)
        count += 1
        if new_issue and new_issue.severity == "high":
            new_high_issues.append(new_issue)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Verification clustering failed: {e}",
        )
    # B3-2: notify after commit — rate-limiter in service handles bursts
    for issue in new_high_issues:
        notification_service.trigger_high_severity_notification(issue, db, redis_client)
    if new_high_issues:
        db.commit()  # persist in-app notification rows
    clear_all_caches()
    return {"message": f"Clustered {count} reports successfully."}


@app.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    current_user: models.User = Depends(auth.get_current_user),
):
    # Validate image format
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_image: Uploaded file is not an image.",
        )

    file_ext = os.path.splitext(file.filename or "")[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"

    try:
        contents = await file.read()
        s3_image_url = s3_storage.upload_image_bytes_to_s3(
            contents=contents,
            filename=unique_filename,
            content_type=file.content_type,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload file to S3: {e}",
        )

    return {"image_url": s3_image_url}


@app.get("/admin/users", response_model=List[schemas.UserResponse])
def list_admin_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["admin"])),
):
    return db.query(models.User).order_by(models.User.username.asc()).all()


@app.post(
    "/admin/users",
    response_model=schemas.UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_admin_user(
    payload: schemas.UserRegister,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["admin"])),
):
    """Admin-only user creation.

    Distinct from the public /auth/register: because it is gated to admins, a
    role (including 'admin') can only ever be granted by an existing operator —
    self-registering into a privileged role is not possible here.
    """
    existing = (
        db.query(models.User).filter(models.User.username == payload.username).first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists.",
        )
    user = models.User(
        username=payload.username,
        hashed_password=auth.hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )
    return user


@app.delete("/admin/users/{user_id}")
def delete_admin_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["admin"])),
):
    """Delete a user. Guards against self-deletion and removing the last admin so
    an operator can never lock the whole team out of the console."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account.",
        )
    if user.role == "admin":
        admin_count = db.query(models.User).filter(models.User.role == "admin").count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete the last admin.",
            )
    db.delete(user)
    db.commit()
    return {"status": "success"}


@app.post("/admin/users/{user_id}/password")
def reset_admin_user_password(
    user_id: str,
    payload: schemas.PasswordReset,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["admin"])),
):
    """Admin resets a user's password (the 'edit' action for an account)."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.hashed_password = auth.hash_password(payload.password)
    db.commit()
    return {"status": "success"}


@app.get("/admin/system-health")
def get_system_health(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["admin"])),
):
    # ── Real system metrics via psutil ─────────────────────────────────────
    cpu_pct = psutil.cpu_percent(
        interval=0.2
    )  # 200 ms sample — fast enough for a dashboard
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    # ── DB connection pool stats ────────────────────────────────────────────
    try:
        pool = engine.pool
        db_checked_out = pool.checkedout()  # connections currently in use
        db_pool_size = pool.size()  # configured pool ceiling
    except Exception:
        db_checked_out = -1
        db_pool_size = -1

    # ── Live probe of the inference service ────────────────────────────────
    inference_status = "unreachable"
    inference_latency_ms: Optional[float] = None
    try:
        t0 = datetime.utcnow()
        resp = httpx.get(f"{INFERENCE_URL}/health", timeout=2.0)
        latency = (datetime.utcnow() - t0).total_seconds() * 1000
        inference_status = (
            "ok" if resp.status_code == 200 else f"http_{resp.status_code}"
        )
        inference_latency_ms = round(latency, 1)
    except httpx.RequestError:
        pass  # leave defaults — unreachable / None

    return {
        "cpu_usage_pct": round(cpu_pct, 1),
        "memory_usage_pct": round(mem.percent, 1),
        "memory_used_mb": round(mem.used / 1024 / 1024, 1),
        "memory_total_mb": round(mem.total / 1024 / 1024, 1),
        "disk_used_gb": round(disk.used / 1024 / 1024 / 1024, 2),
        "disk_total_gb": round(disk.total / 1024 / 1024 / 1024, 2),
        "disk_usage_pct": round(disk.percent, 1),
        "db_active_connections": db_checked_out,
        "db_pool_size": db_pool_size,
        "inference_url": INFERENCE_URL,
        "inference_status": inference_status,
        "inference_latency_ms": inference_latency_ms,
    }


@app.post("/admin/users/role")
def update_user_role(
    payload: schemas.UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["admin"])),
):
    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = payload.role
    db.commit()
    return {"status": "success"}


# Status transition rules.
# NB: the workflow "approved" state was renamed from "verified" (code item #2) to
# stop it colliding with the *automatic* verification-by-sightings concept (#1).
# Existing rows are migrated by Alembic revision e5c1a2f3b6d7.
VALID_TRANSITIONS = {
    "detected": {"approved", "closed"},
    "approved": {"assigned", "closed"},
    "assigned": {"inspection", "repair", "approved"},
    "inspection": {"repair", "assigned"},
    "repair": {"completed"},
    "completed": {"closed", "repair"},
    "closed": {"detected"},
}


@app.post("/repair", response_model=schemas.IssueResponse)
def update_issue_status(
    payload: schemas.IssueStatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["authority", "admin"])),
):
    # 1. Fetch issue
    issue = db.query(models.Issue).filter(models.Issue.id == payload.issue_id).first()
    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Issue not found"
        )

    old_status = issue.status
    new_status = payload.status.lower()

    # 2. Check transition validity
    valid_next_states = VALID_TRANSITIONS.get(old_status, set())
    if new_status not in valid_next_states:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid transition: Cannot change status from '{old_status}' to '{new_status}'.",
        )

    # 3. Apply state transition
    issue.status = new_status
    issue.updated_at = datetime.utcnow()

    # 4. Write to audit log
    audit_log = models.IssueAuditLog(
        id=str(uuid.uuid4()),
        issue_id=issue.id,
        changed_by=current_user.username,
        old_status=old_status,
        new_status=new_status,
        notes=payload.notes,
        timestamp=datetime.utcnow(),
    )
    db.add(audit_log)

    try:
        db.commit()
        db.refresh(issue)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update issue status: {e}",
        )

    clear_all_caches()

    return issue


@app.get("/issues/{issue_id}/audit-log", response_model=List[schemas.AuditLogResponse])
def get_issue_audit_log(
    issue_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    issue = db.query(models.Issue).filter(models.Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Issue not found"
        )

    logs = (
        db.query(models.IssueAuditLog)
        .filter(models.IssueAuditLog.issue_id == issue_id)
        .order_by(models.IssueAuditLog.timestamp.desc())
        .all()
    )
    return logs
