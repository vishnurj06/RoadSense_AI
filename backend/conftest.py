import time
from sqlalchemy.exc import OperationalError
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import auth
from main import app
from test_api import engine


@pytest.fixture(scope="session", autouse=True)
def ensure_postgis():
    # Retry database connection in case the test container is still warming up
    retries = 10
    while retries > 0:
        try:
            with engine.connect() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
                conn.commit()
            break
        except OperationalError as e:
            retries -= 1
            if retries == 0:
                raise e
            time.sleep(1.5)


@pytest.fixture
def admin_client():
    with TestClient(app) as c:
        token = auth.create_access_token(data={"sub": "test_admin"})
        c.cookies.set("access_token", token)
        yield c


@pytest.fixture
def fleet_client():
    with TestClient(app) as c:
        token = auth.create_access_token(data={"sub": "test_fleet"})
        c.cookies.set("access_token", token)
        yield c


@pytest.fixture
def auth_client():
    with TestClient(app) as c:
        token = auth.create_access_token(data={"sub": "authority_user"})
        c.cookies.set("access_token", token)
        yield c


@pytest.fixture
def anonymous_client():
    with TestClient(app) as c:
        yield c


# Default client fixture for previous tests to continue working without changes
@pytest.fixture
def client():
    with TestClient(app) as c:
        token = auth.create_access_token(data={"sub": "test_admin"})
        c.cookies.set("access_token", token)
        yield c
