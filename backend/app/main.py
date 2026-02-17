"""FastAPI application entry point."""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from uuid import uuid4

from app.config import LOG_LEVEL, LOG_FORMAT
from app.core.logging import setup_logging, request_id_var, logger
from app.core.errors import MaatikError, maatik_exception_handler
from app.database import engine, Base, init_db, SessionLocal
from app.api import documents, pages, transcriptions, models, inference, training, tasks, export, backup, iiif, import_text
from app.services.model_registration import auto_register_models


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    setup_logging(log_level=LOG_LEVEL, json_logs=(LOG_FORMAT == "json"))
    logger.info("application_starting")
    init_db()
    logger.info("database_initialized")
    
    # Auto-register models from models/transcription directory
    try:
        db = SessionLocal()
        try:
            registered = auto_register_models(db)
            if registered:
                logger.info("startup_models_registered", count=len(registered))
        finally:
            db.close()
    except Exception as e:
        logger.error("startup_model_registration_failed", error=str(e))
    
    yield
    
    # Shutdown
    logger.info("application_shutting_down")


app = FastAPI(
    title="Maatik Shemua",
    description="Hebrew Manuscript Transcription Tool using Kraken HTR",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Add request ID to all requests for tracing."""
    request_id = request.headers.get("X-Request-ID", str(uuid4()))
    request_id_var.set(request_id)
    
    logger.info(
        "request_started",
        method=request.method,
        path=request.url.path,
        client_ip=request.client.host if request.client else None,
    )
    
    try:
        response = await call_next(request)
        
        logger.info(
            "request_completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
        )
        
        response.headers["X-Request-ID"] = request_id
        return response
        
    except Exception as e:
        logger.exception(
            "request_failed",
            method=request.method,
            path=request.url.path,
            error=str(e),
        )
        raise


# Register exception handler
app.add_exception_handler(MaatikError, maatik_exception_handler)


# Include routers
app.include_router(documents.router)
app.include_router(pages.router)
app.include_router(transcriptions.router)
app.include_router(models.router)
app.include_router(inference.router)
app.include_router(training.router)
app.include_router(tasks.router)
app.include_router(export.router)
app.include_router(backup.router)
app.include_router(iiif.router)
app.include_router(import_text.router)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "version": "1.0.0"}


# WebSocket for progress updates
from app.websocket.progress import progress_router
app.include_router(progress_router)
