"""Structured logging configuration using structlog."""

import logging
import sys
from typing import Any

import structlog
from structlog.contextvars import (
    bind_contextvars,
    clear_contextvars,
    merge_contextvars,
)


def configure_logging(
    level: str = "INFO",
    json_format: bool = True,
    add_timestamps: bool = True,
) -> None:
    """Configure structured logging for the application.

    Args:
            level: Log level (DEBUG, INFO, WARNING, ERROR).
            json_format: Output logs as JSON (True) or human-readable (False).
            add_timestamps: Include timestamps in log output.
    """
    # Map string level to logging constant
    log_level = getattr(logging, level.upper(), logging.INFO)

    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )

    # Build processor chain
    shared_processors: list[Any] = [
        # Merge context variables first
        merge_contextvars,
        # Filter by log level
        structlog.stdlib.filter_by_level,
        # Add log level name
        structlog.stdlib.add_log_level,
        # Add logger name
        structlog.stdlib.add_logger_name,
        # Perform %-style formatting
        structlog.stdlib.PositionalArgumentsFormatter(),
        # If stack_info key is true, render stack trace
        structlog.processors.StackInfoRenderer(),
        # Render exceptions with traceback
        structlog.processors.format_exc_info,
        # Decode bytes to unicode
        structlog.processors.UnicodeDecoder(),
    ]

    # Add timestamp if requested
    if add_timestamps:
        shared_processors.insert(
            1,  # After merge_contextvars
            structlog.processors.TimeStamper(fmt="iso", utc=True),
        )

    # Choose renderer based on format
    if json_format:
        # JSON output for production
        processors = shared_processors + [
            structlog.processors.JSONRenderer(indent=None, sort_keys=True),
        ]
    else:
        # Human-readable output for development
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(),
        ]

    # Configure structlog
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> Any:
    """Get a structured logger instance.

    Args:
            name: Logger name (defaults to caller module).

    Returns:
            Configured structlog logger (BoundLogger).
    """
    return structlog.get_logger(name)


def bind_context(**kwargs: Any) -> None:
    """Bind context variables to the current context.

    These values will be included in all subsequent log messages
    within the same async context.

    Args:
            **kwargs: Key-value pairs to bind to context.

    Example:
            >>> bind_context(user_id="123", session_id="abc")
            >>> logger.info("user action")
            # Output includes: {"user_id": "123", "session_id": "abc", ...}
    """
    bind_contextvars(**kwargs)


def clear_context() -> None:
    """Clear all context variables.

    This should be called at the start of each request to ensure
    clean state and prevent context leakage between requests.
    """
    clear_contextvars()
