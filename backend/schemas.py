from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict


class GPSCoordinates(BaseModel):
    lat: float = Field(..., description="Latitude coordinate")
    lon: float = Field(..., description="Longitude coordinate")


class DetectionBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    class_name: str = Field(
        ..., alias="class", description="The hazard class (e.g. pothole, crack)"
    )
    confidence: float = Field(..., ge=0.0, le=1.0, description="Model confidence score")
    bbox: List[float] = Field(
        ..., min_length=4, max_length=4, description="Bounding box [x1, y1, x2, y2]"
    )
    severity: str = Field(..., description="Severity level: low, medium, or high")


class DetectionCreate(DetectionBase):
    pass


class DetectionResponse(DetectionBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    report_id: str


class ReportCreate(BaseModel):
    report_id: Optional[str] = Field(None, description="Optional UUID report ID")
    vehicle_id: str = Field(..., description="ID of the reporting vehicle")
    timestamp: datetime = Field(..., description="Timestamp of the detection")
    gps: GPSCoordinates = Field(..., description="GPS coordinates")
    # B3-6: default None ("unknown"), NEVER "exif". This mirrors ReportResponse
    # below — defaulting to a real source silently launders an unknown or faked
    # location into a verified-looking one, which is the exact Phase-2 failure
    # B3-6 exists to prevent. POST /detect-image already defaults to the safe
    # "faked" (main.py); this is the same rule for POST /detect.
    gps_source: Optional[str] = Field(
        None, description="Source of GPS: exif | gpx | faked. None = unknown."
    )
    detections: List[DetectionCreate] = Field(
        default=[], description="Hazards detected"
    )
    image_url: Optional[str] = Field(
        None, description="URL or relative path to the image"
    )
    speed_kmph: Optional[float] = Field(
        None, description="Speed of the vehicle in km/h"
    )
    model_version: Optional[str] = Field(
        None, description="Model version used for inference"
    )


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    vehicle_id: str
    timestamp: datetime
    latitude: float
    longitude: float
    # B3-6: no default provenance. An absent gps_source means "unknown", never
    # "exif" — defaulting to a real source silently launders faked locations
    # into verified-looking ones.
    gps_source: Optional[str] = None
    road_name: Optional[str] = None
    weather: Optional[dict] = None
    image_url: Optional[str]
    speed_kmph: Optional[float]
    model_version: Optional[str]
    status: Optional[str] = "detected"
    detections: List[DetectionResponse] = []


class PaginatedReportsResponse(BaseModel):
    reports: List[ReportResponse]
    total: int
    page: int
    limit: int


class IssueStatusUpdate(BaseModel):
    issue_id: str = Field(..., description="ID of the issue to update")
    status: str = Field(..., description="Target status for transition")
    notes: Optional[str] = Field(
        None, description="Optional text comment explaining the update"
    )


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    issue_id: str
    changed_by: str
    old_status: str
    new_status: str
    notes: Optional[str]
    timestamp: datetime


class IssueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    class_name: str
    status: str
    severity: str
    image_url: Optional[str]
    latitude: float
    longitude: float
    detection_count: int
    is_verified: bool
    priority: int
    created_at: datetime
    updated_at: datetime


class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    role: str = Field(..., pattern="^(admin|authority|fleet)$")


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    role: str
    created_at: datetime


class UserRoleUpdate(BaseModel):
    user_id: str
    role: str = Field(..., pattern="^(admin|authority|fleet)$")


class PasswordReset(BaseModel):
    password: str = Field(..., min_length=6)


# ── Vehicle schemas (B3-1) ─────────────────────────────────────────────────


class VehicleCreate(BaseModel):
    """Payload for POST /fleet/vehicles."""

    plate: str = Field(
        ..., min_length=1, max_length=20, description="Vehicle registration plate"
    )
    model: Optional[str] = Field(
        None, max_length=100, description="Vehicle model, e.g. Toyota HiAce"
    )
    camera_id: Optional[str] = Field(
        None, max_length=100, description="Camera/device serial number"
    )
    status: str = Field("active", pattern="^(active|inactive|maintenance)$")


class VehicleResponse(BaseModel):
    """Full vehicle record returned by GET /fleet/vehicles and POST /fleet/vehicles."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    plate: str
    model: Optional[str]
    camera_id: Optional[str]
    status: str
    last_seen: Optional[datetime]
    registered_at: datetime

    # Derived at API layer — not stored in DB
    camera_health: str = "unknown"  # "online" | "stale" | "offline" | "unknown"
    report_count: int = 0


class VehicleListResponse(BaseModel):
    """Paginated list of vehicles."""

    vehicles: List[VehicleResponse]
    total: int


class VehicleHistoryResponse(BaseModel):
    """Detection history for a single vehicle (GET /fleet/vehicles/{id}/history)."""

    vehicle_id: str
    plate: str
    reports: List[ReportResponse]
    total: int


# ── Notification schemas (B3-2) ───────────────────────────────────────────────


class NotificationResponse(BaseModel):
    """Single notification row returned in the bell feed."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: Optional[str]
    type: str
    title: str
    body: Optional[str]
    resource_id: Optional[str]
    resource_type: Optional[str]
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    """Paginated bell-icon feed response."""

    notifications: List[NotificationResponse]
    total: int
    unread_count: int


class NotificationPreferenceResponse(BaseModel):
    """Current user's notification preference record."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    min_severity: str
    email_enabled: bool
    area_filter: Optional[list]
    digest_interval_seconds: int
    updated_at: datetime


class NotificationPreferenceUpdate(BaseModel):
    """Partial update payload for PUT /notifications/preferences."""

    min_severity: Optional[str] = Field(
        None,
        pattern="^(low|medium|high)$",
        description="Minimum severity to trigger a notification",
    )
    email_enabled: Optional[bool] = None
    area_filter: Optional[list] = Field(
        None,
        description="Bounding box [lat_min, lon_min, lat_max, lon_max] or null for global",
    )
    digest_interval_seconds: Optional[int] = Field(
        None, ge=60, le=86400, description="Seconds between consecutive email digests"
    )


# ── AI Model Registry schemas (B3-4) ─────────────────────────────────────────


class AIModelCreate(BaseModel):
    """Payload for POST /admin/models — register a new model version."""

    version: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Unique version tag, e.g. 'roadsense-yolov8s-v4'",
    )
    artifact_url: str = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="URL or path to the weights file (S3, GitHub Release, local)",
    )
    sha256: str = Field(
        ...,
        min_length=64,
        max_length=64,
        description="SHA-256 hex digest of the weights file",
    )
    classes: List[str] = Field(
        ...,
        min_length=1,
        description="Ordered list of detection class names as the model outputs them",
    )
    conf_threshold: float = Field(
        ..., gt=0.0, lt=1.0, description="F1-optimal confidence threshold"
    )
    metrics: Optional[dict] = Field(
        None,
        description="Free-form metrics bag: mAP50, per-class AP, latency numbers, etc.",
    )
    notes: Optional[str] = Field(
        None, max_length=2000, description="Training config, dataset, known weaknesses"
    )


class AIModelResponse(BaseModel):
    """Full model registry record returned by the admin endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    version: str
    artifact_url: str
    sha256: str
    classes: list
    conf_threshold: float
    metrics: Optional[dict]
    is_active: bool
    notes: Optional[str]
    registered_at: datetime


# ── Road Health Score schemas (B3-3) ─────────────────────────────────────────


class RoadHealthSegmentResponse(BaseModel):
    """A single hexagon segment with its computed health score."""

    hex_id: str
    center_lat: float
    center_lon: float
    health_score: float
    total_issues: int
    total_reports: int
    polygon: List[List[float]] = Field(
        ..., description="Array of [lat, lon] coordinates forming the hexagon"
    )


class RoadHealthResponse(BaseModel):
    """Payload for GET /analytics/road-health."""

    segments: List[RoadHealthSegmentResponse]
