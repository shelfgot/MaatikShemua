"""Text import service for importing transcriptions from text files."""
import re
from typing import Dict, List, Optional, Tuple

from app.services.text_service import normalize_text
from app.core.logging import logger


def is_page_identifier(line: str) -> bool:
    """Check if a line looks like a page/folio identifier.
    
    Common patterns:
    - "304b", "45v", "12r" (folio numbers with recto/verso)
    - "fol. 34", "f. 12v" (folio abbreviations)
    - Short alphanumeric identifiers
    """
    line = line.strip()
    
    # Too long to be a page identifier
    if len(line) > 20:
        return False
    
    # Empty line is not an identifier
    if not line:
        return False
    
    # Folio patterns: 304b, 45v, 12r, etc.
    if re.match(r'^\d+[abrvאבגד]?$', line, re.IGNORECASE):
        return True
    
    # Folio with prefix: fol. 34, f. 12v, folio 34b
    if re.match(r'^(fol\.?|f\.?|folio)\s*\d+[abrvאבגד]?$', line, re.IGNORECASE):
        return True
    
    # Hebrew folio notation: דף א, דף ב
    if re.match(r'^דף\s+[א-ת]+$', line):
        return True
    
    return False


def parse_text_import(content: str, skip_page_identifier: bool = True) -> List[Dict]:
    """Parse text file content into pages with lines.
    
    Expected format:
    Page 1
    line 1 text
    line 2 text
    
    Page 2
    line 1 text
    ...
    
    If skip_page_identifier is True, the first line is skipped if it looks
    like a page/folio identifier (e.g., "304b", "45v").
    """
    
    pages = []
    current_page = None
    current_lines = []
    
    lines = content.split('\n')
    
    for line in lines:
        line = line.rstrip()
        
        # Check for page marker
        page_match = re.match(r'^Page\s+(\d+)\s*$', line, re.IGNORECASE)
        
        if page_match:
            # Save previous page
            if current_page is not None:
                pages.append({
                    "page_number": current_page,
                    "lines": current_lines,
                })
            
            # Start new page
            current_page = int(page_match.group(1))
            current_lines = []
        
        elif current_page is not None:
            # Add line to current page (skip empty lines at start)
            if line or current_lines:
                current_lines.append({
                    "line_number": len(current_lines),
                    "text": normalize_text(line),
                })
    
    # Save last page
    if current_page is not None:
        pages.append({
            "page_number": current_page,
            "lines": current_lines,
        })
    
    # If no page markers found, treat as single page
    if not pages and lines:
        # Filter non-empty lines
        non_empty = [l.rstrip() for l in lines if l.strip()]
        
        # Optionally skip first line if it's a page identifier
        start_idx = 0
        if skip_page_identifier and non_empty and is_page_identifier(non_empty[0]):
            logger.info(
                "skipping_page_identifier",
                identifier=non_empty[0]
            )
            start_idx = 1
        
        pages.append({
            "page_number": 1,
            "lines": [
                {"line_number": i, "text": normalize_text(line)}
                for i, line in enumerate(non_empty[start_idx:])
            ],
        })
    
    logger.info("text_import_parsed", pages=len(pages))
    
    return pages


def validate_import_against_pages(
    import_data: List[Dict],
    existing_pages: List[int]
) -> Tuple[List[Dict], List[str]]:
    """Validate import data against existing pages.
    
    Returns (valid_data, warnings).
    """
    
    valid_data = []
    warnings = []
    existing_set = set(existing_pages)
    
    for page_data in import_data:
        page_num = page_data["page_number"]
        
        if page_num in existing_set:
            valid_data.append(page_data)
        else:
            warnings.append(f"Page {page_num} not found in document")
    
    return valid_data, warnings


def import_text_to_transcriptions(
    content: str,
    document_id: int,
    db
) -> Dict:
    """Import text content to manual transcriptions."""
    from app.models import Page, Transcription, TranscriptionLine
    from app.services.version_service import save_version
    from datetime import datetime
    
    # Parse content
    import_data = parse_text_import(content)
    
    # Get existing pages
    pages = db.query(Page).filter(Page.document_id == document_id).all()
    page_map = {p.page_number: p for p in pages}
    
    # Validate
    valid_data, warnings = validate_import_against_pages(
        import_data,
        list(page_map.keys())
    )
    
    # Import to each page
    imported_pages = []
    for page_data in valid_data:
        page = page_map[page_data["page_number"]]
        
        # Get or create manual transcription
        trans = db.query(Transcription).filter(
            Transcription.page_id == page.id,
            Transcription.type == "manual"
        ).first()
        
        if not trans:
            trans = Transcription(
                page_id=page.id,
                type="manual",
                source="imported",
            )
            db.add(trans)
            db.flush()
        else:
            # Save current state as version
            existing_lines = db.query(TranscriptionLine).filter(
                TranscriptionLine.transcription_id == trans.id
            ).all()
            if existing_lines:
                snapshot = [
                    {"line_number": l.line_number, "text": l.text, "notes": l.notes}
                    for l in existing_lines
                ]
                save_version(db, trans.id, snapshot, "Before import")
            
            trans.source = "imported"
            
            # Delete existing lines
            db.query(TranscriptionLine).filter(
                TranscriptionLine.transcription_id == trans.id
            ).delete()
        
        trans.updated_at = datetime.utcnow()
        
        # Add imported lines
        for line_data in page_data["lines"]:
            line = TranscriptionLine(
                transcription_id=trans.id,
                line_number=line_data["line_number"],
                display_order=line_data["line_number"],
                text=line_data["text"],
            )
            db.add(line)
        
        # Save as new version
        save_version(db, trans.id, page_data["lines"], "Imported from file")
        
        imported_pages.append(page_data["page_number"])
    
    db.commit()
    
    logger.info(
        "text_imported",
        document_id=document_id,
        pages_imported=len(imported_pages)
    )
    
    return {
        "imported_pages": imported_pages,
        "warnings": warnings,
    }
