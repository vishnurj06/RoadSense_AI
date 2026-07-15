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
    image_url: Optional[str]
    speed_kmph: Optional[float]
    model_version: Optional[str]
    status: Optional[str] = "detected"
    detections: List[DetectionResponse] = []


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
