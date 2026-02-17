"""Text processing service with Unicode normalization."""
import unicodedata
from typing import Optional, List, Dict

# Use NFC normalization for Hebrew text
NORMALIZATION_FORM = "NFC"


def normalize_text(text: str) -> str:
    """Normalize text to NFC form for consistent storage."""
    if not text:
        return text
    return unicodedata.normalize(NORMALIZATION_FORM, text)


def normalize_lines(lines: List[Dict]) -> List[Dict]:
    """Normalize all text fields in transcription lines."""
    return [
        {
            **line,
            "text": normalize_text(line.get("text", "")),
            "notes": normalize_text(line.get("notes", "")) if line.get("notes") else None,
        }
        for line in lines
    ]


def is_normalized(text: str) -> bool:
    """Check if text is already in NFC form."""
    if not text:
        return True
    return unicodedata.is_normalized(NORMALIZATION_FORM, text)


def detect_normalization_issues(text: str) -> Optional[str]:
    """Detect potential normalization problems."""
    if not text:
        return None
    
    nfc = unicodedata.normalize("NFC", text)
    nfd = unicodedata.normalize("NFD", text)
    
    if nfc != nfd and text != nfc:
        return f"Text not in NFC form. Length: {len(text)} -> {len(nfc)}"
    
    return None


def strip_diacritics(text: str) -> str:
    """Remove diacritical marks (nikkud) from Hebrew text."""
    if not text:
        return text
    
    # Normalize to NFD to separate base characters from combining marks
    nfd = unicodedata.normalize("NFD", text)
    
    # Remove combining marks (Hebrew points are in category 'Mn')
    stripped = ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')
    
    return unicodedata.normalize("NFC", stripped)
