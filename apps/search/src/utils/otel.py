"""OpenTelemetry instrumentation for the search service.

Provides tracing setup and span utilities for distributed tracing.
"""

import os
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any, ParamSpec, TypeVar

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, SERVICE_VERSION, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.trace import Status, StatusCode

from src.utils.logging import get_logger

logger = get_logger(__name__)

P = ParamSpec("P")
T = TypeVar("T")


def init_tracing(
    service_name: str = "engram-search",
    service_version: str = "0.1.0",
) -> None:
    """Initialize OpenTelemetry tracing.

    Configures OTLP exporter if OTEL_EXPORTER_OTLP_ENDPOINT is set,
    otherwise falls back to console exporter for local development.

    Args:
        service_name: Name of the service for tracing.
        service_version: Version of the service.
    """
    enabled = os.getenv("OTEL_ENABLED", "true").lower() == "true"
    if not enabled:
        logger.info("OpenTelemetry tracing disabled (OTEL_ENABLED=false)")
        return

    resource = Resource.create(
        {
            SERVICE_NAME: service_name,
            SERVICE_VERSION: service_version,
        }
    )

    provider = TracerProvider(resource=resource)

    # Configure exporter based on environment
    otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or os.getenv(
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"
    )

    if otlp_endpoint:
        exporter = OTLPSpanExporter(endpoint=f"{otlp_endpoint}/v1/traces")
        provider.add_span_processor(BatchSpanProcessor(exporter))
        logger.info(f"OpenTelemetry OTLP exporter configured: {otlp_endpoint}")
    else:
        # Console exporter for local development
        console_enabled = os.getenv("OTEL_CONSOLE_EXPORTER", "false").lower() == "true"
        if console_enabled:
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
            logger.info("OpenTelemetry console exporter configured")
        else:
            logger.info("OpenTelemetry tracing initialized (no exporter configured)")

    trace.set_tracer_provider(provider)
    logger.info(f"OpenTelemetry tracing initialized for {service_name} v{service_version}")


def instrument_fastapi(app: Any) -> None:
    """Instrument a FastAPI application for tracing.

    Args:
        app: FastAPI application instance.
    """
    FastAPIInstrumentor.instrument_app(app)
    logger.info("FastAPI instrumented for OpenTelemetry")


def instrument_httpx() -> None:
    """Instrument HTTPX client for tracing outbound HTTP calls."""
    HTTPXClientInstrumentor().instrument()
    logger.info("HTTPX instrumented for OpenTelemetry")


def get_tracer(name: str = __name__) -> trace.Tracer:
    """Get a tracer instance.

    Args:
        name: Name for the tracer (typically __name__).

    Returns:
        Tracer instance.
    """
    return trace.get_tracer(name)


def trace_async(
    operation: str,
    attributes: dict[str, Any] | None = None,
) -> Callable[[Callable[P, Awaitable[T]]], Callable[P, Awaitable[T]]]:
    """Decorator to trace an async function.

    Args:
        operation: Name of the operation for the span.
        attributes: Additional span attributes.

    Returns:
        Decorated function.
    """

    def decorator(func: Callable[P, Awaitable[T]]) -> Callable[P, Awaitable[T]]:
        @wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            tracer = get_tracer()
            with tracer.start_as_current_span(operation) as span:
                if attributes:
                    for key, value in attributes.items():
                        span.set_attribute(key, value)
                try:
                    result = await func(*args, **kwargs)
                    span.set_status(Status(StatusCode.OK))
                    return result
                except Exception as e:
                    span.set_status(Status(StatusCode.ERROR, str(e)))
                    span.record_exception(e)
                    raise

        return wrapper

    return decorator


async def trace_db_operation(
    operation: str,
    db_system: str,
    statement: str,
    func: Callable[[], Awaitable[T]],
) -> T:
    """Trace a database operation.

    Args:
        operation: Database operation type (query, insert, etc.).
        db_system: Database system (qdrant, postgres, etc.).
        statement: Query or operation description.
        func: Async function to execute.

    Returns:
        Result of the function.
    """
    tracer = get_tracer()
    with tracer.start_as_current_span(f"db.{operation}") as span:
        span.set_attribute("db.system", db_system)
        span.set_attribute("db.operation", operation)
        span.set_attribute("db.statement", statement[:1000])  # Truncate long queries
        try:
            result = await func()
            span.set_status(Status(StatusCode.OK))
            return result
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            raise


async def trace_http_call(
    method: str,
    url: str,
    func: Callable[[], Awaitable[T]],
) -> T:
    """Trace an outbound HTTP call.

    Args:
        method: HTTP method.
        url: Target URL.
        func: Async function to execute.

    Returns:
        Result of the function.
    """
    tracer = get_tracer()
    with tracer.start_as_current_span(f"http.client.{method.lower()}") as span:
        span.set_attribute("http.method", method)
        span.set_attribute("http.url", url)
        try:
            result = await func()
            span.set_status(Status(StatusCode.OK))
            return result
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            raise


def shutdown_tracing() -> None:
    """Shutdown OpenTelemetry tracing gracefully."""
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        provider.shutdown()  # type: ignore[union-attr]
        logger.info("OpenTelemetry tracing shutdown complete")
