import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from main import app

# Set up test database engine
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/roadsense"
)
engine = create_engine(DATABASE_URL)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# Dependency override
def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    # Drop existing tables to clear any dev data
    Base.metadata.drop_all(bind=engine)
    # Create the tables fresh
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def client():
    from database import SessionLocal
    import models
    import auth

    db = SessionLocal()
    if not db.query(models.User).filter(models.User.username == "test_admin").first():
        admin = models.User(
            username="test_admin",
            hashed_password=auth.hash_password("password"),
            role="admin",
        )
        db.add(admin)
        db.commit()
    db.close()

    with TestClient(app) as c:
        token = auth.create_access_token(data={"sub": "test_admin"})
        c.cookies.set("access_token", token)
        yield c


def test_read_root(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Welcome" in response.json()["message"]


def test_create_and_get_report(client):
    payload = {
        "report_id": "test-uuid-1234",
        "vehicle_id": "test-car",
        "timestamp": "2026-07-14T20:00:00+05:30",
        "gps": {"lat": 19.0760, "lon": 72.8777},
        "detections": [
            {
                "class": "pothole",
                "confidence": 0.95,
                "bbox": [100, 200, 300, 400],
                "severity": "high",
            }
        ],
        "image_url": "/static/uploads/pothole_1.jpg",
    }

    # Test POST /detect
    response = client.post("/detect", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["id"] == "test-uuid-1234"
    assert data["vehicle_id"] == "test-car"
    assert len(data["detections"]) == 1
    assert data["detections"][0]["class"] == "pothole"
    assert data["detections"][0]["severity"] == "high"

    # Test GET /reports
    response = client.get("/reports")
    assert response.status_code == 200
    res_data = response.json()
    assert "reports" in res_data
    reports = res_data["reports"]
    assert len(reports) >= 1
    assert reports[0]["id"] == "test-uuid-1234"

    # Test GET /map (GeoJSON)
    response = client.get("/map")
    assert response.status_code == 200
    geojson = response.json()
    assert geojson["type"] == "FeatureCollection"
    assert len(geojson["features"]) >= 1
    feature = geojson["features"][0]
    assert feature["geometry"]["type"] == "Point"
    assert feature["geometry"]["coordinates"] == [72.8777, 19.0760]  # [lon, lat]
    assert isinstance(feature["properties"]["report_id"], str)
    assert feature["properties"]["max_severity"] == "high"


def test_get_analytics(client):
    response = client.get("/analytics")
    assert response.status_code == 200
    analytics = response.json()
    assert analytics["total_reports"] >= 1
    assert analytics["total_detections"] >= 1
    assert analytics["severity_distribution"]["high"] >= 1


def test_upload_image(client):
    # Create dummy file content
    file_content = b"fake image content"
    files = {"file": ("test_image.png", file_content, "image/png")}

    response = client.post("/upload", files=files)
    assert response.status_code == 200
    data = response.json()
    assert "image_url" in data
    assert (
        data["image_url"].startswith("/static/uploads/") or "http" in data["image_url"]
    )


def test_spatial_clustering(client):
    # Clear DB and set up fresh tables for clustering test
    from database import Base, engine

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    from database import SessionLocal
    import models
    import auth

    db = SessionLocal()
    admin = models.User(
        username="test_admin",
        hashed_password=auth.hash_password("password"),
        role="admin",
    )
    db.add(admin)
    db.commit()
    db.close()

    # Ingest 3 nearby reports of the same class (within 20m)
    # Mumbai center: Lat 19.0760, Lon 72.8777
    # 0.0001 degrees is roughly 11 meters
    reports_payloads = [
        {
            "report_id": "report-1",
            "vehicle_id": "car-1",
            "timestamp": "2026-07-14T20:00:00+05:30",
            "gps": {"lat": 19.0760, "lon": 72.8777},
            "detections": [
                {
                    "class": "pothole",
                    "confidence": 0.90,
                    "bbox": [0, 0, 10, 10],
                    "severity": "medium",
                }
            ],
        },
        {
            "report_id": "report-2",
            "vehicle_id": "car-2",
            "timestamp": "2026-07-14T20:01:00+05:30",
            "gps": {"lat": 19.0761, "lon": 72.8777},  # ~11 meters away
            "detections": [
                {
                    "class": "pothole",
                    "confidence": 0.85,
                    "bbox": [0, 0, 10, 10],
                    "severity": "high",
                }
            ],
        },
        {
            "report_id": "report-3",
            "vehicle_id": "car-3",
            "timestamp": "2026-07-14T20:02:00+05:30",
            "gps": {"lat": 19.0760, "lon": 72.8776},  # ~11 meters away
            "detections": [
                {
                    "class": "pothole",
                    "confidence": 0.95,
                    "bbox": [0, 0, 10, 10],
                    "severity": "low",
                }
            ],
        },
        {
            "report_id": "report-4",
            "vehicle_id": "car-4",
            "timestamp": "2026-07-14T20:03:00+05:30",
            "gps": {"lat": 19.0760, "lon": 72.8777},  # exact coordinates
            "detections": [
                {
                    "class": "crack",
                    "confidence": 0.80,
                    "bbox": [0, 0, 10, 10],
                    "severity": "medium",
                }
            ],
        },
    ]

    for p in reports_payloads:
        res = client.post("/detect", json=p)
        assert res.status_code == 201

    # Check /map to see if it clustered into 1 issue
    res = client.get("/map")
    assert res.status_code == 200
    geojson = res.json()

    # We expect exactly 1 feature (the clustered issue) instead of 4 separate pins
    features = geojson["features"]
    assert len(features) == 1

    issue_properties = features[0]["properties"]
    assert issue_properties["detection_count"] == 4
    assert (
        issue_properties["class_name"] == "pothole"
    )  # Highest confidence wins (0.95 pothole > 0.80 crack)
    assert issue_properties["max_severity"] == "high"  # Max of medium, high, low
