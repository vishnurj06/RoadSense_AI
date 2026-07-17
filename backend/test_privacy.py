"""Tests for code item #5 — privacy blur (faces + plates before storage)."""

import io
from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import privacy
from database import Base, get_db
from main import app
from test_api import engine, TestingSessionLocal


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db


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
        db.add(
            models.User(
                username="test_admin",
                hashed_password=auth.hash_password("password"),
                role="admin",
            )
        )
        db.commit()
    db.close()

    with TestClient(app) as c:
        import auth as _auth

        c.cookies.set(
            "access_token", _auth.create_access_token(data={"sub": "test_admin"})
        )
        yield c


def _img_bytes(w=128, h=96, color=(10, 20, 30), fmt="JPEG"):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format=fmt)
    return buf.getvalue()


def _infer_mock():
    m = MagicMock()
    m.status_code = 200
    m.json.return_value = {
        "model_version": "stub",
        "image": {},
        "inference_ms": 1,
        "detections": [],
    }
    return m


# ── Unit tests: the blur module ──────────────────────────────────────────────


def test_is_blur_enabled_reads_env_live(monkeypatch):
    monkeypatch.delenv("PRIVACY_BLUR", raising=False)
    assert privacy.is_blur_enabled() is False
    monkeypatch.setenv("PRIVACY_BLUR", "1")
    assert privacy.is_blur_enabled() is True
    monkeypatch.setenv("PRIVACY_BLUR", "0")
    assert privacy.is_blur_enabled() is False


def test_blur_returns_valid_image_preserving_dimensions():
    out = privacy.blur_faces_and_plates(
        _img_bytes(128, 96), content_type="image/jpeg", filename="x.jpg"
    )
    assert isinstance(out, bytes) and len(out) > 0
    assert Image.open(io.BytesIO(out)).size == (128, 96)


def test_blur_preserves_png_format():
    out = privacy.blur_faces_and_plates(
        _img_bytes(64, 64, fmt="PNG"), content_type="image/png", filename="x.png"
    )
    assert Image.open(io.BytesIO(out)).format == "PNG"


def test_blur_fails_closed_on_undecodable_bytes():
    # A privacy control must NOT silently pass through garbage — it raises.
    with pytest.raises(Exception):
        privacy.blur_faces_and_plates(b"this is not an image")


# ── Integration: the /detect-image gate ──────────────────────────────────────


@patch("s3_storage.upload_image_bytes_to_s3", return_value="http://minio/x.jpg")
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
def test_detect_image_blurs_before_upload_when_enabled(
    mock_post, mock_s3, client, monkeypatch
):
    mock_post.return_value = _infer_mock()
    monkeypatch.setattr(privacy, "is_blur_enabled", lambda: True)
    spy = MagicMock(return_value=b"BLURRED-BYTES")
    monkeypatch.setattr(privacy, "blur_faces_and_plates", spy)

    files = {"file": ("road.jpg", _img_bytes(), "image/jpeg")}
    data = {"latitude": 19.07, "longitude": 72.87, "vehicle_id": "blur-test-vehicle"}
    res = client.post("/detect-image", files=files, data=data)

    assert res.status_code == 201
    spy.assert_called_once()
    # S3 must receive the BLURRED bytes, never the original.
    assert mock_s3.call_args.kwargs["contents"] == b"BLURRED-BYTES"


@patch("s3_storage.upload_image_bytes_to_s3", return_value="http://minio/x.jpg")
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
def test_detect_image_skips_blur_when_disabled(mock_post, mock_s3, client, monkeypatch):
    mock_post.return_value = _infer_mock()
    monkeypatch.setattr(privacy, "is_blur_enabled", lambda: False)
    spy = MagicMock(return_value=b"SHOULD-NOT-BE-USED")
    monkeypatch.setattr(privacy, "blur_faces_and_plates", spy)

    files = {"file": ("road.jpg", _img_bytes(), "image/jpeg")}
    data = {"latitude": 19.07, "longitude": 72.87, "vehicle_id": "noblur-test-vehicle"}
    res = client.post("/detect-image", files=files, data=data)

    assert res.status_code == 201
    spy.assert_not_called()
