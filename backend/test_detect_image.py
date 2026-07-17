import io
from datetime import datetime
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


@patch(
    "s3_storage.upload_image_bytes_to_s3",
    return_value="http://minio/roadsense/test.jpg",
)
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


@patch(
    "s3_storage.upload_image_bytes_to_s3",
    return_value="http://minio/roadsense/test.jpg",
)
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
def test_web_upload_gps_provenance_is_faked_end_to_end(mock_post, mock_s3, client):
    """B3-6 regression: a web-UI upload carries no GPS provenance, so it must be
    recorded AND SERVED as `faked`.

    The original bug was not in the write path — /detect-image already stored
    "faked". GET /map simply omitted gps_source from its GeoJSON properties, so
    the browser saw `undefined` and defaulted it to "exif", rendering a faked
    pin as "✓ GPS VERIFIED". This asserts the field survives all the way to the
    map payload, which is where it actually broke.
    """
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "model_version": "roadsense-stub-v2",
        "image": {"width": 640, "height": 480},
        "inference_ms": 15,
        "detections": [
            {
                "class": "pothole",
                "confidence": 0.91,
                "bbox": [10.0, 10.0, 50.0, 50.0],
                "severity": "high",
            }
        ],
    }
    mock_post.return_value = mock_response

    img = Image.new("RGB", (640, 480), color="green")
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="JPEG")
    img_byte_arr.seek(0)

    # Exactly what the "Demo Telemetry Upload" panel sends: no gps_source field.
    #
    # vehicle_id is deliberately NOT the "demo-web-upload" Form default that the
    # UI sends. This test commits a report, and the tests below post with no
    # vehicle_id — so sharing the default would leave them a 200 km-distant
    # previous fix for the same vehicle and trip the teleportation guard. Own
    # your own vehicle: this test is about gps_source, not about the plate.
    files = {"file": ("google_image.jpg", img_byte_arr, "image/jpeg")}
    data = {
        "latitude": 18.5204,
        "longitude": 73.8567,
        "vehicle_id": "provenance-test-vehicle",
    }

    response = client.post("/detect-image", files=files, data=data)
    assert response.status_code == 201
    report = response.json()

    # 1. The write path defaults to faked.
    assert report["gps_source"] == "faked"

    # 2. The read path the map actually consumes must preserve it.
    map_res = client.get("/map")
    assert map_res.status_code == 200
    features = map_res.json()["features"]
    uploaded = [
        f for f in features if abs(f["geometry"]["coordinates"][0] - 73.8567) < 0.001
    ]
    assert uploaded, "uploaded report did not appear on /map"
    props = uploaded[0]["properties"]
    assert "gps_source" in props, "/map dropped gps_source — B3-6 regression"
    assert props["gps_source"] == "faked"

    # B3-5: the enrichment field must be present in the payload too. The value
    # is populated asynchronously by the background task, so assert on the key
    # (the popup reads it) rather than on a resolved road name.
    assert "road_name" in props, "/map dropped road_name — B3-5 regression"


@patch(
    "s3_storage.upload_image_bytes_to_s3",
    return_value="http://minio/roadsense/test.jpg",
)
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
def test_report_timestamp_is_utc_not_local_time(mock_post, mock_s3, client):
    """Report timestamps must be UTC, matching validate_gps_and_teleportation().

    /detect-image used to stamp reports with datetime.now() — naive *local* time —
    while the teleportation guard compares against datetime.utcnow(). On any
    non-UTC server the two disagree by the TZ offset, and since that delta is
    abs()'d into the speed denominator it silently DISABLES the guard: on UTC+5:30
    a 202 km jump computed as 37 km/h and passed. It also meant reports were
    stored in local time while issues.updated_at was UTC.

    NOTE ON COVERAGE: this assertion is only *sensitive* on a machine whose local
    zone is not UTC — in CI (UTC) now() and utcnow() coincide and it passes either
    way. That is deliberate and it is the right way round: the bug is invisible in
    UTC and only manifests on a real deployment in a real timezone, so the guard
    belongs where such a machine exists — a dev box. Do not read a green CI run as
    proof this is fixed.
    """
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "model_version": "roadsense-stub-v2",
        "image": {"width": 64, "height": 64},
        "inference_ms": 5,
        "detections": [],
    }
    mock_post.return_value = mock_response

    img = Image.new("RGB", (64, 64), color="red")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    before = datetime.utcnow()
    res = client.post(
        "/detect-image",
        files={"file": ("tz.jpg", buf, "image/jpeg")},
        data={
            "latitude": 12.9716,
            "longitude": 77.5946,
            "vehicle_id": "tz-test-vehicle",
        },
    )
    after = datetime.utcnow()
    assert res.status_code == 201

    stamped = datetime.fromisoformat(res.json()["timestamp"])
    if stamped.tzinfo is not None:
        stamped = stamped.replace(tzinfo=None)

    skew = min(
        abs((stamped - before).total_seconds()), abs((stamped - after).total_seconds())
    )
    assert before <= stamped <= after, (
        f"report timestamp {stamped} is not UTC — it sits {skew / 3600:.1f} h "
        f"outside the UTC window [{before}, {after}]. A local-time stamp here "
        "disables the teleportation guard on any non-UTC server."
    )


@patch(
    "s3_storage.upload_image_bytes_to_s3",
    return_value="http://minio/roadsense/test.jpg",
)
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


@patch(
    "s3_storage.upload_image_bytes_to_s3",
    return_value="http://minio/roadsense/test.jpg",
)
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
