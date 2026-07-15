import os
import sys
import uuid
from datetime import datetime
from typing import List, Optional
import httpx
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    File,
    UploadFile,
    status,
    Form,
    Response,
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

INFERENCE_URL = os.getenv("INFERENCE_URL", "http://localhost:8001")

# Redis Caching Config
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
redis_client = None
try:
    import redis
    import json

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
s3_storage.init_s3_bucket()


# Helper function for spatial clustering
def cluster_report_to_issue(db: Session, report: models.Report):
    if not report.detections:
        return

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
            created_at=report.timestamp,
            updated_at=report.timestamp,
        )
        db.add(new_issue)
        db.flush()
        report.issue_id = new_issue.id


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
    payload: schemas.UserLogin, response: Response, db: Session = Depends(get_db)
):
    user = (
        db.query(models.User).filter(models.User.username == payload.username).first()
    )
    if not user or not auth.verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

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


@app.post(
    "/detect",
    response_model=schemas.ReportResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_report(
    payload: schemas.ReportCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["fleet", "admin"])),
):
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
        timestamp=payload.timestamp,
        latitude=payload.gps.lat,
        longitude=payload.gps.lon,
        geom=f"POINT({payload.gps.lon} {payload.gps.lat})",
        image_url=payload.image_url,
        speed_kmph=payload.speed_kmph,
        model_version=payload.model_version,
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
        cluster_report_to_issue(db, db_report)
        db.commit()
        db.refresh(db_report)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database insertion failed: {e}",
        )

    clear_all_caches()

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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["fleet", "admin"])),
):
    # 1. Validate image format
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_image: Uploaded file is not an image.",
        )

    # 2. Save file with UUID prepended to prevent overwrites, upload to S3
    unique_filename = f"{uuid.uuid4()}_{file.filename}"

    try:
        contents = await file.read()
        file_size = len(contents)
        # Check size (max 10MB)
        if file_size > 10 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="image_too_large: Image exceeds 10 MB limit.",
            )

        # Upload bytes directly to S3/MinIO
        s3_image_url = s3_storage.upload_image_bytes_to_s3(
            contents=contents,
            filename=unique_filename,
            content_type=file.content_type,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload image file to S3: {e}",
        )

    # 3. Call INFERENCE_URL/infer using httpx
    async with httpx.AsyncClient() as client:
        try:
            files = {"file": (file.filename, contents, file.content_type)}
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

    # 4. Insert Report
    report_id = str(uuid.uuid4())
    db_report = models.Report(
        id=report_id,
        vehicle_id=vehicle_id,
        timestamp=datetime.now(),
        latitude=latitude,
        longitude=longitude,
        geom=f"POINT({longitude} {latitude})",
        speed_kmph=speed_kmph,
        model_version=inference_data.get("model_version"),
        image_url=s3_image_url,
    )
    db.add(db_report)

    # 5. Insert associated Detections
    for det in inference_data.get("detections", []):
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
        cluster_report_to_issue(db, db_report)
        db.commit()
        db.refresh(db_report)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database insertion failed: {e}",
        )

    clear_all_caches()

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

    features = []
    for issue in issues:
        # Get detections from the latest associated report to display
        latest_report = (
            db.query(models.Report)
            .filter(models.Report.issue_id == issue.id)
            .order_by(models.Report.timestamp.desc())
            .first()
        )

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
                "timestamp": issue.updated_at.isoformat(),
                "vehicle_id": f"Clustered ({issue.detection_count} reports)",
                "speed_kmph": latest_report.speed_kmph if latest_report else None,
                "model_version": latest_report.model_version if latest_report else None,
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
    for r in unclustered_reports:
        cluster_report_to_issue(db, r)
        count += 1
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Verification clustering failed: {e}",
        )
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

    file_ext = os.path.splitext(file.filename)[1]
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


@app.get("/analytics")
def get_analytics(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    from datetime import timedelta

    # --- Redis Cache Read ---
    cache_key = "cache_analytics"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    reports_count = db.query(models.Report).count()
    detections = db.query(models.Detection).all()

    # Calculate severity and class counts
    severity_counts = {"high": 0, "medium": 0, "low": 0}
    class_counts = {}

    for d in detections:
        sev = d.severity.lower()
        if sev in severity_counts:
            severity_counts[sev] += 1

        cls = d.class_name.lower()
        class_counts[cls] = class_counts.get(cls, 0) + 1

    # Time series of past 7 days (by report date)
    today = datetime.utcnow().date()
    time_series = []
    for i in range(6, -1, -1):
        target_date = today - timedelta(days=i)
        day_start = datetime.combine(target_date, datetime.min.time())
        day_end = datetime.combine(target_date, datetime.max.time())

        reports_on_day = (
            db.query(models.Report)
            .filter(
                models.Report.timestamp >= day_start,
                models.Report.timestamp <= day_end,
            )
            .all()
        )

        day_counts = {
            "date": target_date.strftime("%b %d"),
            "high": 0,
            "medium": 0,
            "low": 0,
            "total": 0,
        }
        for r in reports_on_day:
            for d in r.detections:
                sev = d.severity.lower()
                if sev in day_counts:
                    day_counts[sev] += 1
                    day_counts["total"] += 1
        time_series.append(day_counts)

    result = {
        "total_reports": reports_count,
        "total_detections": len(detections),
        "severity_distribution": severity_counts,
        "class_distribution": class_counts,
        "time_series": time_series,
    }
    # --- Redis Cache Write (TTL: 5 minutes) ---
    set_cache(cache_key, result, expire=300)
    return result


@app.get("/admin/users", response_model=List[schemas.UserResponse])
def list_admin_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["admin"])),
):
    return db.query(models.User).order_by(models.User.username.asc()).all()


@app.get("/admin/system-health")
def get_system_health(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.RoleChecker(["admin"])),
):
    # Simulated system stats for local dashboard demo
    return {
        "cpu_usage_pct": 34.5,
        "memory_usage_pct": 58.2,
        "db_active_connections": 4,
        "db_max_connections": 20,
        "stub_inference_latency_ms": 15,
        "stub_inference_status": "ok",
        "disk_used_mb": 4.2,
        "disk_total_mb": 10240,
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


# Status transition rules
VALID_TRANSITIONS = {
    "detected": {"verified", "closed"},
    "verified": {"assigned", "closed"},
    "assigned": {"inspection", "repair", "verified"},
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
