"""Request tracing with correlation IDs."""

import time
import uuid
from contextvars import ContextVar
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from search.utils.logging import bind_context, clear_context, get_logger

# Context variable for correlation ID
correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")

# Header names
CORRELATION_ID_HEADER = "X-Correlation-ID"
REQUEST_ID_HEADER = "X-Request-ID"

logger = get_logger(__name__)


def get_correlation_id() -> str:
    """Get the current correlation ID from context.

    Returns:
            Current correlation ID, or empty string if not set.
    """
    return correlation_id_var.get()


def set_correlation_id(correlation_id: str) -> None:
    """Set the correlation ID in context.

    Args:
            correlation_id: Correlation ID to set.
    """
    correlation_id_var.set(correlation_id)


class TracingMiddleware(BaseHTTPMiddleware):
    """Middleware for request tracing with correlation IDs.

    Extracts or generates correlation ID and adds it to:
    - Request context for logging
    - Response headers for client tracking

    Also logs request/response metadata for observability.
    """

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        """Process request with tracing.

        Args:
                request: Incoming HTTP request.
                call_next: Next middleware/handler in chain.

        Returns:
                HTTP response with correlation ID header.
        """
        # Clear any previous context to prevent leakage
        clear_context()

        # Get or generate correlation ID
        correlation_id = request.headers.get(
            CORRELATION_ID_HEADER, request.headers.get(REQUEST_ID_HEADER, str(uuid.uuid4()))
        )

        # Set in context variable
        set_correlation_id(correlation_id)

        # Bind to structured logging context
        bind_context(
            correlation_id=correlation_id,
            method=request.method,
            path=request.url.path,
            client_host=request.client.host if request.client else None,
        )

        # Log request start
        start_time = time.perf_counter()
        logger.info(
            "request_started",
            query_params=dict(request.query_params) if request.query_params else None,
        )

        try:
            # Process request
            response = await call_next(request)

            # Calculate duration
            duration_ms = (time.perf_counter() - start_time) * 1000

            # Log request completion
            logger.info(
                "request_completed",
                status_code=response.status_code,
                duration_ms=round(duration_ms, 2),
            )

            # Add correlation ID to response headers
            response.headers[CORRELATION_ID_HEADER] = correlation_id

            return response

        except Exception as exc:
            # Calculate duration
            duration_ms = (time.perf_counter() - start_time) * 1000

            # Log request failure
            logger.error(
                "request_failed",
                error=str(exc),
                error_type=type(exc).__name__,
                duration_ms=round(duration_ms, 2),
                exc_info=True,
            )

            # Re-raise to be handled by error handlers
            raise
