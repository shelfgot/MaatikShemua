"""Celery tasks for model inference."""
from typing import List, Optional

from app.tasks import celery
from app.core.logging import logger


@celery.task(bind=True, name="run_inference")
def run_inference_task(
    self,
    task_id: str,
    page_ids: List[int],
    model_id: Optional[int] = None,
):
    """
    Run OCR inference on multiple pages.

    task_id: API-created BackgroundTask id (so the API can return it to the client).
    Uses the same workflow as the API (run_inference_sync) for consistency.
    """
    from app.services.inference_service import run_inference_sync

    try:
        run_inference_sync(task_id, page_ids, model_id)
    except Exception as e:
        logger.exception("inference_task_failed", task_id=task_id, error=str(e))
        raise
