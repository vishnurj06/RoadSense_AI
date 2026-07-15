import io
from unittest.mock import patch, AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from database import Base, get_db
from main import app
from test_api import engine, TestingSessionLocal


# Override database dependency (similar to test_api.py)
def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.drop_all(bind=engine)
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


@patch("s3_storage.upload_image_bytes_to_s3", return_value="http://minio/roadsense/test.jpg")
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
def test_detect_image_success(mock_post, mock_s3, client):
    # Setup mock response from inference service
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "model_version": "roadsense-stub-v2",
        "image": {"width": 640, "height": 480},
        "inference_ms": 15,
        "detections": [
            {
                "class": "pothole",
                "confidence": 0.92,
                "bbox": [100.0, 150.0, 300.0, 400.0],
                "severity": "high",
            }
        ],
    }
    mock_post.return_value = mock_response

    # Create dummy image
    img = Image.new("RGB", (640, 480), color="blue")
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="JPEG")
    img_byte_arr.seek(0)

    files = {"file": ("test_road.jpg", img_byte_arr, "image/jpeg")}
    data = {
        "latitude": 19.0760,
        "longitude": 72.8777,
        "vehicle_id": "test-vehicle",
        "speed_kmph": 45.5,
    }

    response = client.post("/detect-image", files=files, data=data)
    assert response.status_code == 201
    res_json = response.json()
    assert res_json["vehicle_id"] == "test-vehicle"
    assert res_json["latitude"] == 19.0760
    assert res_json["longitude"] == 72.8777
    assert res_json["speed_kmph"] == 45.5
    assert res_json["model_version"] == "roadsense-stub-v2"
    assert len(res_json["detections"]) == 1
    assert res_json["detections"][0]["class"] == "pothole"
    assert res_json["detections"][0]["severity"] == "high"


@patch("s3_storage.upload_image_bytes_to_s3", return_value="http://minio/roadsense/test.jpg")
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
def test_detect_image_inference_down(mock_post, mock_s3, client):
    # Setup mock exception for unreachable inference service
    import httpx

    mock_post.side_effect = httpx.RequestError("Connection refused")

    img = Image.new("RGB", (100, 100), color="blue")
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="JPEG")
    img_byte_arr.seek(0)

    files = {"file": ("test_road.jpg", img_byte_arr, "image/jpeg")}
    data = {"latitude": 19.0, "longitude": 72.0}

    response = client.post("/detect-image", files=files, data=data)
    assert response.status_code == 503
    assert "Inference service is unreachable" in response.json()["detail"]


@patch("s3_storage.upload_image_bytes_to_s3", return_value="http://minio/roadsense/test.jpg")
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
def test_detect_image_inference_fails(mock_post, mock_s3, client):
    # Setup mock response indicating server error (500)
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"
    mock_post.return_value = mock_response

    img = Image.new("RGB", (100, 100), color="blue")
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="JPEG")
    img_byte_arr.seek(0)

    files = {"file": ("test_road.jpg", img_byte_arr, "image/jpeg")}
    data = {"latitude": 19.0, "longitude": 72.0}

    response = client.post("/detect-image", files=files, data=data)
    assert response.status_code == 502
    assert "Inference service failed with status code 500" in response.json()["detail"]
