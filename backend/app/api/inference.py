"""Model inference API endpoints."""
import asyncio
from uuid import uuid4
from typing import List, Optional
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Page, Model, BackgroundTask, Transcription, TranscriptionLine
from app.schemas.schemas import InferenceRequest
from app.services.inference_service import run_inference_sync
from app.core.errors import NotFoundError, ValidationError
from app.core.logging import logger
from app.config import USE_BACKGROUND_TASKS

router = APIRouter(prefix="/api/inference", tags=["inference"])


async def _run_inference_in_thread(
    task_id: str,
    page_ids: List[int],
    model_id: Optional[int],
) -> None:
    """Schedule inference in a thread and return immediately so the event loop is not blocked."""
    asyncio.create_task(asyncio.to_thread(run_inference_sync, task_id, page_ids, model_id))


@router.post("/run")
async def start_inference(
    request: InferenceRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Start inference on selected pages."""
    if not request.page_ids:
        raise ValidationError("No pages specified")
    
    # Validate pages exist and have lines detected
    for page_id in request.page_ids:
        page = db.query(Page).filter(Page.id == page_id).first()
        if not page:
            raise NotFoundError(f"Page {page_id} not found")
        if not page.lines_detected:
            raise ValidationError(f"Page {page_id} has no detected lines")
    
    task_id = str(uuid4())
    task = BackgroundTask(
        id=task_id,
        type="inference",
        status="pending",
        progress={"current": 0, "total": len(request.page_ids), "status": "pending"},
    )
    db.add(task)
    db.commit()

    if USE_BACKGROUND_TASKS:
        from app.tasks.inference_tasks import run_inference_task
        run_inference_task.delay(task_id, request.page_ids, request.model_id)
    else:
        background_tasks.add_task(
            _run_inference_in_thread,
            task_id,
            request.page_ids,
            request.model_id,
        )

    logger.info("inference_started", task_id=task_id, page_count=len(request.page_ids))
    return {"task_id": task_id, "status": "pending"}
