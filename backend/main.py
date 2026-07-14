import os
import uuid
from datetime import datetime
from typing import List, Optional
import httpx
from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, status, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func, cast
from geoalchemy2 import Geography

import models
import schemas
from database import engine, get_db

INFERENCE_URL = os.getenv("INFERENCE_URL", "http://localhost:8001")


# Helper function for spatial clustering
def cluster_report_to_issue(db: Session, report: models.Report):
    if not report.detections:
        return

    primary_class = report.detections[0].class_name
    point_wkt = f"POINT({report.longitude} {report.latitude})"

    # Find matching issue within 20m of the same class
    matching_issue = (
        db.query(models.Issue)
        .filter(models.Issue.class_name == primary_class)
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

        # Update image_url if new report has high confidence
        max_report_conf = (
            max([d.confidence for d in report.detections]) if report.detections else 0.0
        )
        if max_report_conf > 0.75 or not matching_issue.image_url:
            matching_issue.image_url = report.image_url
    else:
        # Create a new issue
        report_severities = [d.severity for d in report.detections]
        report_max_severity = "low"
        if "high" in report_severities:
            report_max_severity = "high"
        elif "medium" in report_severities:
            report_max_severity = "medium"

        new_issue = models.Issue(
            id=str(uuid.uuid4()),
            class_name=primary_class,
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
    allow_origins=["*"],  # For local PoC, allow all origins
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


@app.get("/")
def read_root():
    return {
        "message": "Welcome to the RoadSense AI API. Refer to /docs for API documentation."
    }


@app.post(
    "/detect",
    response_model=schemas.ReportResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_report(payload: schemas.ReportCreate, db: Session = Depends(get_db)):
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
        db.add(db_detection)

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
):
    # 1. Validate image format
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_image: Uploaded file is not an image.",
        )

    # 2. Save file with UUID prepended to prevent overwrites
    unique_filename = f"{uuid.uuid4()}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)

    try:
        contents = await file.read()
        file_size = len(contents)
        # Check size (max 10MB)
        if file_size > 10 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="image_too_large: Image exceeds 10 MB limit.",
            )

        with open(file_path, "wb") as buffer:
            buffer.write(contents)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save uploaded file: {e}",
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
        image_url=f"/static/uploads/{unique_filename}",
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
        db.add(db_detection)

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

    return db_report


@app.get("/reports", response_model=List[schemas.ReportResponse])
def get_reports(db: Session = Depends(get_db)):
    reports = db.query(models.Report).order_by(models.Report.timestamp.desc()).all()
    return reports


@app.get("/map")
def get_map_geojson(db: Session = Depends(get_db)):
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
                "coordinates": [issue.longitude, issue.latitude],  # GeoJSON is [lon, lat]
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
                "detections": detections_list,
            },
        }
        features.append(feature)

    return {"type": "FeatureCollection", "features": features}


@app.post("/verify")
def verify_reports(db: Session = Depends(get_db)):
    unclustered_reports = (
        db.query(models.Report).filter(models.Report.issue_id == None).all()
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
    return {"message": f"Clustered {count} reports successfully."}


@app.post("/upload")
def upload_image(file: UploadFile = File(...)):
    # Generate unique filename to avoid overwrites
    file_ext = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)

    try:
        with open(file_path, "wb") as buffer:
            buffer.write(file.file.read())
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save uploaded file: {e}",
        )

    # Return relative web accessible path
    return {"image_url": f"/static/uploads/{unique_filename}"}


@app.get("/analytics")
def get_analytics(db: Session = Depends(get_db)):
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

    return {
        "total_reports": reports_count,
        "total_detections": len(detections),
        "severity_distribution": severity_counts,
        "class_distribution": class_counts,
    }
