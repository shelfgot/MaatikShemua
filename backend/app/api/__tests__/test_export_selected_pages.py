from zipfile import ZipFile
from io import BytesIO

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import Base, engine, SessionLocal, get_db
from app.models import Document, Page, Transcription, TranscriptionLine


def create_page_with_transcription(db, document: Document, page_number: int, text: str):
    page = Page(
        document_id=document.id,
        page_number=page_number,
        image_path=f"page_{page_number}.png",
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    trans = Transcription(page_id=page.id, type="manual")
    db.add(trans)
    db.commit()
    db.refresh(trans)

    line = TranscriptionLine(
        transcription_id=trans.id,
        line_number=1,
        display_order=0,
        text=text,
        confidence=0.9,
    )
    db.add(line)
    db.commit()
    return page


@pytest.fixture
def client():
    """Test client with its own temporary SQLite schema."""
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)


def test_export_selected_pages_zip_contains_files(client):
    # Use a direct session to seed data
    db = SessionLocal()
    try:
        doc = Document(name="TestDoc")
        db.add(doc)
        db.commit()
        db.refresh(doc)

        page1 = create_page_with_transcription(db, doc, 1, "Hello world")
        page2 = create_page_with_transcription(db, doc, 2, "Second page")
        page1_id = page1.id
        page2_id = page2.id
    finally:
        db.close()

    resp = client.get(
        f"/api/export/pages/export?ids={page1_id},{page2_id}&format=text&type=manual"
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    data = BytesIO(resp.content)
    with ZipFile(data) as zf:
        names = zf.namelist()
        assert any("page-1" in n for n in names)
        assert any("page-2" in n for n in names)
