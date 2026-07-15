import pytest
from fastapi.testclient import TestClient

import auth
from database import Base, engine
from main import app


@pytest.fixture(scope="module", autouse=True)
def setup_auth_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_auth_register_and_login():
    with TestClient(app) as client:
        # 1. Register a new user
        reg_payload = {
            "username": "test_driver",
            "password": "driverpassword",
            "role": "fleet",
        }
        res = client.post("/auth/register", json=reg_payload)
        assert res.status_code == 201
        data = res.json()
        assert data["username"] == "test_driver"
        assert data["role"] == "fleet"

        # Try to register same username (fails)
        res = client.post("/auth/register", json=reg_payload)
        assert res.status_code == 400

        # 2. Login
        login_payload = {"username": "test_driver", "password": "driverpassword"}
        res = client.post("/auth/login", json=login_payload)
        assert res.status_code == 200
        data = res.json()
        assert data["user"]["username"] == "test_driver"
        assert data["user"]["role"] == "fleet"
        assert "token" in data

        # Check cookie is set
        assert "access_token" in client.cookies

        # 3. Access GET /auth/me with login
        res = client.get("/auth/me")
        assert res.status_code == 200
        assert res.json()["username"] == "test_driver"

        # 4. Logout
        res = client.post("/auth/logout")
        assert res.status_code == 200
        assert "access_token" not in client.cookies


def test_role_restrictions(setup_test_users):
    from database import SessionLocal
    import models

    db = SessionLocal()
    if not db.query(models.User).filter(models.User.username == "test_fleet").first():
        fleet = models.User(
            username="test_fleet",
            hashed_password=auth.hash_password("password"),
            role="fleet",
        )
        db.add(fleet)
        db.commit()
    db.close()

    # 1. Anonymous client blocked on GET /map
    with TestClient(app) as client:
        res = client.get("/map")
        assert res.status_code == 401

    # 2. Fleet user client can read map, but gets 403 on POST /verify and POST /repair
    with TestClient(app) as client:
        token = auth.create_access_token(data={"sub": "test_fleet"})
        client.cookies.set("access_token", token)

        # Read map (allowed for any authenticated user)
        res = client.get("/map")
        assert res.status_code == 200

        # Call verify (forbidden for fleet, requires authority or admin)
        res = client.post("/verify")
        assert res.status_code == 403

        # Call repair (forbidden for fleet)
        repair_payload = {"issue_id": "some-id", "status": "verified"}
        res = client.post("/repair", json=repair_payload)
        assert res.status_code == 403
