"""Version history service with deduplication."""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from sqlalchemy.orm import Session

from app.models import TranscriptionVersion
from app.config import VERSION_RETENTION_DAYS, MAX_VERSIONS_PER_TRANSCRIPTION
from app.core.logging import logger


def compute_content_hash(lines: List[Dict]) -> str:
    """Compute hash of transcription content for deduplication."""
    content = json.dumps(lines, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(content.encode()).hexdigest()


def save_version(
    db: Session,
    transcription_id: int,
    lines: List[Dict],
    change_summary: str = "Auto-save"
) -> Optional[TranscriptionVersion]:
    """Save version only if content changed (deduplication)."""
    
    content_hash = compute_content_hash(lines)
    
    # Check if identical version already exists
    existing = db.query(TranscriptionVersion).filter_by(
        transcription_id=transcription_id,
        content_hash=content_hash
    ).first()
    
    if existing:
        # Update timestamp of existing version instead of creating new
        existing.created_at = datetime.utcnow()
        db.commit()
        logger.debug("version_deduplicated", transcription_id=transcription_id)
        return None  # No new version created
    
    # Create new version
    version = TranscriptionVersion(
        transcription_id=transcription_id,
        content_hash=content_hash,
        lines_snapshot=lines,
        change_summary=change_summary
    )
    db.add(version)
    db.commit()
    
    logger.debug("version_created", transcription_id=transcription_id, hash=content_hash[:8])
    
    # Apply retention policy
    apply_retention_policy(db, transcription_id)
    
    return version


def apply_retention_policy(db: Session, transcription_id: int):
    """Remove old versions beyond retention period and max count."""
    
    cutoff_date = datetime.utcnow() - timedelta(days=VERSION_RETENTION_DAYS)
    
    # Get all versions ordered by date
    versions = db.query(TranscriptionVersion).filter_by(
        transcription_id=transcription_id
    ).order_by(TranscriptionVersion.created_at.desc()).all()
    
    if len(versions) <= MAX_VERSIONS_PER_TRANSCRIPTION:
        return
    
    # Keep significant versions (imports, restores, etc.)
    significant_summaries = {
        "Imported from file",
        "Copied from model",
        "Restored from version",
        "Before restore",
        "Before copy from model",
    }
    
    deleted_count = 0
    for version in versions[MAX_VERSIONS_PER_TRANSCRIPTION:]:
        # Keep significant versions regardless of age
        if version.change_summary in significant_summaries:
            continue
        
        # Delete old auto-saves
        if version.created_at < cutoff_date:
            db.delete(version)
            deleted_count += 1
    
    if deleted_count > 0:
        db.commit()
        logger.debug(
            "versions_cleaned",
            transcription_id=transcription_id,
            deleted=deleted_count
        )


def get_version_history(
    db: Session,
    transcription_id: int,
    offset: int = 0,
    limit: int = 20
) -> List[TranscriptionVersion]:
    """Get version history for a transcription."""
    return (
        db.query(TranscriptionVersion)
        .filter_by(transcription_id=transcription_id)
        .order_by(TranscriptionVersion.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
