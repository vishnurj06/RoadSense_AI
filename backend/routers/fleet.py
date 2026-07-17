"""
Fleet API router — B3-1
Routes: POST /fleet/vehicles · GET /fleet/vehicles · GET /fleet/vehicles/{id}/history

Role rules (from Phase 3 Workflow):
  - fleet: full read + register own vehicles
  - admin: full read + register + manage all vehicles
  - authority: read-only access to fleet summary (GET /fleet/vehicles)
"""

import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func

import models
import schemas
from database import get_db
from auth import RoleChecker

router = APIRouter(prefix="/fleet", tags=["fleet"])

# ── Camera health thresholds ──────────────────────────────────────────────────
# A camera is "online" if it sent a report within this window.
CAMERA_STALE_MINUTES = 30      # > 30 min → stale
CAMERA_OFFLINE_MINUTES = 120   # > 2 h   → offline


def _derive_camera_health(last_seen: Optional[datetime]) -> str:
    """Classify camera connectivity from the last_seen timestamp.

    Returns one of: "online" | "stale" | "offline" | "unknown"
    This computation deliberately lives here (not in the model) so that
    the threshold values can be changed without a DB migration.
    """
    if last_seen is None:
        return "unknown"
    age = datetime.utcnow() - last_seen
    if age < timedelta(minutes=CAMERA_STALE_MINUTES):
        return "online"
    if age < timedelta(minutes=CAMERA_OFFLINE_MINUTES):
        return "stale"
    return "offline"


def _enrich_vehicle(vehicle: models.Vehicle, db: Session) -> schemas.VehicleResponse:
    """Convert ORM Vehicle → VehicleResponse with derived fields computed."""
    report_count: int = (
        db.query(func.count(models.Report.id))
        .filter(models.Report.vehicle_id == vehicle.plate)
        .scalar()
        or 0
    )
    resp = schemas.VehicleResponse.model_validate(vehicle)
    resp.camera_health = _derive_camera_health(vehicle.last_seen)
    resp.report_count = report_count
    return resp


# ── POST /fleet/vehicles ──────────────────────────────────────────────────────

@router.post(
    "/vehicles",
    response_model=schemas.VehicleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new fleet vehicle",
)
def register_vehicle(
    payload: schemas.VehicleCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(RoleChecker(["fleet", "admin"])),
):
    """Register a new vehicle in the fleet registry.

    - **plate** must be unique across the entire fleet.
    - Only users with role `fleet` or `admin` may register vehicles.
    """
    existing = (
        db.query(models.Vehicle)
        .filter(models.Vehicle.plate == payload.plate.upper())
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Vehicle with plate '{payload.plate.upper()}' is already registered.",
        )

    vehicle = models.Vehicle(
        id=str(uuid.uuid4()),
        plate=payload.plate.upper(),
        model=payload.model,
        camera_id=payload.camera_id,
        status=payload.status,
        last_seen=None,
        registered_at=datetime.utcnow(),
    )
    db.add(vehicle)
    try:
        db.commit()
        db.refresh(vehicle)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register vehicle: {exc}",
        ) from exc

    return _enrich_vehicle(vehicle, db)


# ── GET /fleet/vehicles ───────────────────────────────────────────────────────

@router.get(
    "/vehicles",
    response_model=schemas.VehicleListResponse,
    summary="List all registered vehicles with live camera health",
)
def list_vehicles(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status: active | inactive | maintenance"),
    camera_health_filter: Optional[str] = Query(None, alias="camera_health", description="Filter by derived health: online | stale | offline | unknown"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(
        RoleChecker(["fleet", "admin", "authority"])
    ),
):
    """Return all registered fleet vehicles.

    Derived fields computed per-row:
    - **camera_health**: `online` / `stale` / `offline` / `unknown`
    - **report_count**: total reports submitted by this vehicle's plate

    Authority users may call this for fleet summary dashboards (read-only).
    """
    query = db.query(models.Vehicle)
    if status_filter:
        query = query.filter(models.Vehicle.status == status_filter)

    total = query.count()
    vehicles_orm = (
        query.order_by(models.Vehicle.registered_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    enriched = [_enrich_vehicle(v, db) for v in vehicles_orm]

    # Apply camera_health filter *after* derivation (it's not a DB column)
    if camera_health_filter:
        enriched = [v for v in enriched if v.camera_health == camera_health_filter]

    return schemas.VehicleListResponse(vehicles=enriched, total=total)


# ── GET /fleet/vehicles/{vehicle_id}/history ─────────────────────────────────

@router.get(
    "/vehicles/{vehicle_id}/history",
    response_model=schemas.VehicleHistoryResponse,
    summary="Get detection history for a specific vehicle",
)
def get_vehicle_history(
    vehicle_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(RoleChecker(["fleet", "admin", "authority"])),
):
    """Return paginated detection reports for a specific registered vehicle.

    The `vehicle_id` here is the UUID primary key of the Vehicle record.
    Reports are matched by `vehicle.plate == report.vehicle_id`.
    """
    vehicle = db.query(models.Vehicle).filter(models.Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Vehicle '{vehicle_id}' not found.",
        )

    reports_query = (
        db.query(models.Report)
        .filter(models.Report.vehicle_id == vehicle.plate)
        .order_by(models.Report.timestamp.desc())
    )
    total = reports_query.count()
    reports_orm = reports_query.offset((page - 1) * limit).limit(limit).all()

    # Materialise ReportResponse objects (loads detections via ORM relationship)
    report_responses = []
    for r in reports_orm:
        resp = schemas.ReportResponse(
            id=r.id,
            vehicle_id=r.vehicle_id,
            timestamp=r.timestamp,
            latitude=r.latitude,
            longitude=r.longitude,
            image_url=r.image_url,
            speed_kmph=r.speed_kmph,
            model_version=r.model_version,
            status=r.status,
            detections=[
                schemas.DetectionResponse(
                    id=d.id,
                    report_id=d.report_id,
                    **{"class": d.class_name},
                    confidence=d.confidence,
                    bbox=d.bbox,
                    severity=d.severity,
                )
                for d in r.detections
            ],
        )
        report_responses.append(resp)

    return schemas.VehicleHistoryResponse(
        vehicle_id=vehicle.id,
        plate=vehicle.plate,
        reports=report_responses,
        total=total,
    )
