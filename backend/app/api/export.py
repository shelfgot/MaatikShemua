"""Export API endpoints."""
from io import BytesIO
from typing import List
from zipfile import ZipFile, ZIP_DEFLATED

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Document, Page, Transcription, TranscriptionLine
from app.schemas.schemas import ExportFormat, TextEncoding, LineEnding, TranscriptionType
from app.services.export_service import (
    export_text,
    export_alto_xml,
    export_pagexml,
    export_tei_xml,
    ExportOptions,
)
from app.core.errors import NotFoundError
from app.core.logging import logger

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/{doc_id}")
async def export_document(
    doc_id: int,
    format: ExportFormat = Query(ExportFormat.TEXT),
    type: TranscriptionType = Query(TranscriptionType.MANUAL),
    encoding: TextEncoding = Query(TextEncoding.UTF8_BOM),
    line_ending: LineEnding = Query(LineEnding.LF),
    include_page_headers: bool = Query(True),
    include_line_numbers: bool = Query(False),
    include_confidence: bool = Query(False),
    db: Session = Depends(get_db)
):
    """Export document transcriptions."""
    document = db.query(Document).filter(Document.id == doc_id).first()
    if not document:
        raise NotFoundError(f"Document {doc_id} not found")

    # Get all pages with transcriptions
    pages = (
        db.query(Page)
        .filter(Page.document_id == doc_id)
        .order_by(Page.page_number)
        .all()
    )

    transcriptions_data = _collect_page_transcriptions(
        db=db,
        pages=pages,
        transcription_type=type,
    )

    options = ExportOptions(
        encoding=encoding,
        line_ending=line_ending,
        include_page_headers=include_page_headers,
        include_line_numbers=include_line_numbers,
        include_confidence=include_confidence,
    )

    document_data = {
        "name": document.name,
        "shelfmark": document.shelfmark,
        "repository": document.repository,
        "metadata": document.doc_metadata,
    }

    content, media_type, ext = _render_export_blob(
        document_data=document_data,
        transcriptions_data=transcriptions_data,
        export_format=format,
        options=options,
    )

    filename = f"{document.name}.{ext}"

    logger.info(
        "document_exported",
        doc_id=doc_id,
        format=format.value,
        pages=len(transcriptions_data),
    )

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/pages/export")
async def export_selected_pages(
    ids: str = Query(..., description="Comma-separated list of page IDs"),
    format: ExportFormat = Query(ExportFormat.TEXT),
    type: TranscriptionType = Query(TranscriptionType.MANUAL),
    encoding: TextEncoding = Query(TextEncoding.UTF8_BOM),
    line_ending: LineEnding = Query(LineEnding.LF),
    include_page_headers: bool = Query(True),
    include_line_numbers: bool = Query(False),
    include_confidence: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Export selected pages as a ZIP of per-page exports."""
    try:
      page_ids: List[int] = [
          int(pid) for pid in ids.split(",") if pid.strip()
      ]
    except ValueError:
        raise NotFoundError("Invalid page id in ids parameter")

    if not page_ids:
        raise NotFoundError("No page ids provided")

    # Bound the number of pages to avoid enormous ZIPs in memory
    max_pages = 200
    if len(page_ids) > max_pages:
        raise NotFoundError(f"Too many pages requested (max {max_pages})")

    pages = (
        db.query(Page)
        .filter(Page.id.in_(page_ids))
        .order_by(Page.document_id, Page.page_number)
        .all()
    )

    if not pages:
        raise NotFoundError("No pages found for given ids")

    # Group pages by document so filenames are informative
    options = ExportOptions(
        encoding=encoding,
        line_ending=line_ending,
        include_page_headers=include_page_headers,
        include_line_numbers=include_line_numbers,
        include_confidence=include_confidence,
    )

    zip_buffer = BytesIO()
    with ZipFile(zip_buffer, mode="w", compression=ZIP_DEFLATED) as zf:
        for page in pages:
            document = db.query(Document).filter(Document.id == page.document_id).first()
            if not document:
                continue

            transcriptions_data = _collect_page_transcriptions(
                db=db,
                pages=[page],
                transcription_type=type,
            )

            if not transcriptions_data:
                # Skip pages without any transcription of this type
                continue

            document_data = {
                "name": document.name,
                "shelfmark": document.shelfmark,
                "repository": document.repository,
                "metadata": document.doc_metadata,
            }

            content, _media_type, ext = _render_export_blob(
                document_data=document_data,
                transcriptions_data=transcriptions_data,
                export_format=format,
                options=options,
            )

            safe_doc_name = document.name.replace("/", "_").replace("\\", "_")
            filename = f"doc-{document.id}_{safe_doc_name}_page-{page.page_number}.{ext}"
            zf.writestr(filename, content)

    zip_buffer.seek(0)

    logger.info(
        "pages_exported",
        page_ids=page_ids,
        format=format.value,
        count=len(pages),
    )

    def iterfile():
        # Yield the ZIP archive as a single bytes chunk
        yield zip_buffer.getvalue()

    return StreamingResponse(
        iterfile(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="pages_export.zip"'
        },
    )


def _collect_page_transcriptions(
    db: Session,
    pages: List[Page],
    transcription_type: TranscriptionType,
):
    """Helper to gather transcription data for one or more pages."""
    transcriptions_data = []
    for page in pages:
        trans = (
            db.query(Transcription)
            .filter(
                Transcription.page_id == page.id,
                Transcription.type == transcription_type.value,
            )
            .first()
        )

        if not trans:
            continue

        lines = (
            db.query(TranscriptionLine)
            .filter(TranscriptionLine.transcription_id == trans.id)
            .order_by(
                TranscriptionLine.display_order,
                TranscriptionLine.line_number,
            )
            .all()
        )

        transcriptions_data.append(
            {
                "page_id": page.id,
                "page_number": page.page_number,
                "lines": [
                    {
                        "line_number": l.line_number,
                        "text": l.text or "",
                        "confidence": l.confidence,
                        "notes": l.notes,
                    }
                    for l in lines
                ],
            }
        )

    return transcriptions_data


def _render_export_blob(
    document_data,
    transcriptions_data,
    export_format: ExportFormat,
    options: ExportOptions,
):
    """Render a single export blob (bytes plus metadata) for given pages."""
    if export_format == ExportFormat.TEXT:
        content = export_text(transcriptions_data, options)
        media_type = f"text/plain; charset={options.encoding.value}"
        ext = "txt"
    elif export_format == ExportFormat.ALTO:
        content = export_alto_xml(document_data, transcriptions_data, options)
        media_type = f"application/xml; charset={options.encoding.value}"
        ext = "alto.xml"
    elif export_format == ExportFormat.PAGEXML:
        content = export_pagexml(document_data, transcriptions_data, options, )
        media_type = f"application/xml; charset={options.encoding.value}"
        ext = "page.xml"
    elif export_format == ExportFormat.TEI:
        content = export_tei_xml(document_data, transcriptions_data, options)
        media_type = f"application/tei+xml; charset={options.encoding.value}"
        ext = "tei.xml"
    else:
        raise NotFoundError(f"Unknown format: {export_format}")

    return content, media_type, ext

