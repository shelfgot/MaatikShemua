"""Tests for export service."""
import pytest
from app.services.export_service import (
    export_text,
    export_tei_xml,
    escape_xml,
    convert_paleographic_to_tei,
    ExportOptions,
    apply_line_endings,
)
from app.schemas.schemas import TextEncoding, LineEnding


class TestExportService:
    """Test export functionality."""
    
    @pytest.fixture
    def sample_transcriptions(self):
        return [
            {
                "page_number": 1,
                "lines": [
                    {"line_number": 0, "text": "שלום עולם", "confidence": 0.95},
                    {"line_number": 1, "text": "זוהי שורה שנייה", "confidence": 0.8},
                ]
            },
            {
                "page_number": 2,
                "lines": [
                    {"line_number": 0, "text": "עמוד שני", "confidence": None},
                ]
            }
        ]
    
    def test_export_text_basic(self, sample_transcriptions):
        options = ExportOptions()
        result = export_text(sample_transcriptions, options)
        
        assert isinstance(result, bytes)
        text = result.decode('utf-8-sig')
        
        assert "Page 1" in text
        assert "שלום עולם" in text
        assert "Page 2" in text
    
    def test_export_text_with_line_numbers(self, sample_transcriptions):
        options = ExportOptions(include_line_numbers=True)
        result = export_text(sample_transcriptions, options)
        text = result.decode('utf-8-sig')
        
        assert "  0. שלום עולם" in text
    
    def test_export_text_with_confidence(self, sample_transcriptions):
        options = ExportOptions(include_confidence=True)
        result = export_text(sample_transcriptions, options)
        text = result.decode('utf-8-sig')
        
        assert "[95%]" in text
    
    def test_apply_line_endings_lf(self):
        text = "line1\r\nline2\rline3\nline4"
        result = apply_line_endings(text, LineEnding.LF)
        assert "\r" not in result
        assert result == "line1\nline2\nline3\nline4"
    
    def test_apply_line_endings_crlf(self):
        text = "line1\nline2"
        result = apply_line_endings(text, LineEnding.CRLF)
        assert result == "line1\r\nline2"
    
    def test_escape_xml(self):
        assert escape_xml("<test>") == "&lt;test&gt;"
        assert escape_xml("a & b") == "a &amp; b"
        assert escape_xml('"quote"') == "&quot;quote&quot;"


class TestPaleographicConversion:
    """Test paleographic markup to TEI conversion."""
    
    def test_lacuna_with_text(self):
        result = convert_paleographic_to_tei("[unclear text]")
        assert "<unclear>unclear text</unclear>" in result
    
    def test_lacuna_empty(self):
        result = convert_paleographic_to_tei("[...]")
        assert '<gap reason="illegible"/>' in result
    
    def test_addition(self):
        result = convert_paleographic_to_tei("⟨added text⟩")
        assert "<supplied>added text</supplied>" in result
    
    def test_deletion(self):
        result = convert_paleographic_to_tei("{deleted}")
        assert "<del>deleted</del>" in result
    
    def test_uncertain(self):
        result = convert_paleographic_to_tei("word?")
        assert "<unclear>word</unclear>" in result
    
    def test_combined_markup(self):
        result = convert_paleographic_to_tei("[unclear] and ⟨added⟩")
        assert "<unclear>" in result or "<gap" in result
        assert "<supplied>added</supplied>" in result
