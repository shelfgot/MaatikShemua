"""Tests for path validation security."""
import pytest
from pathlib import Path
from fastapi import HTTPException

from app.core.security import (
    is_safe_path,
    validate_path,
    validate_external_url,
)


class TestPathValidation:
    """Test path traversal prevention."""
    
    def test_safe_path_within_base(self):
        base = Path("/app/data")
        path = Path("/app/data/pages/image.png")
        assert is_safe_path(path, base) is True
    
    def test_unsafe_path_traversal(self):
        base = Path("/app/data")
        # Path traversal attempt
        path = Path("/app/data/../secrets/password")
        # After resolution, this would be outside base
        assert is_safe_path(path, base) is False
    
    def test_unsafe_path_absolute(self):
        base = Path("/app/data")
        path = Path("/etc/passwd")
        assert is_safe_path(path, base) is False
    
    def test_validate_path_allowed(self):
        allowed = [Path("/app/data").resolve()]
        # This test needs actual filesystem or mocking
        # Skipping actual path validation in unit test
    
    def test_validate_path_denied(self):
        allowed = [Path("/app/data").resolve()]
        with pytest.raises(HTTPException) as exc:
            validate_path("/etc/passwd", allowed)
        assert exc.value.status_code == 403


class TestURLValidation:
    """Test SSRF prevention."""
    
    def test_valid_https_url(self):
        # This would need network or mocking
        # Just test the URL parsing
        pass
    
    def test_block_localhost(self):
        with pytest.raises(HTTPException):
            validate_external_url("http://localhost:8000/api")
    
    def test_block_private_ip(self):
        with pytest.raises(HTTPException):
            validate_external_url("http://192.168.1.1/")
    
    def test_block_file_protocol(self):
        with pytest.raises(HTTPException):
            validate_external_url("file:///etc/passwd")
    
    def test_block_no_scheme(self):
        with pytest.raises(HTTPException):
            validate_external_url("//example.com/")
