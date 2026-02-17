"""Backup API endpoints."""
from datetime import datetime
from pathlib import Path
import tempfile
from fastapi import APIRouter, Depends, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.backup_service import create_full_backup
from app.core.logging import logger
from app.config import DATA_DIR

router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("/export")
async def export_backup(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Generate and stream full project backup."""
    
    # Create backup in temporary location
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    temp_path = Path(temp_file.name)
    temp_file.close()
    
    try:
        manifest = create_full_backup(DATA_DIR, temp_path)
        
        # Stream file to client
        def iterfile():
            with open(temp_path, 'rb') as f:
                while chunk := f.read(65536):  # 64KB chunks
                    yield chunk
        
        # Clean up after response
        def cleanup():
            try:
                temp_path.unlink()
            except:
                pass
        
        background_tasks.add_task(cleanup)
        
        filename = f"maatik_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        
        logger.info("backup_exported", filename=filename)
        
        return StreamingResponse(
            iterfile(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        temp_path.unlink()
        logger.error("backup_failed", error=str(e))
        raise
