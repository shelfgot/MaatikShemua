"""Document management API endpoints."""
import os
import shutil
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Document, Page
from app.schemas import DocumentCreate, DocumentUpdate, DocumentResponse, DocumentListResponse, PageListResponse, PageResponse
from app.services.image_service import process_uploaded_file
from app.core.errors import NotFoundError, ValidationError
from app.core.logging import logger
from app.config import DATA_DIR

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    shelfmark: Optional[str] = Form(None),
    repository: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """Upload a document (PDF, TIFF, or images)."""
    
    # Validate file type
    allowed_extensions = {'.pdf', '.tif', '.tiff', '.png', '.jpg', '.jpeg'}
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        raise ValidationError(
            f"Unsupported file type: {file_ext}",
            details={"allowed": list(allowed_extensions)}
        )
    
    # Create document
    doc_name = name or Path(file.filename).stem
    document = Document(
        name=doc_name,
        shelfmark=shelfmark,
        repository=repository,
    )
    db.add(document)
    db.flush()  # Get the ID
    
    logger.info("document_created", document_id=document.id, name=doc_name)
    
    # Create directory for pages
    pages_dir = DATA_DIR / "pages" / str(document.id)
    pages_dir.mkdir(parents=True, exist_ok=True)
    
    # Save uploaded file temporarily
    temp_path = pages_dir / f"upload{file_ext}"
    try:
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        # Process file and extract pages
        pages_data = process_uploaded_file(str(temp_path), str(pages_dir), document.id, original_filename=file.filename)
        
        # Create page records
        for page_data in pages_data:
            page = Page(
                document_id=document.id,
                page_number=page_data["page_number"],
                image_path=page_data["image_path"],
                tiles_path=page_data.get("tiles_path"),
                color_space=page_data.get("color_space"),
                original_dpi=page_data.get("original_dpi"),
            )
            db.add(page)
        
        db.commit()
        
        logger.info("document_upload_complete", document_id=document.id, page_count=len(pages_data))
        
    finally:
        # Clean up temp file
        if temp_path.exists():
            temp_path.unlink()
    
    # Return response with page count
    response = DocumentResponse(
        id=document.id,
        name=document.name,
        shelfmark=document.shelfmark,
        repository=document.repository,
        metadata=document.doc_metadata,
        created_at=document.created_at,
        page_count=len(pages_data),
    )
    return response


@router.post("/{document_id}/pages", response_model=PageResponse)
async def add_page_to_document(
    document_id: int,
    file: UploadFile = File(...),
    page_number: Optional[int] = Form(None),
    db: Session = Depends(get_db)
):
    """Add a page to an existing document."""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise NotFoundError(f"Document {document_id} not found")
    
    # Validate file type
    allowed_extensions = {'.pdf', '.tif', '.tiff', '.png', '.jpg', '.jpeg'}
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        raise ValidationError(
            f"Unsupported file type: {file_ext}",
            details={"allowed": list(allowed_extensions)}
        )
    
    # Determine page number (append to end if not specified)
    if page_number is None:
        max_page = db.query(Page).filter(Page.document_id == document_id).order_by(Page.page_number.desc()).first()
        page_number = (max_page.page_number + 1) if max_page else 1
    
    # Create directory for pages
    pages_dir = DATA_DIR / "pages" / str(document_id)
    pages_dir.mkdir(parents=True, exist_ok=True)
    
    # Save uploaded file temporarily
    temp_path = pages_dir / f"upload_{page_number}{file_ext}"
    try:
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        # Process file and extract pages
        pages_data = process_uploaded_file(str(temp_path), str(pages_dir), document_id, original_filename=file.filename)
        
        # Create page records (update page numbers) with dedup by image_path
        created_pages: List[Page] = []
        first_existing: Optional[Page] = None
        next_page_number = page_number
        for page_data in pages_data:
            existing = db.query(Page).filter(
                Page.document_id == document_id,
                Page.image_path == page_data["image_path"],
            ).first()
            if existing:
                if first_existing is None:
                    first_existing = existing
                continue

            page = Page(
                document_id=document_id,
                page_number=next_page_number,
                image_path=page_data["image_path"],
                tiles_path=page_data.get("tiles_path"),
                color_space=page_data.get("color_space"),
                original_dpi=page_data.get("original_dpi"),
            )
            db.add(page)
            created_pages.append(page)
            next_page_number += 1
        
        db.commit()
        
        logger.info(
            "pages_added",
            document_id=document_id,
            page_count=len(created_pages),
            skipped_duplicates=(len(pages_data) - len(created_pages)),
        )
        
        page_for_response = created_pages[0] if created_pages else first_existing
        if not page_for_response:
            raise ValidationError("No new pages were created (all uploads were duplicates).")

        # Return the first created page (or first duplicate found)
        return PageResponse(
            id=page_for_response.id,
            document_id=page_for_response.document_id,
            page_number=page_for_response.page_number,
            image_path=page_for_response.image_path,
            tiles_path=page_for_response.tiles_path,
            iiif_image_url=page_for_response.iiif_image_url,
            color_space=page_for_response.color_space,
            original_dpi=page_for_response.original_dpi,
            lines_detected=page_for_response.lines_detected,
            is_ground_truth=page_for_response.is_ground_truth,
            line_order_mode=page_for_response.line_order_mode,
        )
        
    finally:
        # Clean up temp file
        if temp_path.exists():
            temp_path.unlink()


@router.post("/upload/bulk", response_model=DocumentResponse)
async def upload_document_bulk(
    files: List[UploadFile] = File(...),
    name: Optional[str] = Form(None),
    shelfmark: Optional[str] = Form(None),
    repository: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """Upload a document from multiple files at once."""
    # Validate file types
    allowed_extensions = {'.pdf', '.tif', '.tiff', '.png', '.jpg', '.jpeg'}
    for file in files:
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in allowed_extensions:
            raise ValidationError(
                f"Unsupported file type: {file_ext}",
                details={"allowed": list(allowed_extensions), "file": file.filename}
            )
    
    # Create document
    doc_name = name or Path(files[0].filename).stem
    document = Document(
        name=doc_name,
        shelfmark=shelfmark,
        repository=repository,
    )
    db.add(document)
    db.flush()  # Get the ID
    
    logger.info("document_created", document_id=document.id, name=doc_name)
    
    # Create directory for pages
    pages_dir = DATA_DIR / "pages" / str(document.id)
    pages_dir.mkdir(parents=True, exist_ok=True)
    
    all_pages_data = []
    page_number = 1
    
    try:
        for file in files:
            file_ext = Path(file.filename).suffix.lower()
            temp_path = pages_dir / f"upload_{page_number}{file_ext}"
            
            # Save uploaded file temporarily
            with open(temp_path, "wb") as f:
                content = await file.read()
                f.write(content)
            
            # Process file and extract pages
            pages_data = process_uploaded_file(str(temp_path), str(pages_dir), document.id, original_filename=file.filename)
            
            # Update page numbers to be sequential
            seen_paths = {p["image_path"] for p in all_pages_data}
            for page_data in pages_data:
                if page_data.get("image_path") in seen_paths:
                    continue
                page_data["page_number"] = page_number
                page_number += 1
                all_pages_data.append(page_data)
                seen_paths.add(page_data.get("image_path"))
            
            # Clean up temp file
            if temp_path.exists():
                temp_path.unlink()
        
        # Create page records
        for page_data in all_pages_data:
            page = Page(
                document_id=document.id,
                page_number=page_data["page_number"],
                image_path=page_data["image_path"],
                tiles_path=page_data.get("tiles_path"),
                color_space=page_data.get("color_space"),
                original_dpi=page_data.get("original_dpi"),
            )
            db.add(page)
        
        db.commit()
        
        logger.info("document_upload_complete", document_id=document.id, page_count=len(all_pages_data))
        
    except Exception as e:
        db.rollback()
        # Clean up document directory on error
        if pages_dir.exists():
            shutil.rmtree(pages_dir)
        raise ValidationError(f"Failed to process files: {str(e)}")
    
    # Return response with page count
    response = DocumentResponse(
        id=document.id,
        name=document.name,
        shelfmark=document.shelfmark,
        repository=document.repository,
        metadata=document.doc_metadata,
        created_at=document.created_at,
        page_count=len(all_pages_data),
    )
    return response


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """List all documents with pagination."""
    total = db.query(Document).count()
    documents = db.query(Document).offset(offset).limit(limit).all()
    
    items = []
    for doc in documents:
        page_count = db.query(Page).filter(Page.document_id == doc.id).count()
        items.append(DocumentResponse(
            id=doc.id,
            name=doc.name,
            shelfmark=doc.shelfmark,
            repository=doc.repository,
            metadata=doc.doc_metadata,
            created_at=doc.created_at,
            page_count=page_count,
        ))
    
    return DocumentListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: int,
    db: Session = Depends(get_db)
):
    """Get document by ID."""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise NotFoundError(f"Document {document_id} not found")
    
    page_count = db.query(Page).filter(Page.document_id == document_id).count()
    
    return DocumentResponse(
        id=document.id,
        name=document.name,
        shelfmark=document.shelfmark,
        repository=document.repository,
        metadata=document.doc_metadata,
        created_at=document.created_at,
        page_count=page_count,
    )


@router.put("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: int,
    update: DocumentUpdate,
    db: Session = Depends(get_db)
):
    """Update document metadata."""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise NotFoundError(f"Document {document_id} not found")
    
    if update.name is not None:
        document.name = update.name
    if update.shelfmark is not None:
        document.shelfmark = update.shelfmark
    if update.repository is not None:
        document.repository = update.repository
    if update.metadata is not None:
        document.doc_metadata = update.metadata
    
    db.commit()
    
    page_count = db.query(Page).filter(Page.document_id == document_id).count()
    
    return DocumentResponse(
        id=document.id,
        name=document.name,
        shelfmark=document.shelfmark,
        repository=document.repository,
        metadata=document.doc_metadata,
        created_at=document.created_at,
        page_count=page_count,
    )


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(get_db)
):
    """Delete document and all associated data."""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise NotFoundError(f"Document {document_id} not found")
    
    # Delete files
    pages_dir = DATA_DIR / "pages" / str(document_id)
    if pages_dir.exists():
        shutil.rmtree(pages_dir)
    
    # Delete from database (cascades to pages, transcriptions, etc.)
    db.delete(document)
    db.commit()
    
    logger.info("document_deleted", document_id=document_id)
    
    return {"status": "deleted", "document_id": document_id}


@router.get("/{document_id}/pages", response_model=PageListResponse)
async def get_document_pages(
    document_id: int,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    """Get pages for a document with pagination."""
    from app.models import Transcription, TranscriptionLine
    
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise NotFoundError(f"Document {document_id} not found")
    
    total = db.query(Page).filter(Page.document_id == document_id).count()
    pages = (
        db.query(Page)
        .filter(Page.document_id == document_id)
        .order_by(Page.page_number)
        .offset(offset)
        .limit(limit)
        .all()
    )
    
    items = []
    for page in pages:
        # Calculate transcription stats
        manual_trans = (
            db.query(Transcription)
            .filter(Transcription.page_id == page.id, Transcription.type == "manual")
            .first()
        )
        model_trans = (
            db.query(Transcription)
            .filter(Transcription.page_id == page.id, Transcription.type == "model")
            .first()
        )
        
        manual_percent = 0
        if manual_trans and page.line_data:
            total_lines = len(page.line_data.bounding_boxes) if page.line_data.bounding_boxes else 0
            if total_lines > 0:
                filled_lines = (
                    db.query(TranscriptionLine)
                    .filter(
                        TranscriptionLine.transcription_id == manual_trans.id,
                        TranscriptionLine.text != None,
                        TranscriptionLine.text != ""
                    )
                    .count()
                )
                manual_percent = (filled_lines / total_lines) * 100
        
        items.append(PageResponse(
            id=page.id,
            document_id=page.document_id,
            page_number=page.page_number,
            image_path=page.image_path,
            tiles_path=page.tiles_path,
            iiif_image_url=page.iiif_image_url,
            color_space=page.color_space,
            original_dpi=page.original_dpi,
            lines_detected=page.lines_detected,
            is_ground_truth=page.is_ground_truth,
            line_order_mode=page.line_order_mode,
            thumbnail_url=f"/api/pages/{page.id}/thumbnail",
            manual_transcription_percent=manual_percent,
            has_model_transcription=model_trans is not None,
        ))
    
    return PageListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
    )
