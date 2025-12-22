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
    log_level = getattr(logging, level.upper(), logging.INFO)

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )

    shared_processors: list[Any] = [
        merge_contextvars,
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]

    if add_timestamps:
        shared_processors.insert(
            1,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
        )

    if json_format:
        processors = shared_processors + [
            structlog.processors.JSONRenderer(indent=None, sort_keys=True),
        ]
    else:
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(),
        ]

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
    """Bind context variables to the current context."""
    bind_contextvars(**kwargs)


def clear_context() -> None:
    """Clear all context variables."""
    clear_contextvars()
