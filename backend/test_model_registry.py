"""B3-4 — sync Person A's ai/models.json (A3-7) into the ai_models registry."""

import json

import pytest
from fastapi.testclient import TestClient

import auth
import model_registry
import models
from database import Base, get_db
from main import app
from test_api import engine, TestingSessionLocal


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
def db():
    session = TestingSessionLocal()
    session.query(models.AIModel).delete()
    session.commit()
    yield session
    session.close()


@pytest.fixture
def admin_client():
    session = TestingSessionLocal()
    if (
        not session.query(models.User)
        .filter(models.User.username == "reg_admin")
        .first()
    ):
        session.add(
            models.User(
                username="reg_admin",
                hashed_password=auth.hash_password("password"),
                role="admin",
            )
        )
        session.commit()
    session.close()
    with TestClient(app) as c:
        c.cookies.set(
            "access_token", auth.create_access_token(data={"sub": "reg_admin"})
        )
        yield c


def test_sync_loads_person_as_real_registry(db):
    """The real ai/models.json parses and lands in the DB with A's actual values."""
    summary = model_registry.sync_registry_to_db(db)

    assert summary["total"] >= 2
    assert "roadsense-yolov8s-v4-all" in summary["created"]
    assert summary["default"] == "roadsense-yolov8s-v4-all"

    v4 = (
        db.query(models.AIModel)
        .filter(models.AIModel.version == "roadsense-yolov8s-v4-all")
        .one()
    )
    assert v4.classes == ["pothole", "crack"]
    assert v4.conf_threshold == pytest.approx(0.29)
    assert len(v4.sha256) == 64
    assert v4.artifact_url.startswith("https://github.com/")
    # metrics are copied verbatim — including A's non-comparability caveat.
    assert "_note" in v4.metrics
    assert v4.metrics["real_footage_false_positives"] == "0/57"
    # known_weaknesses must reach the admin choosing a model.
    assert "Known weaknesses" in v4.notes
    assert len(v4.notes) <= 2000


def test_sync_seeds_default_active_on_a_fresh_install(db):
    summary = model_registry.sync_registry_to_db(db)
    assert summary["activated"] == "roadsense-yolov8s-v4-all"

    active = db.query(models.AIModel).filter(models.AIModel.is_active.is_(True)).all()
    assert len(active) == 1
    assert active[0].version == "roadsense-yolov8s-v4-all"


def test_resync_is_idempotent_and_never_overrides_admin_activation(db):
    """The critical rule: a file must not silently undo a deliberate admin choice."""
    model_registry.sync_registry_to_db(db)

    # Admin deliberately pins the OLD model (e.g. v4 regressed on their footage).
    v3 = (
        db.query(models.AIModel)
        .filter(models.AIModel.version == "roadsense-yolov8s-v3-merged")
        .one()
    )
    db.query(models.AIModel).update({"is_active": False}, synchronize_session=False)
    v3.is_active = True
    db.commit()

    # Person A ships again / someone re-syncs.
    summary = model_registry.sync_registry_to_db(db)

    assert summary["created"] == [], "re-sync must not duplicate versions"
    assert summary["activated"] is None, "re-sync must not re-activate the file default"

    active = db.query(models.AIModel).filter(models.AIModel.is_active.is_(True)).all()
    assert len(active) == 1
    assert active[0].version == "roadsense-yolov8s-v3-merged", (
        "sync overrode the admin's deliberate activation"
    )


def test_sync_refreshes_metadata_for_a_known_version(db):
    model_registry.sync_registry_to_db(db)
    v4 = (
        db.query(models.AIModel)
        .filter(models.AIModel.version == "roadsense-yolov8s-v4-all")
        .one()
    )
    v4.sha256 = "0" * 64
    v4.metrics = {"stale": True}
    db.commit()

    model_registry.sync_registry_to_db(db)
    db.refresh(v4)
    assert v4.sha256 != "0" * 64, "stale sha256 was not refreshed from the registry"
    assert "stale" not in (v4.metrics or {})


def test_missing_registry_file_raises_not_swallowed(db, tmp_path):
    with pytest.raises(FileNotFoundError):
        model_registry.sync_registry_to_db(db, path=tmp_path / "nope.json")


def test_malformed_registry_raises(db, tmp_path):
    bad = tmp_path / "models.json"
    bad.write_text("{ not json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        model_registry.sync_registry_to_db(db, path=bad)


def test_sync_endpoint_then_list_returns_real_models(admin_client, db):
    res = admin_client.post("/admin/models/sync")
    assert res.status_code == 200
    assert res.json()["default"] == "roadsense-yolov8s-v4-all"

    res = admin_client.get("/admin/models")
    assert res.status_code == 200
    payload = res.json()
    versions = [m["version"] for m in payload]
    assert "roadsense-yolov8s-v4-all" in versions
    assert "roadsense-yolov8s-v3-merged" in versions
    # The UI reads these fields — they must be populated, not null.
    v4 = next(m for m in payload if m["version"] == "roadsense-yolov8s-v4-all")
    assert v4["classes"] == ["pothole", "crack"]
    assert v4["is_active"] is True
    assert v4["metrics"]["rdd_test_map50"] == pytest.approx(0.5108)


def test_sync_requires_admin_role(db):
    session = TestingSessionLocal()
    if (
        not session.query(models.User)
        .filter(models.User.username == "reg_fleet")
        .first()
    ):
        session.add(
            models.User(
                username="reg_fleet",
                hashed_password=auth.hash_password("password"),
                role="fleet",
            )
        )
        session.commit()
    session.close()

    with TestClient(app) as c:
        c.cookies.set(
            "access_token", auth.create_access_token(data={"sub": "reg_fleet"})
        )
        assert c.post("/admin/models/sync").status_code == 403
