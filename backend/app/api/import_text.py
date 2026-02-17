"""Text import API endpoints."""
from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Document
from app.schemas.schemas import TextImportRequest
from app.services.import_service import import_text_to_transcriptions, parse_text_import
from app.core.errors import NotFoundError, ValidationError
from app.core.logging import logger

router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("/text")
async def import_text(
    document_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Import transcription from a text file.
    
    Expected format:
    Page 1
    line 1 text
    line 2 text
    
    Page 2
    line 1 text
    ...
    """
    # Validate document exists
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise NotFoundError(f"Document {document_id} not found")
    
    # Validate file type
    if not file.filename.endswith('.txt'):
        raise ValidationError("Only .txt files are supported")
    
    # Read file content
    content = await file.read()
    try:
        text_content = content.decode('utf-8')
    except UnicodeDecodeError:
        try:
            text_content = content.decode('utf-8-sig')  # UTF-8 with BOM
        except UnicodeDecodeError:
            raise ValidationError("File must be UTF-8 encoded")
    
    # Import transcriptions
    result = import_text_to_transcriptions(text_content, document_id, db)
    
    logger.info(
        "text_import_completed",
        document_id=document_id,
        pages_imported=len(result["imported_pages"])
    )
    
    return result


@router.post("/text/preview")
async def preview_text_import(
    file: UploadFile = File(...),
):
    """Preview text import parsing without saving."""
    content = await file.read()
    try:
        text_content = content.decode('utf-8')
    except UnicodeDecodeError:
        text_content = content.decode('utf-8-sig')
    
    pages = parse_text_import(text_content)
    
    return {
        "pages": [
            {
                "page_number": p["page_number"],
                "line_count": len(p["lines"]),
                "preview": [l["text"][:50] for l in p["lines"][:5]],
            }
            for p in pages
        ]
    }
