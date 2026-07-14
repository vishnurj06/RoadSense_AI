import os
import uuid
from typing import List
from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

import models
import schemas
from database import engine, get_db

# Initialize database tables
try:
    models.Base.metadata.create_all(bind=engine)
except Exception as e:
    print(f"Warning: Database tables could not be initialized automatically: {e}")

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
        image_url=payload.image_url,
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
    reports = db.query(models.Report).all()

    features = []
    for r in reports:
        # Get severity levels of all detections in this report
        severities = [d.severity for d in r.detections]

        # Determine maximum severity (High > Medium > Low)
        max_severity = "low"
        if "high" in severities:
            max_severity = "high"
        elif "medium" in severities:
            max_severity = "medium"

        detections_list = []
        for d in r.detections:
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
                "coordinates": [r.longitude, r.latitude],  # GeoJSON is [lon, lat]
            },
            "properties": {
                "report_id": r.id,
                "vehicle_id": r.vehicle_id,
                "timestamp": r.timestamp.isoformat(),
                "image_url": r.image_url,
                "max_severity": max_severity,
                "detections": detections_list,
            },
        }
        features.append(feature)

    return {"type": "FeatureCollection", "features": features}


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
