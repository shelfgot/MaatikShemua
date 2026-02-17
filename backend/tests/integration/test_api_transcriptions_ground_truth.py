import pytest


def test_manual_transcription_full_marks_ground_truth(client, db, sample_page):
    # Create line data with 2 detected lines
    from app.models import LineData, Page

    sample_page.lines_detected = True
    db.add(sample_page)
    db.add(
        LineData(
            page_id=sample_page.id,
            bounding_boxes=[{"bbox": [0, 0, 10, 10]}, {"bbox": [0, 20, 10, 30]}],
            display_order=[0, 1],
        )
    )
    db.commit()

    resp = client.put(
        f"/api/pages/{sample_page.id}/transcriptions/manual",
        json={
            "lines": [
                {"line_number": 0, "display_order": 0, "text": "א"},
                {"line_number": 1, "display_order": 1, "text": "ב"},
            ],
            "source": "manual",
        },
    )
    assert resp.status_code == 200, resp.text

    page = db.query(Page).filter(Page.id == sample_page.id).first()
    assert page.is_ground_truth is True


def test_manual_transcription_partial_does_not_mark_ground_truth(client, db, sample_page):
    from app.models import LineData, Page

    sample_page.lines_detected = True
    db.add(sample_page)
    db.add(
        LineData(
            page_id=sample_page.id,
            bounding_boxes=[{"bbox": [0, 0, 10, 10]}, {"bbox": [0, 20, 10, 30]}],
            display_order=[0, 1],
        )
    )
    db.commit()

    resp = client.put(
        f"/api/pages/{sample_page.id}/transcriptions/manual",
        json={
            "lines": [
                {"line_number": 0, "display_order": 0, "text": "א"},
                {"line_number": 1, "display_order": 1, "text": ""},
            ],
            "source": "manual",
        },
    )
    assert resp.status_code == 200, resp.text

    page = db.query(Page).filter(Page.id == sample_page.id).first()
    assert page.is_ground_truth is False

