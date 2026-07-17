import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Float, ForeignKey, JSON, Integer, Boolean
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from database import Base


class Issue(Base):
    __tablename__ = "issues"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    class_name = Column(String(50), nullable=False)  # 'pothole', 'crack' etc.
    status = Column(
        String(50), nullable=False, default="detected", index=True
    )  # 'detected', 'verified' etc.
    severity = Column(
        String(20), nullable=False, default="low"
    )  # 'low', 'medium', 'high'
    image_url = Column(String(500), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    detection_count = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    reports = relationship("Report", back_populates="issue")
    audit_logs = relationship(
        "IssueAuditLog", back_populates="issue", cascade="all, delete-orphan"
    )


class Report(Base):
    __tablename__ = "reports"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    vehicle_id = Column(String(50), nullable=False)
    timestamp = Column(DateTime, nullable=False, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    image_url = Column(String(500), nullable=True)
    speed_kmph = Column(Float, nullable=True)
    model_version = Column(String(100), nullable=True)
    gps_source = Column(String(50), nullable=True)
    road_name = Column(String(200), nullable=True)
    weather = Column(JSON, nullable=True)
    issue_id = Column(
        String(36), ForeignKey("issues.id", ondelete="SET NULL"), nullable=True
    )

    issue = relationship("Issue", back_populates="reports")
    detections = relationship(
        "Detection", back_populates="report", cascade="all, delete-orphan"
    )

    @property
    def status(self):
        return self.issue.status if self.issue else "detected"


class Detection(Base):
    __tablename__ = "detections"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    report_id = Column(
        String(36), ForeignKey("reports.id", ondelete="CASCADE"), nullable=False
    )
    class_name = Column(String(50), nullable=False)  # 'pothole', 'crack' etc.
    confidence = Column(Float, nullable=False)
    bbox = Column(JSON, nullable=False)  # [x1, y1, x2, y2]
    severity = Column(String(20), nullable=False)  # 'low', 'medium', 'high'

    report = relationship("Report", back_populates="detections")


class IssueAuditLog(Base):
    __tablename__ = "issue_audit_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    issue_id = Column(
        String(36), ForeignKey("issues.id", ondelete="CASCADE"), nullable=False
    )
    changed_by = Column(String(100), nullable=False, default="authority_user")
    old_status = Column(String(50), nullable=False)
    new_status = Column(String(50), nullable=False)
    notes = Column(String(500), nullable=True)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)

    issue = relationship("Issue", back_populates="audit_logs")


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False)  # 'admin', 'authority', 'fleet'
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    notification_preferences = relationship(
        "NotificationPreference", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    notifications = relationship(
        "Notification", back_populates="user", cascade="all, delete-orphan"
    )


class Vehicle(Base):
    """Registered fleet vehicles.

    camera_status is derived at query-time (never stored):
      - "online"  if last_seen < CAMERA_STALE_MINUTES ago
      - "stale"   if last_seen < CAMERA_OFFLINE_MINUTES ago
      - "offline" otherwise
    report_count is computed via a JOIN to reports on vehicle_id.
    """

    __tablename__ = "vehicles"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    plate = Column(String(20), unique=True, index=True, nullable=False)
    model = Column(String(100), nullable=True)   # e.g. "Toyota HiAce"
    camera_id = Column(String(100), nullable=True)  # device/camera serial
    status = Column(String(20), nullable=False, default="active")  # active | inactive | maintenance
    last_seen = Column(DateTime, nullable=True)  # updated on every /detect hit for this plate
    registered_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class NotificationPreference(Base):
    """Per-user notification settings (B3-2).

    One row per user — upserted via PUT /notifications/preferences.
    """

    __tablename__ = "notification_preferences"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    # Severity threshold below which the user does NOT receive alerts
    min_severity = Column(String(10), nullable=False, default="high")
    email_enabled = Column(Boolean, nullable=False, default=True)
    # Optional JSON bbox filter: [lat_min, lon_min, lat_max, lon_max]
    area_filter = Column(JSON, nullable=True)
    # Minimum seconds between consecutive email digests (burst guard)
    digest_interval_seconds = Column(Integer, nullable=False, default=300)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User", back_populates="notification_preferences")


class Notification(Base):
    """In-app notification row — backs the bell-icon feed (B3-2).

    user_id=NULL means broadcast (visible to all authority/admin users).
    """

    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    # "new_high_severity_issue" | "digest" | "system"
    type = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    body = Column(String(2000), nullable=True)
    # Link back to the triggering resource
    resource_id = Column(String(36), nullable=True)    # e.g. issue UUID
    resource_type = Column(String(50), nullable=True)   # e.g. "issue"
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User", back_populates="notifications")


class AIModel(Base):
    """Registered AI model version — the model registry (B3-4).

    Exactly one row has is_active=True at any time.
    Activation is an atomic deactivate-all → activate-one transaction
    performed by POST /admin/models/{id}/activate.

    model_version on Report rows traces back to AIModel.version — not to
    AIModel.id — so the string is self-documenting in the DB without a JOIN.
    """

    __tablename__ = "ai_models"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Human-readable tag — must be unique, e.g. "roadsense-yolov8s-v4"
    version = Column(String(100), nullable=False, unique=True, index=True)
    # Where the weights file lives (S3 key, GitHub Release URL, local path)
    artifact_url = Column(String(1000), nullable=False)
    # SHA-256 hex digest of the weights file
    sha256 = Column(String(64), nullable=False)
    # Ordered list of class names as the model outputs them
    classes = Column(JSON, nullable=False)
    # Confidence threshold that was F1-optimal at training time
    conf_threshold = Column(Float, nullable=False)
    # Free-form metrics bag: mAP50, per-class AP, latency, footage numbers, etc.
    metrics = Column(JSON, nullable=True)
    # Exactly one row is True at any time
    is_active = Column(Boolean, nullable=False, default=False)
    # Optional admin notes: training config, dataset version, known weaknesses
    notes = Column(String(2000), nullable=True)
    registered_at = Column(DateTime, nullable=False, default=datetime.utcnow)


