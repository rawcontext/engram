"""Utility modules for the search service."""

from src.utils.logging import bind_context, clear_context, configure_logging, get_logger
from src.utils.tracing import (
    CORRELATION_ID_HEADER,
    REQUEST_ID_HEADER,
    TracingMiddleware,
    get_correlation_id,
    set_correlation_id,
)

__all__ = [
    # Logging
    "configure_logging",
    "get_logger",
    "bind_context",
    "clear_context",
    # Tracing
    "TracingMiddleware",
    "get_correlation_id",
    "set_correlation_id",
    "CORRELATION_ID_HEADER",
    "REQUEST_ID_HEADER",
]
