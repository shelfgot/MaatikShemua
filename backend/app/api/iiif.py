"""IIIF manifest import API endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Document, Page
from app.schemas import DocumentResponse
from app.schemas.schemas import IIIFImportRequest
from app.services.iiif_service import fetch_and_parse_manifest, download_iiif_images
from app.core.security import validate_external_url
from app.core.errors import ValidationError, ExternalServiceError
from app.core.logging import logger
from app.config import DATA_DIR

router = APIRouter(prefix="/api/documents", tags=["iiif"])


@router.post("/iiif", response_model=DocumentResponse)
async def import_from_iiif(
    request: IIIFImportRequest,
    db: Session = Depends(get_db)
):
    """Import document from IIIF manifest."""
    # Validate URL (SSRF prevention)
    validate_external_url(request.manifest_url)
    
    logger.info("iiif_import_started", manifest_url=request.manifest_url)
    
    try:
        # Fetch and parse manifest
        manifest_data = fetch_and_parse_manifest(request.manifest_url)
    except Exception as e:
        raise ExternalServiceError(
            f"Failed to fetch IIIF manifest: {str(e)}",
            details={"url": request.manifest_url}
        )
    
    # Create document
    document = Document(
        name=manifest_data.get("label", "IIIF Import"),
        shelfmark=manifest_data.get("shelfmark"),
        repository=manifest_data.get("repository"),
        doc_metadata={
            "iiif_manifest_url": request.manifest_url,
            "iiif_metadata": manifest_data.get("metadata", {}),
        }
    )
    db.add(document)
    db.flush()
    
    # Create pages directory
    pages_dir = DATA_DIR / "pages" / str(document.id)
    pages_dir.mkdir(parents=True, exist_ok=True)
    
    # Download images and create page records
    images = manifest_data.get("images", [])
    for i, image_info in enumerate(images):
        image_url = image_info.get("url")
        
        # Download image
        try:
            image_path = download_iiif_images(
                image_url,
                str(pages_dir),
                f"page_{i+1:04d}.png"
            )
        except Exception as e:
            logger.warning("iiif_image_download_failed", page=i+1, error=str(e))
            continue
        
        page = Page(
            document_id=document.id,
            page_number=i + 1,
            image_path=image_path,
            iiif_image_url=image_url,
        )
        db.add(page)
    
    db.commit()
    
    page_count = db.query(Page).filter(Page.document_id == document.id).count()
    
    logger.info("iiif_import_complete", document_id=document.id, page_count=page_count)
    
    return DocumentResponse(
        id=document.id,
        name=document.name,
        shelfmark=document.shelfmark,
        repository=document.repository,
        metadata=document.doc_metadata,
        created_at=document.created_at,
        page_count=page_count,
    )
