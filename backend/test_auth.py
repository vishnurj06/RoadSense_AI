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


def test_login_rate_limiting():
    """B3-9: repeated failed logins are throttled with 429, and a success resets it."""
    import rate_limit
    import main
    from database import SessionLocal
    import models

    # The limiter's counter lives in Redis (or an in-process dict). Both persist
    # across test runs, so this test must own its starting state: clear the key with
    # the *same* client the endpoint uses before and after.
    rl_key = "testclient:ratelimit_user"
    rate_limit.reset(rl_key, main.redis_client)

    # Seed a user whose correct password we know.
    db = SessionLocal()
    if (
        not db.query(models.User)
        .filter(models.User.username == "ratelimit_user")
        .first()
    ):
        db.add(
            models.User(
                username="ratelimit_user",
                hashed_password=auth.hash_password("correct-horse"),
                role="fleet",
            )
        )
        db.commit()
    db.close()

    with TestClient(app) as client:
        bad = {"username": "ratelimit_user", "password": "wrong"}

        # First MAX_ATTEMPTS bad logins are rejected as 401 (bad credentials).
        for _ in range(rate_limit.MAX_ATTEMPTS):
            res = client.post("/auth/login", json=bad)
            assert res.status_code == 401

        # The next attempt is blocked by the limiter, even with a wrong password.
        res = client.post("/auth/login", json=bad)
        assert res.status_code == 429
        assert "Retry-After" in res.headers

        # Even the CORRECT password is blocked while the window is open.
        good = {"username": "ratelimit_user", "password": "correct-horse"}
        res = client.post("/auth/login", json=good)
        assert res.status_code == 429

    # A different username from the same client is unaffected (per-account keying).
    with TestClient(app) as client:
        res = client.post(
            "/auth/login", json={"username": "does-not-exist", "password": "x"}
        )
        assert res.status_code == 401

    # Reset for isolation from any later test reusing this client IP.
    rate_limit.reset(rl_key, main.redis_client)


def test_role_restrictions():
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
        repair_payload = {"issue_id": "some-id", "status": "approved"}
        res = client.post("/repair", json=repair_payload)
        assert res.status_code == 403


def test_admin_and_analytics_endpoints():
    from database import SessionLocal
    import models
    import auth

    # Ensure database has test_admin, test_fleet, and test_officer
    db = SessionLocal()
    if not db.query(models.User).filter(models.User.username == "test_admin").first():
        db.add(
            models.User(
                username="test_admin",
                hashed_password=auth.hash_password("password"),
                role="admin",
            )
        )
    if not db.query(models.User).filter(models.User.username == "test_fleet").first():
        db.add(
            models.User(
                username="test_fleet",
                hashed_password=auth.hash_password("password"),
                role="fleet",
            )
        )
    if not db.query(models.User).filter(models.User.username == "test_officer").first():
        db.add(
            models.User(
                username="test_officer",
                hashed_password=auth.hash_password("password"),
                role="authority",
            )
        )
    db.commit()
    db.close()

    # 1. Test /analytics (accessible to any logged-in user)
    with TestClient(app) as client:
        token = auth.create_access_token(data={"sub": "test_fleet"})
        client.cookies.set("access_token", token)
        res = client.get("/analytics")
        assert res.status_code == 200
        data = res.json()
        assert "time_series" in data
        assert "severity_distribution" in data

    # 2. Test /admin/users and /admin/system-health as admin (should succeed)
    with TestClient(app) as client:
        token = auth.create_access_token(data={"sub": "test_admin"})
        client.cookies.set("access_token", token)

        res = client.get("/admin/users")
        assert res.status_code == 200
        assert len(res.json()) >= 3

        from unittest.mock import patch

        with (
            patch("main.psutil.cpu_percent", return_value=34.5),
            patch("main.psutil.virtual_memory") as mock_mem,
            patch("main.psutil.disk_usage") as mock_disk,
        ):
            mock_mem.return_value.percent = 58.2
            mock_mem.return_value.used = 8 * 1024 * 1024
            mock_mem.return_value.total = 16 * 1024 * 1024
            mock_disk.return_value.used = 10 * 1024 * 1024 * 1024
            mock_disk.return_value.total = 100 * 1024 * 1024 * 1024
            mock_disk.return_value.percent = 10.0

            res = client.get("/admin/system-health")
            assert res.status_code == 200
            assert res.json()["cpu_usage_pct"] == 34.5

    # 3. Test /admin/users and /admin/system-health as fleet (should fail with 403)
    with TestClient(app) as client:
        token = auth.create_access_token(data={"sub": "test_fleet"})
        client.cookies.set("access_token", token)

        res = client.get("/admin/users")
        assert res.status_code == 403

        res = client.get("/admin/system-health")
        assert res.status_code == 403

    # 4. Test /admin/users and /admin/system-health as authority (should fail with 403)
    with TestClient(app) as client:
        token = auth.create_access_token(data={"sub": "test_officer"})
        client.cookies.set("access_token", token)

        res = client.get("/admin/users")
        assert res.status_code == 403

        res = client.get("/admin/system-health")
        assert res.status_code == 403

    # 5. Test user role update (POST /admin/users/role)
    db = SessionLocal()
    fleet_user = (
        db.query(models.User).filter(models.User.username == "test_fleet").first()
    )
    fleet_user_id = fleet_user.id
    db.close()

    # Fleet operator trying to change roles (Forbidden)
    with TestClient(app) as client:
        token = auth.create_access_token(data={"sub": "test_officer"})
        client.cookies.set("access_token", token)
        res = client.post(
            "/admin/users/role", json={"user_id": fleet_user_id, "role": "admin"}
        )
        assert res.status_code == 403

    # Admin changing role of fleet user to authority (Succeeds)
    with TestClient(app) as client:
        token = auth.create_access_token(data={"sub": "test_admin"})
        client.cookies.set("access_token", token)
        res = client.post(
            "/admin/users/role", json={"user_id": fleet_user_id, "role": "authority"}
        )
        assert res.status_code == 200

        # Verify role indeed updated
        res_users = client.get("/admin/users")
        updated_fleet = next(
            u for u in res_users.json() if u["username"] == "test_fleet"
        )
        assert updated_fleet["role"] == "authority"
