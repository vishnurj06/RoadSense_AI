import pytest
from sqlalchemy import text
from test_api import engine


@pytest.fixture(scope="session", autouse=True)
def ensure_postgis():
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
        conn.commit()
