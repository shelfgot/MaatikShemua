"""Background tasks using Celery (optional) or FastAPI BackgroundTasks."""
import os
from celery import Celery

# Redis URL from environment or default
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Create Celery app
celery = Celery(
    "maatik_shemua",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.tasks.inference_tasks", "app.tasks.training_tasks"]
)

# Celery configuration
celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,  # 1 hour max per task
    worker_prefetch_multiplier=1,  # One task at a time for GPU tasks
    result_expires=86400,  # Results expire after 24 hours
    task_create_missing_queues=True,  # So -Q finetune,celery works without explicit task_queues
)

# Export celery app for CLI
app = celery
