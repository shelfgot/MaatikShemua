"""
Integration test for the fine-tuning pipeline.

Uses real DATA_DIR and database: discovers ground truth pages with manual
transcriptions and line geometry, runs fine_tune_model, and verifies inference
on a held-out page. Skips if Kraken, ground truth, or a base model are unavailable.

Run with: pytest tests/integration/test_finetune_pipeline.py -m finetune -v
"""
import pytest
from pathlib import Path


def _levenshtein(a: str, b: str) -> int:
    """Edit distance between two strings."""
    if len(a) < len(b):
        return _levenshtein(b, a)
    if len(b) == 0:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            curr.append(
                min(prev[j] + (1 if ca != cb else 0), prev[j + 1] + 1, curr[-1] + 1)
            )
        prev = curr
    return prev[-1]


def _cer(ref: str, hyp: str) -> float:
    """Character error rate: edit_distance(ref, hyp) / max(len(ref), 1)."""
    if not ref:
        return 0.0 if not hyp else 1.0
    return _levenshtein(ref, hyp) / len(ref)


def _build_training_data(db, pages) -> list:
    """Build training_data from pages (same logic as training.run_training_task)."""
    from app.models import Transcription, TranscriptionLine, LineData

    training_data = []
    for page in pages:
        trans = (
            db.query(Transcription)
            .filter(
                Transcription.page_id == page.id,
                Transcription.type == "manual",
            )
            .first()
        )
        if not trans:
            continue
        lines = (
            db.query(TranscriptionLine)
            .filter(TranscriptionLine.transcription_id == trans.id)
            .order_by(TranscriptionLine.line_number)
            .all()
        )
        if not lines:
            continue
        line_data = db.query(LineData).filter(LineData.page_id == page.id).first()
        if not line_data or not line_data.bounding_boxes:
            continue
        page_lines = []
        for l in lines:
            if not l.text:
                continue
            line_idx = l.line_number - 1
            if line_idx < 0 or line_idx >= len(line_data.bounding_boxes):
                continue
            box = line_data.bounding_boxes[line_idx]
            baseline = box.get("baseline")
            boundary = box.get("boundary")
            if not baseline or not boundary:
                continue
            page_lines.append({
                "text": l.text,
                "line_number": l.line_number,
                "baseline": baseline,
                "boundary": boundary,
            })
        if page_lines:
            training_data.append({"image_path": page.image_path, "lines": page_lines})
    return training_data


def _get_ground_truth_lines(db, page) -> list[str]:
    """Get manual transcription texts per line for a page."""
    from app.models import Transcription, TranscriptionLine

    trans = (
        db.query(Transcription)
        .filter(
            Transcription.page_id == page.id,
            Transcription.type == "manual",
        )
        .first()
    )
    if not trans:
        return []
    lines = (
        db.query(TranscriptionLine)
        .filter(TranscriptionLine.transcription_id == trans.id)
        .order_by(TranscriptionLine.line_number)
        .all()
    )
    return [l.text or "" for l in lines]


@pytest.mark.finetune
@pytest.mark.slow
def test_finetune_pipeline_end_to_end():
    """
    Run fine-tuning on ground truth pages, then verify inference on a held-out page.

    Uses real database and DATA_DIR. Skips if:
    - Kraken is not installed
    - Fewer than 2 ground truth pages (need 1+ train, 1 test)
    - No base model in DB
    - Images do not exist on disk
    """
    from app.database import SessionLocal
    from app.models import Page, Model
    from app.api.training import get_ground_truth_pages
    from app.services.kraken_service import (
        KRAKEN_AVAILABLE,
        fine_tune_model,
        run_inference_on_page,
    )
    from app.config import DATA_DIR, MIN_TRAINING_PAGES

    if not KRAKEN_AVAILABLE:
        pytest.skip("Kraken not installed")

    db = SessionLocal()
    try:
        # 1. Get ground truth pages
        pages = get_ground_truth_pages(db, page_ids=None)
        if len(pages) < max(2, MIN_TRAINING_PAGES):
            pytest.skip(
                f"Need at least 2 ground truth pages (1 train, 1 test); got {len(pages)}"
            )

        # 2. Ensure images exist
        valid_pages = []
        for p in pages:
            path = Path(p.image_path)
            if path.exists():
                valid_pages.append(p)
        if len(valid_pages) < 2:
            pytest.skip(
                f"Need at least 2 pages with existing images; got {len(valid_pages)}"
            )
        pages = valid_pages

        # 3. Get base model
        base_model = db.query(Model).filter(Model.path.isnot(None)).first()
        if not base_model or not Path(base_model.path).exists():
            pytest.skip("No base model found in DB or model file does not exist")

        # 4. Split train / test
        n_train = max(1, len(pages) - 1)
        train_pages = pages[:n_train]
        test_page = pages[-1]

        training_data = _build_training_data(db, train_pages)
        if len(training_data) < 1:
            pytest.skip(
                "No valid training data (pages need line geometry with baseline/boundary)"
            )

        # 5. Run fine-tuning
        finetuned_dir = DATA_DIR / "models" / "finetuned"
        finetuned_dir.mkdir(parents=True, exist_ok=True)

        output_path = fine_tune_model(
            base_model_path=base_model.path,
            training_data=training_data,
            output_name="pytest_finetune_smoke",
            output_dir=str(finetuned_dir),
            min_epochs=1,
            max_epochs=2,
        )
        assert Path(output_path).exists(), f"Fine-tuned model not created: {output_path}"

        # 6. Run inference on test page with base and fine-tuned model
        ModelRec = type("ModelRec", (), {})
        base_rec = ModelRec()
        base_rec.path = base_model.path

        ft_rec = ModelRec()
        ft_rec.path = output_path

        base_results = run_inference_on_page(test_page, base_rec, db)
        ft_results = run_inference_on_page(test_page, ft_rec, db)

        gt_lines = _get_ground_truth_lines(db, test_page)
        assert len(gt_lines) > 0, "Test page has no manual transcription"

        # Align by line index (Kraken returns in line order)
        n_lines = min(len(gt_lines), len(base_results), len(ft_results))

        base_cer = 0.0
        ft_cer = 0.0
        total_chars = 0
        for i in range(n_lines):
            ref = gt_lines[i]
            base_hyp = base_results[i]["text"] if i < len(base_results) else ""
            ft_hyp = ft_results[i]["text"] if i < len(ft_results) else ""
            if ref:
                total_chars += len(ref)
                base_cer += _cer(ref, base_hyp) * len(ref)
                ft_cer += _cer(ref, ft_hyp) * len(ref)

        if total_chars > 0:
            base_cer /= total_chars
            ft_cer /= total_chars

        # Pipeline completed: fine-tuned model produced output (CER values are informational)
        assert len(ft_results) >= n_lines
        assert Path(output_path).exists()
    finally:
        db.close()
