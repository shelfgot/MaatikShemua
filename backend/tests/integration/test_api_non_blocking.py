"""
End-to-end test: starting fine-tune or inference does not block the API.

With USE_BACKGROUND_TASKS=false the work runs in a thread; with true it runs in Celery.
Either way, the API must return immediately and respond to GET /api/tasks and other endpoints.
Uses the real database (SessionLocal) so skips if there is insufficient data.
"""
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.database import get_db, SessionLocal
from app.main import app


def _real_get_db():
    """Yield a real DB session (for e2e test against actual data)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.mark.finetune
def test_start_finetune_returns_immediately_and_tasks_list_responds():
    """
    POST /api/training/finetune returns immediately; GET /api/tasks still works.
    Uses real DB; mocks the sync training so the thread exits quickly (avoids GIL/blocking).
    """
    from app.api.training import get_ground_truth_pages
    from app.models import Model
    from app.config import MIN_TRAINING_PAGES

    db = SessionLocal()
    try:
        pages = get_ground_truth_pages(db, page_ids=None)
        if len(pages) < MIN_TRAINING_PAGES:
            pytest.skip(f"Need at least {MIN_TRAINING_PAGES} ground truth pages; got {len(pages)}")
        base_model = db.query(Model).filter(Model.path.isnot(None)).first()
        if not base_model:
            pytest.skip("No base model in DB")
        page_ids = [p.id for p in pages[: max(MIN_TRAINING_PAGES, 2)]]
    finally:
        db.close()

    app.dependency_overrides[get_db] = _real_get_db
    try:
        with patch("app.config.USE_BACKGROUND_TASKS", False):
            with patch("app.api.training.USE_BACKGROUND_TASKS", False):
                # Mock so the background thread does nothing and returns immediately
                with patch("app.api.training._run_training_sync") as mock_sync:
                    with TestClient(app) as client:
                        resp = client.post(
                            "/api/training/finetune",
                            json={
                                "model_id": base_model.id,
                                "name": "e2e_test_model",
                                "page_ids": page_ids,
                            },
                        )
                        assert resp.status_code == 200, resp.text
                        data = resp.json()
                        assert "task_id" in data
                        assert data.get("status") == "pending"

                        tasks_resp = client.get("/api/tasks")
                        assert tasks_resp.status_code == 200, tasks_resp.text
                        tasks_data = tasks_resp.json()
                        assert "items" in tasks_data
                mock_sync.assert_called_once()
    finally:
        app.dependency_overrides.clear()


@pytest.mark.finetune
def test_start_inference_does_not_block_api():
    """
    POST /api/inference/run returns immediately; GET /api/tasks still works.
    """
    from app.models import Page, Model

    db = SessionLocal()
    try:
        page = db.query(Page).filter(Page.lines_detected == True).first()
        if not page:
            pytest.skip("No page with lines_detected in DB")
        model = db.query(Model).filter(Model.type == "recognition").first()
        model_id = model.id if model else None
    finally:
        db.close()

    app.dependency_overrides[get_db] = _real_get_db
    try:
        with patch("app.config.USE_BACKGROUND_TASKS", False):
            with patch("app.api.inference.USE_BACKGROUND_TASKS", False):
                with TestClient(app) as client:
                    resp = client.post(
                        "/api/inference/run",
                        json={"page_ids": [page.id], "model_id": model_id},
                    )
                    assert resp.status_code == 200, resp.text
                    data = resp.json()
                    assert "task_id" in data

                    tasks_resp = client.get("/api/tasks")
                    assert tasks_resp.status_code == 200, tasks_resp.text
    finally:
        app.dependency_overrides.clear()
