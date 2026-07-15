import pytest
from fastapi.testclient import TestClient
from database import Base, engine
from main import app


@pytest.fixture(scope="module")
def setup_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


@pytest.fixture(scope="module")
def client(setup_db):
    from database import SessionLocal
    import models
    import auth

    db = SessionLocal()
    if (
        not db.query(models.User)
        .filter(models.User.username == "authority_user")
        .first()
    ):
        auth_user = models.User(
            username="authority_user",
            hashed_password=auth.hash_password("password"),
            role="admin",
        )
        db.add(auth_user)
        db.commit()
    db.close()

    with TestClient(app) as c:
        token = auth.create_access_token(data={"sub": "authority_user"})
        c.cookies.set("access_token", token)
        yield c


def test_repair_workflow(client):
    # 1. Create a report which triggers a new issue (status: 'detected')
    payload = {
        "report_id": "report-repair-test",
        "vehicle_id": "test-car",
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
    }
    res = client.post("/detect", json=payload)
    assert res.status_code == 201

    # Get issue ID from /map
    res = client.get("/map")
    assert res.status_code == 200
    geojson = res.json()
    assert len(geojson["features"]) == 1
    issue_id = geojson["features"][0]["properties"]["issue_id"]
    current_status = geojson["features"][0]["properties"]["status"]
    assert current_status == "detected"

    # 2. Try an invalid transition: detected -> completed (fails under flexible rules)
    repair_payload = {
        "issue_id": issue_id,
        "status": "completed",
        "notes": "Jump to completed",
    }
    res = client.post("/repair", json=repair_payload)
    assert res.status_code == 400
    assert "Invalid transition" in res.json()["detail"]

    # 3. Perform a valid transition: detected -> verified
    repair_payload["status"] = "verified"
    repair_payload["notes"] = "Verified pothole on camera footage."
    res = client.post("/repair", json=repair_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "verified"

    # Verify audit log exists
    res = client.get(f"/issues/{issue_id}/audit-log")
    assert res.status_code == 200
    logs = res.json()
    assert len(logs) == 1
    assert logs[0]["old_status"] == "detected"
    assert logs[0]["new_status"] == "verified"
    assert logs[0]["notes"] == "Verified pothole on camera footage."
    assert logs[0]["changed_by"] == "authority_user"

    # 4. Perform next valid transition: verified -> assigned
    repair_payload["status"] = "assigned"
    repair_payload["notes"] = "Assigned to Ward A Road Repair crew."
    res = client.post("/repair", json=repair_payload)
    assert res.status_code == 200

    # 5. Perform skip transition (Option B): assigned -> repair (skips inspection)
    repair_payload["status"] = "repair"
    repair_payload["notes"] = "Crew dispatched directly to repair."
    res = client.post("/repair", json=repair_payload)
    assert res.status_code == 200

    # Verify audit logs count is now 3
    res = client.get(f"/issues/{issue_id}/audit-log")
    logs = res.json()
    assert len(logs) == 3
    assert logs[0]["new_status"] == "repair"
    assert logs[0]["old_status"] == "assigned"
