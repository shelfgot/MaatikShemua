"""Shared inference workflow (sync) for API thread pool and Celery worker."""
from typing import List, Optional

from app.database import SessionLocal
from app.models import Page, Model, BackgroundTask, Transcription, TranscriptionLine
from app.services.kraken_service import run_inference_on_page
from app.core.logging import logger


def run_inference_sync(
    task_id: str,
    page_ids: List[int],
    model_id: Optional[int],
) -> None:
    """
    Run OCR inference on pages and persist as model transcriptions.
    Safe to call from a thread or Celery worker.
    """
    db = SessionLocal()
    try:
        task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
        if not task:
            logger.error("inference_task_not_found", task_id=task_id)
            return
        task.status = "running"
        db.commit()

        total = len(page_ids)
        results = []

        for i, page_id in enumerate(page_ids):
            try:
                task.progress = {
                    "current": i + 1,
                    "total": total,
                    "page_id": page_id,
                    "status": "processing",
                }
                db.commit()

                page = db.query(Page).filter(Page.id == page_id).first()
                if not page:
                    results.append({"page_id": page_id, "status": "error", "error": "Page not found"})
                    continue

                if not page.lines_detected:
                    results.append({"page_id": page_id, "status": "error", "error": "Lines not detected"})
                    continue

                if model_id:
                    model = db.query(Model).filter(Model.id == model_id).first()
                else:
                    model = db.query(Model).filter(
                        Model.type == "recognition",
                        Model.is_default == True,
                    ).first()

                if not model:
                    results.append({"page_id": page_id, "status": "error", "error": "No recognition model available"})
                    continue

                inference_result = run_inference_on_page(page, model, db)

                trans = db.query(Transcription).filter(
                    Transcription.page_id == page_id,
                    Transcription.type == "model",
                ).first()

                if not trans:
                    trans = Transcription(
                        page_id=page_id,
                        type="model",
                        model_version=model.kraken_version,
                    )
                    db.add(trans)
                    db.flush()
                else:
                    from app.services.version_service import save_version

                    existing_lines = (
                        db.query(TranscriptionLine)
                        .filter(TranscriptionLine.transcription_id == trans.id)
                        .order_by(TranscriptionLine.line_number)
                        .all()
                    )
                    if existing_lines:
                        lines_snapshot = [
                            {
                                "line_number": l.line_number,
                                "text": l.text,
                                "confidence": l.confidence,
                                "notes": l.notes,
                            }
                            for l in existing_lines
                        ]
                        save_version(
                            db,
                            trans.id,
                            lines_snapshot,
                            f"Previous inference (model: {trans.model_version or 'unknown'})",
                        )
                    trans.model_version = model.kraken_version
                    db.query(TranscriptionLine).filter(
                        TranscriptionLine.transcription_id == trans.id
                    ).delete()

                for j, line_result in enumerate(inference_result):
                    line = TranscriptionLine(
                        transcription_id=trans.id,
                        line_number=j,
                        display_order=j,
                        text=line_result.get("text", ""),
                        confidence=line_result.get("confidence"),
                    )
                    db.add(line)

                db.commit()
                results.append({
                    "page_id": page_id,
                    "status": "success",
                    "line_count": len(inference_result),
                })
                logger.info("inference_page_complete", page_id=page_id, line_count=len(inference_result))

            except Exception as e:
                logger.error("inference_page_error", page_id=page_id, error=str(e))
                results.append({"page_id": page_id, "status": "error", "error": str(e)})
                db.rollback()

        task.status = "completed"
        task.progress = {"current": total, "total": total, "status": "completed"}
        task.result = {"results": results}
        db.commit()
        logger.info("inference_task_complete", task_id=task_id, processed=len(results))

    except Exception as e:
        task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
        if task:
            task.status = "failed"
            task.error = {"message": str(e)}
            db.commit()
        logger.error("inference_task_failed", task_id=task_id, error=str(e))
    finally:
        db.close()
