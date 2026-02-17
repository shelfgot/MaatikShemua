from pathlib import Path


def _write_test_jpg(path: Path):
    from PIL import Image

    img = Image.new("RGB", (10, 10), color=(255, 0, 0))
    img.save(path, format="JPEG")


def test_process_uploaded_file_names_by_original_filename_and_hash(tmp_path: Path):
    from app.services.image_service import process_uploaded_file

    input_path = tmp_path / "My Page.JPG"
    _write_test_jpg(input_path)

    out_dir = tmp_path / "out"
    out_dir.mkdir()

    pages = process_uploaded_file(
        str(input_path),
        str(out_dir),
        document_id=1,
        original_filename="My Page.JPG",
    )
    assert len(pages) == 1
    image_path = Path(pages[0]["image_path"])

    # Uses slugified original name + short hash, and normalizes to PNG
    assert image_path.name.startswith("my_page-")
    assert image_path.suffix == ".png"
    assert image_path.exists()

    # Running again should dedupe to the same output path, not create a new one.
    pages2 = process_uploaded_file(
        str(input_path),
        str(out_dir),
        document_id=1,
        original_filename="My Page.JPG",
    )
    assert pages2[0]["image_path"] == pages[0]["image_path"]

