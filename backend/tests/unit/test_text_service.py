"""Tests for text service (Unicode normalization)."""
import pytest
from app.services.text_service import (
    normalize_text,
    normalize_lines,
    is_normalized,
    detect_normalization_issues,
    strip_diacritics,
)


class TestUnicodeNormalization:
    """Test Unicode NFC normalization."""
    
    def test_normalize_empty_string(self):
        assert normalize_text("") == ""
        assert normalize_text(None) is None
    
    def test_normalize_ascii(self):
        text = "Hello World"
        assert normalize_text(text) == text
    
    def test_normalize_hebrew(self):
        # Basic Hebrew without nikkud
        text = "שלום עולם"
        result = normalize_text(text)
        assert result == text
        assert is_normalized(result)
    
    def test_normalize_hebrew_with_nikkud(self):
        # Hebrew with vowel points
        text = "שָׁלוֹם"
        result = normalize_text(text)
        assert is_normalized(result)
    
    def test_normalize_lines(self):
        lines = [
            {"line_number": 0, "text": "שלום"},
            {"line_number": 1, "text": "עולם", "notes": "note"},
        ]
        result = normalize_lines(lines)
        assert len(result) == 2
        assert all(is_normalized(l.get("text", "")) for l in result)
    
    def test_is_normalized(self):
        assert is_normalized("") is True
        assert is_normalized("Hello") is True
        assert is_normalized("שלום") is True
    
    def test_detect_normalization_issues(self):
        # Normal text should have no issues
        assert detect_normalization_issues("Hello") is None
        assert detect_normalization_issues("שלום") is None
    
    def test_strip_diacritics(self):
        # Hebrew with nikkud
        text_with_nikkud = "שָׁלוֹם"
        result = strip_diacritics(text_with_nikkud)
        # Should remove vowel points
        assert "ָ" not in result
        assert "ֹ" not in result
