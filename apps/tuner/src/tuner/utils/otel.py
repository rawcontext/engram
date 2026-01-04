"""OpenTelemetry instrumentation for the tuner service."""

import os
from typing import Any

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, SERVICE_VERSION, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

from tuner.utils.logging import get_logger

logger = get_logger(__name__)


def init_tracing(
    service_name: str = "engram-tuner",
    service_version: str = "0.1.0",
) -> None:
    """Initialize OpenTelemetry tracing."""
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

    otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or os.getenv(
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"
    )

    if otlp_endpoint:
        exporter = OTLPSpanExporter(endpoint=f"{otlp_endpoint}/v1/traces")
        provider.add_span_processor(BatchSpanProcessor(exporter))
        logger.info("OpenTelemetry OTLP exporter configured", endpoint=otlp_endpoint)
    else:
        console_enabled = os.getenv("OTEL_CONSOLE_EXPORTER", "false").lower() == "true"
        if console_enabled:
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
            logger.info("OpenTelemetry console exporter configured")
        else:
            logger.info("OpenTelemetry tracing initialized (no exporter configured)")

    trace.set_tracer_provider(provider)
    logger.info(
        "OpenTelemetry tracing initialized",
        service_name=service_name,
        service_version=service_version,
    )


def instrument_fastapi(app: Any) -> None:
    """Instrument a FastAPI application for tracing."""
    FastAPIInstrumentor.instrument_app(app)
    logger.info("FastAPI instrumented for OpenTelemetry")


def shutdown_tracing() -> None:
    """Shutdown OpenTelemetry tracing gracefully."""
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        provider.shutdown()  # type: ignore[union-attr]
        logger.info("OpenTelemetry tracing shutdown complete")
