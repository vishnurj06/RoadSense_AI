import uuid
from sqlalchemy import Column, String, DateTime, Float, ForeignKey, JSON
from sqlalchemy.orm import relationship
from database import Base


class Report(Base):
    __tablename__ = "reports"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    vehicle_id = Column(String(50), nullable=False)
    timestamp = Column(DateTime, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    image_url = Column(String(500), nullable=True)

    detections = relationship(
        "Detection", back_populates="report", cascade="all, delete-orphan"
    )


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
