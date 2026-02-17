"""Celery tasks for model fine-tuning."""
from typing import List, Optional
from app.tasks import celery
from app.core.logging import logger


@celery.task(bind=True, name="finetune_model", queue="finetune")
def finetune_model_task(
    self,
    task_id: str,
    base_model_id: int,
    page_ids: List[int],
    output_name: str,
    training_params: Optional[dict] = None,
):
    """
    Fine-tune a Kraken model using ground truth transcriptions.

    task_id: API-created BackgroundTask id (so the API can return it to the client).
    This task is designed for Celery workers with GPU access.
    """
    from app.database import SessionLocal
    from app.models import Page, Transcription, TranscriptionLine, Model, BackgroundTask
    from app.services.kraken_service import fine_tune_model
    from app.config import DATA_DIR
    from datetime import datetime
    import os

    db = SessionLocal()
    
    try:
        # Update task status
        db_task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
        if db_task:
            db_task.status = "running"
            db_task.progress = {"phase": "preparing", "current": 0, "total": len(page_ids)}
            db.commit()
        
        # Get base model
        base_model = db.query(Model).filter(Model.id == base_model_id).first()
        if not base_model:
            raise ValueError(f"Base model {base_model_id} not found")
        
        # Gather ground truth data
        ground_truth = []
        for i, page_id in enumerate(page_ids):
            # Update progress
            if db_task:
                db_task.progress = {
                    "phase": "gathering_data",
                    "current": i,
                    "total": len(page_ids)
                }
                db.commit()
            
            self.update_state(
                state="PROGRESS",
                meta={"phase": "gathering_data", "current": i, "total": len(page_ids)}
            )
            
            page = db.query(Page).filter(Page.id == page_id).first()
            if not page:
                logger.warning("page_not_found_for_training", page_id=page_id)
                continue

            # Get manual transcription (API pre-validates pages via get_ground_truth_pages)
            transcription = db.query(Transcription).filter(
                Transcription.page_id == page_id,
                Transcription.type == "manual"
            ).first()
            
            if not transcription:
                logger.warning("no_manual_transcription", page_id=page_id)
                continue
            
            # Check for data leakage - don't train on model-copied data
            if transcription.source == "copied_from_model":
                logger.warning(
                    "skipping_copied_transcription",
                    page_id=page_id,
                    reason="Data leakage prevention"
                )
                continue
            
            lines = db.query(TranscriptionLine).filter(
                TranscriptionLine.transcription_id == transcription.id
            ).order_by(TranscriptionLine.display_order).all()
            
            if not lines:
                continue
            
            # Build ground truth entry
            gt_entry = {
                "image_path": page.image_path,
                "lines": []
            }
            
            line_data = page.line_data
            if line_data and line_data.bounding_boxes:
                for line in lines:
                    if line.text:
                        line_idx = line.line_number - 1
                        if 0 <= line_idx < len(line_data.bounding_boxes):
                            gt_entry["lines"].append({
                                "text": line.text,
                                "baseline": line_data.bounding_boxes[line_idx].get("baseline"),
                                "boundary": line_data.bounding_boxes[line_idx].get("boundary")
                            })
            
            if gt_entry["lines"]:
                ground_truth.append(gt_entry)
        
        if not ground_truth:
            raise ValueError("No valid ground truth data found")
        
        logger.info(
            "training_data_gathered",
            page_count=len(ground_truth),
            total_lines=sum(len(gt["lines"]) for gt in ground_truth)
        )
        
        # Output directory for fine-tuned models (separate from base models)
        finetuned_models_dir = DATA_DIR / "models" / "finetuned"
        finetuned_models_dir.mkdir(parents=True, exist_ok=True)
        
        trainer_max_epochs = 100  # default; fine_tune_model uses 100 if not overridden
        if db_task:
            db_task.progress = {"phase": "training", "current": 0, "total": trainer_max_epochs}
            db.commit()
        self.update_state(
            state="PROGRESS",
            meta={"phase": "training", "current": 0, "total": trainer_max_epochs}
        )
        
        def progress_callback(current_epoch: int, max_epochs: int):
            if db_task:
                db_task.progress = {"phase": "training", "current": current_epoch, "total": max_epochs}
                db.commit()
            self.update_state(
                state="PROGRESS",
                meta={"phase": "training", "current": current_epoch, "total": max_epochs}
            )
        
        # Convert ground_truth format to training_data format expected by fine_tune_model
        training_data = []
        for gt in ground_truth:
            training_data.append({
                "image_path": gt["image_path"],
                "lines": gt["lines"]
            })
        
        # Call fine_tune_model which ensures output is saved as separate file
        output_path = fine_tune_model(
            base_model_path=base_model.path,
            training_data=training_data,
            output_name=output_name,
            output_dir=str(finetuned_models_dir),
            progress_callback=progress_callback,
        )
        
        training_result = {"metrics": {}}  # Placeholder - actual training would return metrics
        
        # Unique display name so multiple runs from same base don't collide in the UI
        display_name = f"{output_name} ({datetime.now().strftime('%Y-%m-%d %H:%M')})"
        
        # Register new model
        from app.services.kraken_service import KRAKEN_VERSION
        
        new_model = Model(
            name=display_name,
            path=output_path,  # output_path is already a string from fine_tune_model
            type="recognition",
            description=f"Fine-tuned from {base_model.name}",
            kraken_version=KRAKEN_VERSION,
            is_default=False,
            training_metadata={
                "base_model_id": base_model_id,
                "base_model_name": base_model.name,
                "base_model_path": base_model.path,  # Store original path for reference
                "page_count": len(ground_truth),
                "line_count": sum(len(gt["lines"]) for gt in ground_truth),
                "training_params": training_params,
                "metrics": training_result.get("metrics", {})
            }
        )
        db.add(new_model)
        db.commit()
        
        # Update task as completed
        if db_task:
            db_task.status = "completed"
            db_task.progress = {"phase": "completed", "current": 100, "total": 100}
            db_task.result = {
                "model_id": new_model.id,
                "model_name": display_name,
                "model_path": str(output_path),
                "pages_used": len(ground_truth),
                "metrics": training_result.get("metrics", {})
            }
            db.commit()
        
        logger.info(
            "training_completed",
            model_id=new_model.id,
            model_name=display_name
        )
        
        return {
            "status": "completed",
            "model_id": new_model.id,
            "model_name": display_name
        }
        
    except Exception as e:
        logger.exception("training_task_failed", error=str(e))
        if db_task:
            db_task.status = "failed"
            db_task.error = {"message": str(e)}
            db.commit()
        raise
    finally:
        db.close()
