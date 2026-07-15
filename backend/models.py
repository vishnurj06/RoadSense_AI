import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Float, ForeignKey, JSON, Integer
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from database import Base


class Issue(Base):
    __tablename__ = "issues"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    class_name = Column(String(50), nullable=False)  # 'pothole', 'crack' etc.
    status = Column(
        String(50), nullable=False, default="detected"
    )  # 'detected', 'verified' etc.
    severity = Column(
        String(20), nullable=False, default="low"
    )  # 'low', 'medium', 'high'
    image_url = Column(String(500), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    detection_count = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
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
    timestamp = Column(DateTime, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    image_url = Column(String(500), nullable=True)
    speed_kmph = Column(Float, nullable=True)
    model_version = Column(String(100), nullable=True)
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
