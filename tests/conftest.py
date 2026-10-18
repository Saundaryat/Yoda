import os
from pathlib import Path

TEST_DB = Path(__file__).parent / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["LOG_PATH"] = str(Path(__file__).parent / "test.jsonl")
os.environ["USE_LIVE_LLM"] = "false"

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app.db import engine
from app.main import app
from app.models import Account


@pytest.fixture(autouse=True)
def clean_db():
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Account(customer_id="CUST-001", name="Demo", balance=1250.50))
        session.commit()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client

