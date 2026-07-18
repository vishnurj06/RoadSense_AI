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

    # 3. Perform a valid transition: detected -> approved
    repair_payload["status"] = "approved"
    repair_payload["notes"] = "Verified pothole on camera footage."
    res = client.post("/repair", json=repair_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "approved"

    # Verify audit log exists
    res = client.get(f"/issues/{issue_id}/audit-log")
    assert res.status_code == 200
    logs = res.json()
    assert len(logs) == 1
    assert logs[0]["old_status"] == "detected"
    assert logs[0]["new_status"] == "approved"
    assert logs[0]["notes"] == "Verified pothole on camera footage."
    assert logs[0]["changed_by"] == "authority_user"

    # 4. Perform next valid transition: approved -> assigned
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


def test_repair_assignment(client):
    # New issue far from test_repair_workflow's pin (distinct vehicle_id too, so
    # the teleportation guard never compares the two — see §5f).
    payload = {
        "report_id": "report-assign-test",
        "vehicle_id": "assign-test-car",
        "timestamp": "2026-07-14T20:00:00+05:30",
        "gps": {"lat": 28.6139, "lon": 77.2090},
        "detections": [
            {
                "class": "pothole",
                "confidence": 0.88,
                "bbox": [0, 0, 10, 10],
                "severity": "high",
            }
        ],
    }
    assert client.post("/detect", json=payload).status_code == 201

    # Locate the new issue by its coordinates.
    features = client.get("/map").json()["features"]
    feat = next(
        f for f in features if abs(f["geometry"]["coordinates"][0] - 77.2090) < 1e-4
    )
    issue_id = feat["properties"]["issue_id"]
    assert feat["properties"]["assigned_to"] is None

    # detected -> approved (assignee on a non-'assigned' transition is ignored).
    res = client.post(
        "/repair",
        json={"issue_id": issue_id, "status": "approved", "assignee": "ignored-crew"},
    )
    assert res.status_code == 200
    assert res.json()["assigned_to"] is None

    # approved -> assigned WITH an assignee: stored on the issue + folded into
    # the immutable audit note.
    res = client.post(
        "/repair",
        json={
            "issue_id": issue_id,
            "status": "assigned",
            "assignee": "Ward 12 PWD Crew",
            "notes": "urgent",
        },
    )
    assert res.status_code == 200
    assert res.json()["assigned_to"] == "Ward 12 PWD Crew"

    # /map surfaces the assignee (the 3-places hop is intact).
    features = client.get("/map").json()["features"]
    feat = next(f for f in features if f["properties"]["issue_id"] == issue_id)
    assert feat["properties"]["assigned_to"] == "Ward 12 PWD Crew"

    # The assignee is on the audit record for that transition.
    logs = client.get(f"/issues/{issue_id}/audit-log").json()
    assert logs[0]["new_status"] == "assigned"
    assert "Ward 12 PWD Crew" in logs[0]["notes"]

    # Un-dispatch: assigned -> approved clears the assignee (no stale crew).
    res = client.post("/repair", json={"issue_id": issue_id, "status": "approved"})
    assert res.status_code == 200
    assert res.json()["assigned_to"] is None


def test_reopen_closed_issue(client):
    # Backs the popup "Reopen issue" button: a closed issue can go back to
    # 'detected'. Distinct vehicle_id/location to avoid the §5f teleport trap.
    payload = {
        "report_id": "report-reopen-test",
        "vehicle_id": "reopen-test-car",
        "timestamp": "2026-07-14T20:00:00+05:30",
        "gps": {"lat": 12.9716, "lon": 77.5946},
        "detections": [
            {
                "class": "pothole",
                "confidence": 0.80,
                "bbox": [0, 0, 10, 10],
                "severity": "low",
            }
        ],
    }
    assert client.post("/detect", json=payload).status_code == 201

    features = client.get("/map").json()["features"]
    feat = next(
        f for f in features if abs(f["geometry"]["coordinates"][0] - 77.5946) < 1e-4
    )
    issue_id = feat["properties"]["issue_id"]

    # Drive it to closed: detected -> approved -> closed (approved allows closed).
    assert (
        client.post(
            "/repair", json={"issue_id": issue_id, "status": "approved"}
        ).status_code
        == 200
    )
    res = client.post("/repair", json={"issue_id": issue_id, "status": "closed"})
    assert res.status_code == 200
    assert res.json()["status"] == "closed"

    # Reopen: closed -> detected (what the button POSTs). Returns to the queue.
    res = client.post("/repair", json={"issue_id": issue_id, "status": "detected"})
    assert res.status_code == 200
    assert res.json()["status"] == "detected"

    # The reopen is on the audit trail.
    logs = client.get(f"/issues/{issue_id}/audit-log").json()
    assert logs[0]["old_status"] == "closed"
    assert logs[0]["new_status"] == "detected"
