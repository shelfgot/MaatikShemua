"""Tests for RTL line ordering."""
import pytest
from app.services.line_ordering import (
    get_line_center_x,
    get_line_y,
    cluster_lines_by_column,
    reorder_lines_for_rtl,
    reorder_lines_for_ltr,
)


class TestLineOrdering:
    """Test line ordering for RTL manuscripts."""
    
    @pytest.fixture
    def sample_lines(self):
        """Two-column layout with lines."""
        return [
            # Left column (x ~ 100)
            {"line_number": 0, "baseline": [[100, 50], [200, 50]], "boundary": [[100, 40], [200, 40], [200, 60], [100, 60]]},
            {"line_number": 1, "baseline": [[100, 100], [200, 100]], "boundary": [[100, 90], [200, 90], [200, 110], [100, 110]]},
            # Right column (x ~ 400)
            {"line_number": 2, "baseline": [[400, 50], [500, 50]], "boundary": [[400, 40], [500, 40], [500, 60], [400, 60]]},
            {"line_number": 3, "baseline": [[400, 100], [500, 100]], "boundary": [[400, 90], [500, 90], [500, 110], [400, 110]]},
        ]
    
    def test_get_line_center_x(self):
        line = {"baseline": [[100, 50], [200, 50]]}
        assert get_line_center_x(line) == 150
    
    def test_get_line_y(self):
        line = {"boundary": [[100, 40], [200, 40], [200, 60], [100, 60]]}
        assert get_line_y(line) == 40
    
    def test_cluster_lines_by_column(self, sample_lines):
        columns = cluster_lines_by_column(sample_lines)
        assert len(columns) == 2
    
    def test_reorder_rtl(self, sample_lines):
        """RTL order should have right column first."""
        reordered = reorder_lines_for_rtl(sample_lines)
        
        # Right column lines (2, 3) should come before left column (0, 1)
        # Within each column, top to bottom
        assert reordered[0]["line_number"] == 2  # Right column, top
        assert reordered[1]["line_number"] == 3  # Right column, bottom
        assert reordered[2]["line_number"] == 0  # Left column, top
        assert reordered[3]["line_number"] == 1  # Left column, bottom
    
    def test_reorder_ltr(self, sample_lines):
        """LTR order should have left column first."""
        reordered = reorder_lines_for_ltr(sample_lines)
        
        # Left column lines (0, 1) should come before right column (2, 3)
        assert reordered[0]["line_number"] == 0
        assert reordered[1]["line_number"] == 1
        assert reordered[2]["line_number"] == 2
        assert reordered[3]["line_number"] == 3
    
    def test_display_order_assigned(self, sample_lines):
        reordered = reorder_lines_for_rtl(sample_lines)
        for i, line in enumerate(reordered):
            assert line["display_order"] == i
    
    def test_empty_lines(self):
        assert reorder_lines_for_rtl([]) == []
        assert reorder_lines_for_ltr([]) == []
