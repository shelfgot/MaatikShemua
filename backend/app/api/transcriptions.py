"""Transcription management API endpoints."""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Page, LineData, Transcription, TranscriptionLine, TranscriptionVersion
from app.schemas import (
    TranscriptionUpdate, 
    TranscriptionResponse, 
    TranscriptionVersionResponse,
)
from app.schemas.schemas import TranscriptionLineResponse, TranscriptionSource
from app.services.text_service import normalize_lines
from app.services.version_service import save_version
from app.core.errors import NotFoundError, ValidationError
from app.core.logging import logger

router = APIRouter(prefix="/api/pages/{page_id}/transcriptions", tags=["transcriptions"])


def get_or_create_transcription(db: Session, page_id: int, trans_type: str) -> Transcription:
    """Get existing transcription or create new one."""
    transcription = (
        db.query(Transcription)
        .filter(Transcription.page_id == page_id, Transcription.type == trans_type)
        .first()
    )
    
    if not transcription:
        transcription = Transcription(
            page_id=page_id,
            type=trans_type,
            source=TranscriptionSource.MANUAL.value if trans_type == "manual" else None,
        )
        db.add(transcription)
        db.flush()
    
    return transcription


@router.get("/{trans_type}", response_model=TranscriptionResponse)
async def get_transcription(
    page_id: int,
    trans_type: str,
    db: Session = Depends(get_db)
):
    """Get transcription for a page (manual or model)."""
    if trans_type not in ("manual", "model"):
        raise ValidationError("Type must be 'manual' or 'model'")
    
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    
    transcription = (
        db.query(Transcription)
        .filter(Transcription.page_id == page_id, Transcription.type == trans_type)
        .first()
    )
    
    if not transcription:
        # Return empty transcription
        return TranscriptionResponse(
            id=0,
            page_id=page_id,
            type=trans_type,
            source=None,
            model_version=None,
            updated_at=datetime.utcnow(),
            lines=[],
        )
    
    lines = (
        db.query(TranscriptionLine)
        .filter(TranscriptionLine.transcription_id == transcription.id)
        .order_by(TranscriptionLine.display_order, TranscriptionLine.line_number)
        .all()
    )
    
    return TranscriptionResponse(
        id=transcription.id,
        page_id=transcription.page_id,
        type=transcription.type,
        source=transcription.source,
        model_version=transcription.model_version,
        updated_at=transcription.updated_at,
        lines=[
            TranscriptionLineResponse(
                id=line.id,
                line_number=line.line_number,
                display_order=line.display_order,
                text=line.text,
                confidence=line.confidence,
                notes=line.notes,
            )
            for line in lines
        ],
    )


@router.put("/manual", response_model=TranscriptionResponse)
async def update_manual_transcription(
    page_id: int,
    update: TranscriptionUpdate,
    db: Session = Depends(get_db)
):
    """Update manual transcription."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    
    # Normalize all text
    normalized_lines = normalize_lines([
        {"line_number": l.line_number, "text": l.text, "notes": l.notes}
        for l in update.lines
    ])
    
    # Get or create transcription
    transcription = get_or_create_transcription(db, page_id, "manual")
    transcription.source = update.source.value if update.source else TranscriptionSource.MANUAL.value
    transcription.updated_at = datetime.utcnow()
    
    # Save version for history (with deduplication)
    lines_for_version = [
        {"line_number": l["line_number"], "text": l["text"], "notes": l.get("notes")}
        for l in normalized_lines
    ]
    save_version(db, transcription.id, lines_for_version, "Auto-save")
    
    # Delete existing lines
    db.query(TranscriptionLine).filter(
        TranscriptionLine.transcription_id == transcription.id
    ).delete()
    
    # Create new lines
    for i, line_data in enumerate(update.lines):
        line = TranscriptionLine(
            transcription_id=transcription.id,
            line_number=line_data.line_number,
            display_order=line_data.display_order or i,
            text=normalized_lines[i]["text"],
            notes=line_data.notes,
        )
        db.add(line)

    # Auto-mark ground truth when fully transcribed (do not auto-unset).
    # Uses the same definition as manual_transcription_percent: filled manual lines / detected lines.
    if not page.is_ground_truth:
        ld = db.query(LineData).filter(LineData.page_id == page_id).first()
        total_lines = len(ld.bounding_boxes) if ld and ld.bounding_boxes else 0
        filled_lines = sum(1 for l in normalized_lines if (l.get("text") or "").strip() != "")
        if total_lines > 0 and filled_lines >= total_lines:
            page.is_ground_truth = True
    
    db.commit()
    
    logger.info("transcription_updated", page_id=page_id, line_count=len(update.lines))
    
    # Return updated transcription
    return await get_transcription(page_id, "manual", db)


@router.get("/{trans_type}/versions", response_model=List[TranscriptionVersionResponse])
async def get_transcription_versions(
    page_id: int,
    trans_type: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    include_snapshot: bool = Query(False),
    db: Session = Depends(get_db)
):
    """Get version history for a transcription."""
    if trans_type not in ("manual", "model"):
        raise ValidationError("Type must be 'manual' or 'model'")
    
    transcription = (
        db.query(Transcription)
        .filter(Transcription.page_id == page_id, Transcription.type == trans_type)
        .first()
    )
    
    if not transcription:
        return []
    
    versions = (
        db.query(TranscriptionVersion)
        .filter(TranscriptionVersion.transcription_id == transcription.id)
        .order_by(TranscriptionVersion.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    
    return [
        TranscriptionVersionResponse(
            id=v.id,
            transcription_id=v.transcription_id,
            content_hash=v.content_hash,
            created_at=v.created_at,
            change_summary=v.change_summary,
            lines_snapshot=v.lines_snapshot if include_snapshot else None,
        )
        for v in versions
    ]


@router.post("/restore/{version_id}", response_model=TranscriptionResponse)
async def restore_transcription_version(
    page_id: int,
    version_id: int,
    db: Session = Depends(get_db)
):
    """Restore transcription from a version."""
    version = db.query(TranscriptionVersion).filter(TranscriptionVersion.id == version_id).first()
    if not version:
        raise NotFoundError(f"Version {version_id} not found")
    
    transcription = db.query(Transcription).filter(Transcription.id == version.transcription_id).first()
    if not transcription or transcription.page_id != page_id:
        raise ValidationError("Version does not belong to this page")
    
    # Save current state as version before restoring
    current_lines = (
        db.query(TranscriptionLine)
        .filter(TranscriptionLine.transcription_id == transcription.id)
        .all()
    )
    current_snapshot = [
        {"line_number": l.line_number, "text": l.text, "notes": l.notes}
        for l in current_lines
    ]
    save_version(db, transcription.id, current_snapshot, "Before restore")
    
    # Delete current lines
    db.query(TranscriptionLine).filter(
        TranscriptionLine.transcription_id == transcription.id
    ).delete()
    
    # Restore from version
    for i, line_data in enumerate(version.lines_snapshot):
        line = TranscriptionLine(
            transcription_id=transcription.id,
            line_number=line_data.get("line_number", i),
            display_order=i,
            text=line_data.get("text", ""),
            notes=line_data.get("notes"),
        )
        db.add(line)
    
    # Save restored state as new version
    save_version(db, transcription.id, version.lines_snapshot, f"Restored from version {version_id}")
    
    transcription.updated_at = datetime.utcnow()
    db.commit()
    
    logger.info("transcription_restored", page_id=page_id, version_id=version_id)
    
    return await get_transcription(page_id, transcription.type, db)


@router.post("/copy-to-manual", response_model=TranscriptionResponse)
async def copy_model_to_manual(
    page_id: int,
    db: Session = Depends(get_db)
):
    """Copy model transcription to manual transcription."""
    # Get model transcription
    model_trans = (
        db.query(Transcription)
        .filter(Transcription.page_id == page_id, Transcription.type == "model")
        .first()
    )
    
    if not model_trans:
        raise NotFoundError("No model transcription for this page")
    
    model_lines = (
        db.query(TranscriptionLine)
        .filter(TranscriptionLine.transcription_id == model_trans.id)
        .order_by(TranscriptionLine.line_number)
        .all()
    )
    
    # Get or create manual transcription
    manual_trans = get_or_create_transcription(db, page_id, "manual")
    manual_trans.source = TranscriptionSource.COPIED_FROM_MODEL.value
    manual_trans.updated_at = datetime.utcnow()
    
    # Save current manual state as version
    current_lines = (
        db.query(TranscriptionLine)
        .filter(TranscriptionLine.transcription_id == manual_trans.id)
        .all()
    )
    if current_lines:
        current_snapshot = [
            {"line_number": l.line_number, "text": l.text, "notes": l.notes}
            for l in current_lines
        ]
        save_version(db, manual_trans.id, current_snapshot, "Before copy from model")
    
    # Delete existing manual lines
    db.query(TranscriptionLine).filter(
        TranscriptionLine.transcription_id == manual_trans.id
    ).delete()
    
    # Copy model lines to manual
    for line in model_lines:
        new_line = TranscriptionLine(
            transcription_id=manual_trans.id,
            line_number=line.line_number,
            display_order=line.display_order,
            text=line.text,
            confidence=None,  # Clear confidence for manual
            notes=line.notes,
        )
        db.add(new_line)
    
    # Save as new version
    new_snapshot = [
        {"line_number": l.line_number, "text": l.text, "notes": l.notes}
        for l in model_lines
    ]
    save_version(db, manual_trans.id, new_snapshot, "Copied from model")
    
    db.commit()
    
    logger.info("transcription_copied_from_model", page_id=page_id)
    
    return await get_transcription(page_id, "manual", db)
