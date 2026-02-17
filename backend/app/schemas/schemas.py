"""Pydantic schemas for API request/response validation."""
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field
from enum import Enum


# Enums
class TranscriptionType(str, Enum):
    MANUAL = "manual"
    MODEL = "model"


class TranscriptionSource(str, Enum):
    MANUAL = "manual"
    IMPORTED = "imported"
    COPIED_FROM_MODEL = "copied_from_model"


class LineOrderMode(str, Enum):
    AUTO = "auto"
    RTL = "rtl"
    LTR = "ltr"
    MANUAL = "manual"


class TextEncoding(str, Enum):
    UTF8 = "utf-8"
    UTF8_BOM = "utf-8-sig"
    UTF16 = "utf-16"


class LineEnding(str, Enum):
    LF = "lf"
    CRLF = "crlf"
    CR = "cr"


class ExportFormat(str, Enum):
    TEXT = "text"
    ALTO = "alto"
    PAGEXML = "pagexml"
    TEI = "tei"


# Document schemas
class DocumentCreate(BaseModel):
    name: str
    shelfmark: Optional[str] = None
    repository: Optional[str] = None
    metadata: Optional[dict] = None


class DocumentUpdate(BaseModel):
    name: Optional[str] = None
    shelfmark: Optional[str] = None
    repository: Optional[str] = None
    metadata: Optional[dict] = None


class DocumentResponse(BaseModel):
    id: int
    name: str
    shelfmark: Optional[str]
    repository: Optional[str]
    metadata: Optional[dict]
    created_at: datetime
    page_count: int = 0
    
    class Config:
        from_attributes = True


class DocumentListResponse(BaseModel):
    items: List[DocumentResponse]
    total: int
    offset: int
    limit: int


# Page schemas
class PageResponse(BaseModel):
    id: int
    document_id: int
    page_number: int
    image_path: str
    tiles_path: Optional[str]
    iiif_image_url: Optional[str]
    color_space: Optional[str]
    original_dpi: Optional[int]
    lines_detected: bool
    is_ground_truth: bool
    line_order_mode: str
    thumbnail_url: Optional[str] = None
    manual_transcription_percent: float = 0
    has_model_transcription: bool = False
    
    class Config:
        from_attributes = True


class PageListResponse(BaseModel):
    items: List[PageResponse]
    total: int
    offset: int
    limit: int


class LineOrderUpdate(BaseModel):
    mode: LineOrderMode
    display_order: Optional[List[int]] = None  # For manual mode


# Transcription schemas
class TranscriptionLineCreate(BaseModel):
    line_number: int
    display_order: Optional[int] = None
    text: str = ""
    confidence: Optional[float] = None
    notes: Optional[str] = None


class TranscriptionLineUpdate(BaseModel):
    text: Optional[str] = None
    notes: Optional[str] = None


class TranscriptionLineResponse(BaseModel):
    id: int
    line_number: int
    display_order: Optional[int]
    text: Optional[str]
    confidence: Optional[float]
    notes: Optional[str]
    
    class Config:
        from_attributes = True


class TranscriptionUpdate(BaseModel):
    lines: List[TranscriptionLineCreate]
    source: Optional[TranscriptionSource] = TranscriptionSource.MANUAL


class TranscriptionResponse(BaseModel):
    id: int
    page_id: int
    type: str
    source: Optional[str]
    model_version: Optional[str]
    updated_at: datetime
    lines: List[TranscriptionLineResponse]
    
    class Config:
        from_attributes = True


class TranscriptionVersionResponse(BaseModel):
    id: int
    transcription_id: int
    content_hash: str
    created_at: datetime
    change_summary: Optional[str]
    lines_snapshot: Optional[List[dict]] = None  # Only included when requested
    
    class Config:
        from_attributes = True


# Model schemas
class ModelCreate(BaseModel):
    name: str
    path: str
    type: str  # "segmentation" or "recognition"
    description: Optional[str] = None


class ModelResponse(BaseModel):
    id: int
    name: str
    path: str
    type: str
    description: Optional[str]
    kraken_version: Optional[str]
    is_default: bool
    created_at: datetime
    training_metadata: Optional[dict]
    
    class Config:
        from_attributes = True


class ModelListResponse(BaseModel):
    items: List[ModelResponse]


# Task schemas
class TaskResponse(BaseModel):
    task_id: str
    type: str
    status: str
    progress: Optional[dict]
    result: Optional[dict]
    error: Optional[dict]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    items: List[TaskResponse]
    total: int
    offset: int
    limit: int


class TaskProgressResponse(BaseModel):
    current: int
    total: int
    page_id: Optional[int] = None
    status: str


# Export schemas
class ExportOptions(BaseModel):
    format: ExportFormat = ExportFormat.TEXT
    type: TranscriptionType = TranscriptionType.MANUAL
    encoding: TextEncoding = TextEncoding.UTF8_BOM
    line_ending: LineEnding = LineEnding.LF
    include_page_headers: bool = True
    include_line_numbers: bool = False
    include_confidence: bool = False


# Import schemas
class TextImportRequest(BaseModel):
    content: str
    page_mapping: Optional[dict] = None  # {page_number: start_line}


# IIIF schemas
class IIIFImportRequest(BaseModel):
    manifest_url: str


# Inference schemas
class InferenceRequest(BaseModel):
    page_ids: List[int]
    model_id: Optional[int] = None


# Training schemas
class TrainingRequest(BaseModel):
    model_id: int
    name: str
    page_ids: Optional[List[int]] = None  # If None, use all ground truth pages
