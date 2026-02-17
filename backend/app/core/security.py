"""Security utilities for path validation, auth, and URL sanitization."""
import os
import secrets
import ipaddress
import socket
from pathlib import Path
from urllib.parse import urlparse
from typing import List, Optional
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from app.config import (
    ALLOWED_MODEL_DIRS, 
    ALLOWED_IMAGE_DIRS,
    AUTH_ENABLED,
    AUTH_USERNAME,
    AUTH_PASSWORD,
)

security = HTTPBasic(auto_error=False)

# Blocked IP ranges for SSRF prevention
BLOCKED_IP_RANGES = [
    ipaddress.ip_network("127.0.0.0/8"),      # Loopback
    ipaddress.ip_network("10.0.0.0/8"),       # Private
    ipaddress.ip_network("172.16.0.0/12"),    # Private
    ipaddress.ip_network("192.168.0.0/16"),   # Private
    ipaddress.ip_network("169.254.0.0/16"),   # Link-local
    ipaddress.ip_network("::1/128"),          # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),         # IPv6 private
]


def is_safe_path(path: Path, base: Path) -> bool:
    """Check if path is within base directory (no traversal)."""
    try:
        path.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def validate_path(path: str, allowed_dirs: List[Path]) -> Path:
    """Validate that path is within allowed directories."""
    resolved = Path(path).resolve()
    
    if not any(is_safe_path(resolved, allowed) for allowed in allowed_dirs):
        raise HTTPException(
            status_code=403,
            detail="Access denied: path outside allowed directories"
        )
    
    return resolved


def validate_model_path(path: str) -> Path:
    """Validate model file path."""
    return validate_path(path, ALLOWED_MODEL_DIRS)


def validate_image_path(path: str) -> Path:
    """Validate image file path."""
    return validate_path(path, ALLOWED_IMAGE_DIRS)


def validate_external_url(url: str) -> str:
    """Validate URL is external and safe to fetch (SSRF prevention)."""
    parsed = urlparse(url)
    
    # Only allow HTTP(S)
    if parsed.scheme not in ("https", "http"):
        raise HTTPException(400, "Only HTTP(S) URLs allowed")
    
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(400, "Invalid URL: no hostname")
    
    # Resolve hostname to IP
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(hostname))
        
        # Check against blocked ranges
        for blocked in BLOCKED_IP_RANGES:
            if ip in blocked:
                raise HTTPException(400, "URL resolves to blocked IP range")
        
    except socket.gaierror:
        raise HTTPException(400, f"Could not resolve hostname: {hostname}")
    
    return url


async def verify_auth(credentials: Optional[HTTPBasicCredentials] = Depends(security)):
    """Verify basic auth if enabled."""
    if not AUTH_ENABLED:
        return True
    
    if not credentials:
        raise HTTPException(
            401, 
            "Authentication required",
            headers={"WWW-Authenticate": "Basic"}
        )
    
    correct_username = secrets.compare_digest(credentials.username, AUTH_USERNAME)
    correct_password = secrets.compare_digest(credentials.password, AUTH_PASSWORD)
    
    if not (correct_username and correct_password):
        raise HTTPException(
            401, 
            "Invalid credentials",
            headers={"WWW-Authenticate": "Basic"}
        )
    
    return True
