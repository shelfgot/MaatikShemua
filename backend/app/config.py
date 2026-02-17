"""Application configuration."""
import os
from pathlib import Path
from typing import List

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
MODELS_DIR = Path(os.getenv("MODELS_DIR", BASE_DIR / "models"))
LOGS_DIR = Path(os.getenv("LOGS_DIR", BASE_DIR / "logs"))

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "pages").mkdir(exist_ok=True)
(DATA_DIR / "models").mkdir(exist_ok=True)

# Database
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR}/maatik.db")

# Redis (optional, required when USE_BACKGROUND_TASKS is true)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
# When true: long-running jobs (fine-tuning, inference) run in Celery workers. When false: run in-process in a thread so the API stays responsive.
USE_BACKGROUND_TASKS = os.getenv("USE_BACKGROUND_TASKS", "true").lower() == "true"

# Security
AUTH_ENABLED = os.getenv("AUTH_ENABLED", "false").lower() == "true"
AUTH_USERNAME = os.getenv("AUTH_USERNAME", "admin")
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "")

# Allowed directories for path validation
ALLOWED_MODEL_DIRS: List[Path] = [
    MODELS_DIR.resolve(),
    (DATA_DIR / "models").resolve(),
    (DATA_DIR / "models" / "finetuned").resolve(),  # Fine-tuned models directory
]

ALLOWED_IMAGE_DIRS: List[Path] = [
    (DATA_DIR / "pages").resolve(),
    (DATA_DIR / "uploads").resolve(),
]

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FORMAT = os.getenv("LOG_FORMAT", "json")  # "json" or "console"

# Upload limits
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", 500 * 1024 * 1024))  # 500MB default

# Image processing
TARGET_DPI = 300  # Standard DPI for coordinate normalization
THUMBNAIL_SIZE = 200

# Version history
VERSION_RETENTION_DAYS = 30
MAX_VERSIONS_PER_TRANSCRIPTION = 100

# Training/fine-tuning
MIN_TRAINING_PAGES = int(os.getenv("MIN_TRAINING_PAGES", "1"))  # Minimum pages required for fine-tuning
