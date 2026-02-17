"""Structured logging configuration."""
import structlog
import logging
import sys
from typing import Optional
from contextvars import ContextVar
from uuid import uuid4

# Context variable for request ID
request_id_var: ContextVar[Optional[str]] = ContextVar('request_id', default=None)


def get_request_id() -> str:
    """Get current request ID."""
    return request_id_var.get() or "no-request"


def add_request_id(logger, method_name, event_dict):
    """Add request ID to all log entries."""
    event_dict['request_id'] = get_request_id()
    return event_dict


def setup_logging(log_level: str = "INFO", json_logs: bool = True):
    """Configure structured logging."""
    
    # Standard library logging config
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper()),
    )
    
    # Suppress noisy loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    
    # Structlog processors
    processors = [
        structlog.contextvars.merge_contextvars,
        add_request_id,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]
    
    if json_logs:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))
    
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper())
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


# Get logger instance
logger = structlog.get_logger()
