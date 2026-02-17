"""Page management API endpoints."""
import shutil
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Page, LineData, Document
from app.schemas import PageResponse, LineOrderUpdate
from app.schemas.schemas import LineOrderMode
from app.services.kraken_service import detect_lines_on_page
from app.services.line_ordering import reorder_lines_for_rtl, reorder_lines_for_ltr
from app.core.errors import NotFoundError, ValidationError
from app.core.logging import logger
from app.config import DATA_DIR

router = APIRouter(prefix="/api/pages", tags=["pages"])


def _resolve_page_file_path(page: Page, filename: str) -> Path:
    """Resolve path to a page file (image or thumbnail). Uses DATA_DIR when stored path does not exist (e.g. Docker vs host paths)."""
    stored_base = Path(page.image_path)
    candidate = stored_base.parent / filename
    if candidate.exists():
        return candidate
    pages_dir = DATA_DIR / "pages" / str(page.document_id)
    by_data_dir = pages_dir / filename
    if by_data_dir.exists():
        return by_data_dir
    # Fallback: stored path may use different naming (e.g. host path). Pick by page number from document folder.
    if not pages_dir.exists():
        raise NotFoundError(f"File not found: {filename}")
    pngs = sorted(p for p in pages_dir.glob("*.png") if "_thumb" not in p.stem)
    if not pngs:
        raise NotFoundError(f"File not found: {filename}")
    idx = page.page_number - 1
    if 0 <= idx < len(pngs):
        if "thumb" in filename.lower():
            thumb = pages_dir / f"{pngs[idx].stem}_thumb.jpg"
            if thumb.exists():
                return thumb
            raise NotFoundError(f"File not found: {filename}")
        return pngs[idx]
    raise NotFoundError(f"File not found: {filename}")


@router.get("/{page_id}", response_model=PageResponse)
async def get_page(
    page_id: int,
    db: Session = Depends(get_db)
):
    """Get page by ID."""
    from app.models import Transcription, TranscriptionLine
    
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    
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
    line_data = db.query(LineData).filter(LineData.page_id == page.id).first()
    if manual_trans and line_data:
        total_lines = len(line_data.bounding_boxes) if line_data.bounding_boxes else 0
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
    
    return PageResponse(
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
    )


@router.get("/{page_id}/image")
async def get_page_image(
    page_id: int,
    db: Session = Depends(get_db)
):
    """Get page image file."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    image_filename = Path(page.image_path).name
    image_path = _resolve_page_file_path(page, image_filename)
    return FileResponse(
        image_path,
        media_type="image/png",
        filename=f"page_{page.page_number}.png"
    )


@router.get("/{page_id}/thumbnail")
async def get_page_thumbnail(
    page_id: int,
    db: Session = Depends(get_db)
):
    """Get page thumbnail."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    thumb_filename = f"{Path(page.image_path).stem}_thumb.jpg"
    try:
        thumbnail_path = _resolve_page_file_path(page, thumb_filename)
        return FileResponse(thumbnail_path, media_type="image/jpeg")
    except NotFoundError:
        pass
    # Fall back to full image
    image_filename = Path(page.image_path).name
    image_path = _resolve_page_file_path(page, image_filename)
    return FileResponse(image_path, media_type="image/png")


@router.get("/{page_id}/tiles")
async def get_tiles_info(
    page_id: int,
    db: Session = Depends(get_db)
):
    """Get Deep Zoom tiles path for OpenSeadragon."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    
    if not page.tiles_path:
        raise NotFoundError("Tiles not generated for this page")
    
    return {"tiles_path": page.tiles_path}


@router.post("/{page_id}/detect-lines")
async def detect_lines(
    page_id: int,
    model_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Run line detection on a page."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    
    logger.info("line_detection_started", page_id=page_id)
    
    # Run line detection
    lines_data = detect_lines_on_page(page.image_path, model_id, db)
    
    # Apply RTL ordering if mode is set
    if page.line_order_mode == LineOrderMode.RTL.value:
        lines_data = reorder_lines_for_rtl(lines_data)
    
    # Store line data
    existing_line_data = db.query(LineData).filter(LineData.page_id == page_id).first()
    if existing_line_data:
        existing_line_data.bounding_boxes = lines_data
        existing_line_data.display_order = list(range(len(lines_data)))
    else:
        line_data = LineData(
            page_id=page_id,
            bounding_boxes=lines_data,
            display_order=list(range(len(lines_data))),
        )
        db.add(line_data)
    
    page.lines_detected = True
    db.commit()
    
    logger.info("line_detection_completed", page_id=page_id, line_count=len(lines_data))
    
    return {
        "page_id": page_id,
        "line_count": len(lines_data),
        "lines": lines_data,
    }


@router.post("/bulk/detect-lines")
async def bulk_detect_lines(
    page_ids: List[int],
    model_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Run line detection on multiple pages."""
    results = []
    for page_id in page_ids:
        try:
            result = await detect_lines(page_id, model_id, db)
            results.append({"page_id": page_id, "status": "success", "line_count": result["line_count"]})
        except Exception as e:
            results.append({"page_id": page_id, "status": "error", "error": str(e)})
    
    return {"results": results}


@router.get("/{page_id}/lines")
async def get_page_lines(
    page_id: int,
    db: Session = Depends(get_db)
):
    """Get detected line data for a page."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    
    line_data = db.query(LineData).filter(LineData.page_id == page_id).first()
    if not line_data:
        return {"page_id": page_id, "lines": [], "display_order": []}
    
    return {
        "page_id": page_id,
        "lines": line_data.bounding_boxes,
        "display_order": line_data.display_order,
    }


@router.put("/{page_id}/line-order")
async def update_line_order(
    page_id: int,
    order_update: LineOrderUpdate,
    db: Session = Depends(get_db)
):
    """Update line display order."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    
    line_data = db.query(LineData).filter(LineData.page_id == page_id).first()
    if not line_data:
        raise ValidationError("No line data for this page")
    
    page.line_order_mode = order_update.mode.value
    
    if order_update.mode == LineOrderMode.MANUAL and order_update.display_order:
        line_data.display_order = order_update.display_order
    elif order_update.mode == LineOrderMode.RTL:
        line_data.bounding_boxes = reorder_lines_for_rtl(line_data.bounding_boxes)
        line_data.display_order = list(range(len(line_data.bounding_boxes)))
    elif order_update.mode == LineOrderMode.LTR:
        line_data.bounding_boxes = reorder_lines_for_ltr(line_data.bounding_boxes)
        line_data.display_order = list(range(len(line_data.bounding_boxes)))
    
    db.commit()
    
    return {
        "page_id": page_id,
        "mode": page.line_order_mode,
        "display_order": line_data.display_order,
    }


@router.put("/{page_id}/ground-truth")
async def toggle_ground_truth(
    page_id: int,
    is_ground_truth: bool,
    db: Session = Depends(get_db)
):
    """Toggle ground truth flag for a page."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    
    page.is_ground_truth = is_ground_truth
    db.commit()
    
    logger.info("ground_truth_toggled", page_id=page_id, is_ground_truth=is_ground_truth)
    
    return {"page_id": page_id, "is_ground_truth": is_ground_truth}


@router.put("/bulk/ground-truth")
async def bulk_toggle_ground_truth(
    page_ids: List[int],
    is_ground_truth: bool,
    db: Session = Depends(get_db)
):
    """Toggle ground truth flag for multiple pages."""
    db.query(Page).filter(Page.id.in_(page_ids)).update(
        {Page.is_ground_truth: is_ground_truth},
        synchronize_session=False
    )
    db.commit()
    
    return {"page_ids": page_ids, "is_ground_truth": is_ground_truth}


@router.delete("/{page_id}")
async def delete_page(
    page_id: int,
    db: Session = Depends(get_db)
):
    """Delete a page from a document."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise NotFoundError(f"Page {page_id} not found")
    
    document_id = page.document_id
    
    # Delete page files
    image_path = Path(page.image_path)
    if image_path.exists():
        image_path.unlink()
    
    if page.tiles_path:
        tiles_path = Path(page.tiles_path)
        if tiles_path.exists():
            # tiles_path may be a DZI file (e.g. ".../tiles/<key>/image.dzi") or a directory.
            if tiles_path.is_dir():
                shutil.rmtree(tiles_path)
            else:
                # Remove the whole tiles folder for this page if possible.
                tiles_root = tiles_path.parent
                if tiles_root.exists() and tiles_root.is_dir():
                    shutil.rmtree(tiles_root)
                else:
                    tiles_path.unlink()
    
    # Delete from database (cascades to transcriptions, line_data, etc.)
    db.delete(page)
    db.commit()
    
    logger.info("page_deleted", page_id=page_id, document_id=document_id)
    
    return {"status": "deleted", "page_id": page_id}
