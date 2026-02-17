from pathlib import Path


def test_delete_page_handles_dzi_tiles_path(client, db, sample_document, tmp_path: Path):
    from app.models import Page

    # Create fake image and tiles artifacts
    image_path = tmp_path / "page.png"
    image_path.write_bytes(b"fake")

    tiles_dir = tmp_path / "tiles" / "mykey"
    tiles_dir.mkdir(parents=True, exist_ok=True)
    dzi_file = tiles_dir / "image.dzi"
    dzi_file.write_text("dzi")

    page = Page(
        document_id=sample_document.id,
        page_number=1,
        image_path=str(image_path),
        tiles_path=str(dzi_file),
        lines_detected=False,
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    resp = client.delete(f"/api/pages/{page.id}")
    assert resp.status_code == 200, resp.text

    # Page removed from DB
    assert db.query(Page).filter(Page.id == page.id).first() is None

    # Files removed
    assert not image_path.exists()
    assert not tiles_dir.exists()

