import io
from fastapi.testclient import TestClient
from PIL import Image

from stub_infer import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "model_version": "roadsense-stub-v2",
        "model_loaded": True,
    }


def test_infer_success():
    # Create a dummy image using Pillow
    img = Image.new("RGB", (640, 480), color="red")
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="JPEG")
    img_byte_arr.seek(0)

    files = {"file": ("test_image.jpg", img_byte_arr, "image/jpeg")}
    data = {"conf": 0.5}

    response = client.post("/infer", files=files, data=data)
    assert response.status_code == 200
    res_json = response.json()
    assert res_json["model_version"] == "roadsense-stub-v2"
    assert res_json["image"] == {"width": 640, "height": 480}
    assert "inference_ms" in res_json
    assert "detections" in res_json

    # Validate each detection in the response
    for det in res_json["detections"]:
        assert det["class"] in ["pothole", "crack"]
        assert det["confidence"] >= 0.5
        assert len(det["bbox"]) == 4
        x1, y1, x2, y2 = det["bbox"]
        assert x1 < x2
        assert y1 < y2
        assert 0 <= x1 <= 640
        assert 0 <= y1 <= 480
        assert 0 <= x2 <= 640
        assert 0 <= y2 <= 480
        assert det["severity"] in ["low", "medium", "high"]


def test_infer_invalid_format():
    files = {"file": ("test_text.txt", io.BytesIO(b"fake text data"), "text/plain")}
    response = client.post("/infer", files=files)
    assert response.status_code == 400
    assert "invalid_image" in response.json()["detail"]


def test_infer_too_large():
    # Create mock content > 10MB (10.1 MB)
    large_data = io.BytesIO(b"0" * (10 * 1024 * 1024 + 1024))
    files = {"file": ("too_large.jpg", large_data, "image/jpeg")}
    response = client.post("/infer", files=files)
    assert response.status_code == 413
    assert "image_too_large" in response.json()["detail"]
