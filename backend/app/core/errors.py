"""Error handling system with structured responses."""
from enum import Enum
from typing import Optional, Any
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class ErrorCategory(str, Enum):
    IMAGE_PROCESSING = "ImageProcessingError"
    MODEL_ERROR = "ModelError"
    EXTERNAL_SERVICE = "ExternalServiceError"
    STORAGE = "StorageError"
    VALIDATION = "ValidationError"
    NOT_FOUND = "NotFoundError"
    CONFLICT = "ConflictError"


class MaatikError(Exception):
    """Base error with structured response."""
    category: ErrorCategory = ErrorCategory.VALIDATION
    status_code: int = 400
    recoverable: bool = True
    
    def __init__(self, message: str, details: Optional[dict] = None):
        self.message = message
        self.details = details or {}
        super().__init__(message)
    
    def to_response(self) -> dict:
        return {
            "error": self.category.value,
            "message": self.message,
            "details": self.details,
            "recoverable": self.recoverable
        }


class ImageProcessingError(MaatikError):
    """Kraken/image errors - skip page, continue batch."""
    category = ErrorCategory.IMAGE_PROCESSING
    status_code = 422
    recoverable = True


class ModelError(MaatikError):
    """Model loading/inference errors."""
    category = ErrorCategory.MODEL_ERROR
    status_code = 500
    recoverable = False


class ExternalServiceError(MaatikError):
    """IIIF/network errors - retry with backoff."""
    category = ErrorCategory.EXTERNAL_SERVICE
    status_code = 502
    recoverable = True


class StorageError(MaatikError):
    """Disk errors - abort, alert user."""
    category = ErrorCategory.STORAGE
    status_code = 507
    recoverable = False


class NotFoundError(MaatikError):
    """Resource not found."""
    category = ErrorCategory.NOT_FOUND
    status_code = 404
    recoverable = False


class ValidationError(MaatikError):
    """Validation error."""
    category = ErrorCategory.VALIDATION
    status_code = 400
    recoverable = True


class ConflictError(MaatikError):
    """Conflict error (e.g., concurrent edit)."""
    category = ErrorCategory.CONFLICT
    status_code = 409
    recoverable = True


async def maatik_exception_handler(request: Request, exc: MaatikError) -> JSONResponse:
    """Exception handler for FastAPI."""
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_response()
    )
