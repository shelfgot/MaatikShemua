"""Pytest configuration and fixtures."""
import os

# Enable MPS fallback for CTC loss on Mac (must be set before torch import)
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import pytest


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers",
        "finetune: integration test that runs Kraken fine-tuning (use -m finetune to run)",
    )
    config.addinivalue_line(
        "markers",
        "slow: marks test as slow (deselect with '-m \"not slow\"')",
    )
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.main import app


# Test database
TEST_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db():
    """Create fresh database for each test."""
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def client(db):
    """Create test client with database override."""
    def override_get_db():
        try:
            yield db
        finally:
            pass
    
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def sample_document(db):
    """Create a sample document for testing."""
    from app.models import Document
    
    doc = Document(name="Test Document", shelfmark="TEST-001")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@pytest.fixture
def sample_page(db, sample_document):
    """Create a sample page for testing."""
    from app.models import Page
    
    page = Page(
        document_id=sample_document.id,
        page_number=1,
        image_path="/tmp/test.png",
        lines_detected=False,
    )
    db.add(page)
    db.commit()
    db.refresh(page)
    return page
