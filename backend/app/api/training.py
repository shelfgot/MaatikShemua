"""Model training/fine-tuning API endpoints."""
import asyncio
from uuid import uuid4
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Page, Model, BackgroundTask, Transcription, TranscriptionLine, LineData
from app.schemas.schemas import TrainingRequest
from app.services.kraken_service import fine_tune_model
from app.core.errors import NotFoundError, ValidationError
from app.core.logging import logger
from app.config import DATA_DIR, MIN_TRAINING_PAGES, USE_BACKGROUND_TASKS

router = APIRouter(prefix="/api/training", tags=["training"])


def get_ground_truth_pages(db: Session, page_ids: Optional[List[int]] = None) -> List[Page]:
    """Get pages suitable for training (ground truth with manual transcriptions).
    
    Includes pages that:
    1. Have lines detected
    2. Have manual transcriptions (not copied from model)
    3. Have at least one non-empty transcription line
    4. Optionally: are explicitly marked as ground truth (preferred but not required)
    """
    # Start with pages that have lines detected
    query = db.query(Page).filter(
        Page.lines_detected == True,
    )
    
    if page_ids:
        query = query.filter(Page.id.in_(page_ids))
    
    pages = query.all()
    
    # Filter to pages with manual transcriptions not copied from model
    valid_pages = []
    for page in pages:
        trans = db.query(Transcription).filter(
            Transcription.page_id == page.id,
            Transcription.type == "manual",
            Transcription.source != "copied_from_model"
        ).first()
        
        if trans:
            # Check if has transcription lines with actual text
            line_count = db.query(TranscriptionLine).filter(
                TranscriptionLine.transcription_id == trans.id,
                TranscriptionLine.text != None,
                TranscriptionLine.text != ""
            ).count()
            
            if line_count > 0:
                valid_pages.append(page)
    
    return valid_pages


def _run_training_sync(
    task_id: str,
    model_id: int,
    new_model_name: str,
    page_ids: Optional[List[int]],
) -> None:
    """Synchronous fine-tune implementation (run in thread or Celery worker)."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
        task.status = "running"
        task.progress = {"status": "preparing", "message": "Gathering training data"}
        db.commit()
        
        # Get base model
        base_model = db.query(Model).filter(Model.id == model_id).first()
        if not base_model:
            raise ValueError(f"Model {model_id} not found")
        
        # Get ground truth pages
        pages = get_ground_truth_pages(db, page_ids)
        if len(pages) < MIN_TRAINING_PAGES:
            raise ValueError(f"Insufficient training data: {len(pages)} pages (minimum {MIN_TRAINING_PAGES})")
        
        task.progress = {"status": "training", "message": f"Training on {len(pages)} pages"}
        db.commit()
        
        # Prepare training data: each page needs image_path and lines with text + baseline/boundary for Kraken
        training_data = []
        for page in pages:
            trans = db.query(Transcription).filter(
                Transcription.page_id == page.id,
                Transcription.type == "manual"
            ).first()
            if not trans:
                continue
            lines = db.query(TranscriptionLine).filter(
                TranscriptionLine.transcription_id == trans.id
            ).order_by(TranscriptionLine.line_number).all()
            if not lines:
                continue
            line_data = db.query(LineData).filter(LineData.page_id == page.id).first()
            if not line_data or not line_data.bounding_boxes:
                continue
            page_lines = []
            for l in lines:
                if not l.text:
                    continue
                line_idx = l.line_number - 1
                if line_idx < 0 or line_idx >= len(line_data.bounding_boxes):
                    continue
                box = line_data.bounding_boxes[line_idx]
                baseline = box.get("baseline")
                boundary = box.get("boundary")
                if not baseline or not boundary:
                    continue
                page_lines.append({
                    "text": l.text,
                    "line_number": l.line_number,
                    "baseline": baseline,
                    "boundary": boundary,
                })
            if page_lines:
                training_data.append({
                    "image_path": page.image_path,
                    "lines": page_lines,
                })
        
        if len(training_data) < MIN_TRAINING_PAGES:
            raise ValueError(
                f"Insufficient training data with line geometry: {len(training_data)} pages "
                f"(minimum {MIN_TRAINING_PAGES}). Ensure pages have line detection and manual transcriptions."
            )
        
        # Run fine-tuning
        # Save to DATA_DIR/models/finetuned to ensure separation from base models
        finetuned_models_dir = DATA_DIR / "models" / "finetuned"
        finetuned_models_dir.mkdir(parents=True, exist_ok=True)
        
        def _progress_callback(current_epoch: int, max_epochs: int):
            t = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
            if t:
                t.progress = {"phase": "training", "current": current_epoch, "total": max_epochs}
                db.commit()
        
        new_model_path = fine_tune_model(
            base_model_path=base_model.path,
            training_data=training_data,
            output_name=new_model_name,
            output_dir=str(finetuned_models_dir),
            progress_callback=_progress_callback,
        )
        
        # Unique display name so multiple runs don't collide in the UI
        display_name = f"{new_model_name} ({datetime.now().strftime('%Y-%m-%d %H:%M')})"
        
        # Create new model record
        from app.services.kraken_service import get_kraken_version
        
        new_model = Model(
            name=display_name,
            path=new_model_path,
            type=base_model.type,
            description=f"Fine-tuned from {base_model.name}",
            kraken_version=get_kraken_version(),
            training_metadata={
                "base_model_id": model_id,
                "base_model_name": base_model.name,
                "training_pages": len(pages),
                "page_ids": [p.id for p in pages],
                "trained_at": datetime.utcnow().isoformat(),
            }
        )
        db.add(new_model)
        db.commit()
        
        # Complete task
        task.status = "completed"
        task.progress = {"status": "completed", "message": "Training complete"}
        task.result = {
            "model_id": new_model.id,
            "model_name": display_name,
            "model_path": new_model_path,
            "training_pages": len(pages),
        }
        db.commit()
        
        logger.info("training_complete", task_id=task_id, new_model_id=new_model.id)
        
    except Exception as e:
        task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
        if task:
            task.status = "failed"
            task.error = {"message": str(e)}
            db.commit()
        logger.error("training_failed", task_id=task_id, error=str(e))
    finally:
        db.close()


async def _run_training_in_thread(
    task_id: str,
    model_id: int,
    new_model_name: str,
    page_ids: Optional[List[int]],
) -> None:
    """Schedule training in a thread and return immediately so the event loop is not blocked."""
    asyncio.create_task(
        asyncio.to_thread(_run_training_sync, task_id, model_id, new_model_name, page_ids)
    )


@router.post("/finetune")
async def start_finetuning(
    request: TrainingRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Start fine-tuning a model."""
    # Validate base model exists
    base_model = db.query(Model).filter(Model.id == request.model_id).first()
    if not base_model:
        raise NotFoundError(f"Model {request.model_id} not found")
    
    # Validate we have enough ground truth data
    pages = get_ground_truth_pages(db, request.page_ids)
    if len(pages) < MIN_TRAINING_PAGES:
        raise ValidationError(
            f"Insufficient training data: {len(pages)} pages (minimum {MIN_TRAINING_PAGES} required)",
            details={"available_pages": len(pages), "minimum_required": MIN_TRAINING_PAGES}
        )
    
    # Check for data leakage
    for page in pages:
        trans = db.query(Transcription).filter(
            Transcription.page_id == page.id,
            Transcription.type == "manual"
        ).first()
        if trans and trans.source == "copied_from_model":
            raise ValidationError(
                f"Page {page.id} has transcription copied from model - data leakage risk",
                details={"page_id": page.id}
            )
    
    # Create task record (same id returned to client for both Celery and in-process)
    task_id = str(uuid4())
    task = BackgroundTask(
        id=task_id,
        type="training",
        status="pending",
        progress={"status": "pending", "message": "Initializing"},
    )
    db.add(task)
    db.commit()

    page_id_list = [p.id for p in pages]

    if USE_BACKGROUND_TASKS:
        from app.tasks.training_tasks import finetune_model_task
        finetune_model_task.delay(
            task_id,
            request.model_id,
            page_id_list,
            request.name,
        )
    else:
        background_tasks.add_task(
            _run_training_in_thread,
            task_id,
            request.model_id,
            request.name,
            request.page_ids,
        )

    logger.info("training_started", task_id=task_id, base_model_id=request.model_id)
    return {
        "task_id": task_id,
        "status": "pending",
        "training_pages": len(pages),
    }


@router.get("/ground-truth-pages")
async def get_available_ground_truth(
    db: Session = Depends(get_db)
):
    """Get list of pages available for training."""
    pages = get_ground_truth_pages(db)
    
    return {
        "count": len(pages),
        "minimum_required": MIN_TRAINING_PAGES,
        "pages": [
            {
                "id": p.id,
                "document_id": p.document_id,
                "page_number": p.page_number,
            }
            for p in pages
        ]
    }
