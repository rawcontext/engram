"""Tests for request tracing middleware."""

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.testclient import TestClient

from src.utils.tracing import (
    CORRELATION_ID_HEADER,
    REQUEST_ID_HEADER,
    TracingMiddleware,
    get_correlation_id,
    set_correlation_id,
)


def test_set_and_get_correlation_id():
    """Test setting and getting correlation ID."""
    test_id = "test-correlation-123"
    set_correlation_id(test_id)
    assert get_correlation_id() == test_id


def test_tracing_middleware_generates_correlation_id():
    """Test middleware generates correlation ID when not provided."""
    app = Starlette()
    app.add_middleware(TracingMiddleware)

    @app.route("/test")
    async def test_route(request: Request):
        return JSONResponse({"correlation_id": get_correlation_id()})

    client = TestClient(app)
    response = client.get("/test")

    assert response.status_code == 200
    assert CORRELATION_ID_HEADER in response.headers
    correlation_id = response.headers[CORRELATION_ID_HEADER]
    assert len(correlation_id) > 0
    assert response.json()["correlation_id"] == correlation_id


def test_tracing_middleware_uses_provided_correlation_id():
    """Test middleware uses correlation ID from request header."""
    app = Starlette()
    app.add_middleware(TracingMiddleware)

    @app.route("/test")
    async def test_route(request: Request):
        return JSONResponse({"correlation_id": get_correlation_id()})

    client = TestClient(app)
    custom_id = "custom-correlation-id-456"
    response = client.get("/test", headers={CORRELATION_ID_HEADER: custom_id})

    assert response.status_code == 200
    assert response.headers[CORRELATION_ID_HEADER] == custom_id
    assert response.json()["correlation_id"] == custom_id


def test_tracing_middleware_uses_request_id_header():
    """Test middleware falls back to X-Request-ID header."""
    app = Starlette()
    app.add_middleware(TracingMiddleware)

    @app.route("/test")
    async def test_route(request: Request):
        return JSONResponse({"correlation_id": get_correlation_id()})

    client = TestClient(app)
    custom_id = "request-id-789"
    response = client.get("/test", headers={REQUEST_ID_HEADER: custom_id})

    assert response.status_code == 200
    assert response.headers[CORRELATION_ID_HEADER] == custom_id
    assert response.json()["correlation_id"] == custom_id


def test_tracing_middleware_correlation_id_priority():
    """Test X-Correlation-ID takes priority over X-Request-ID."""
    app = Starlette()
    app.add_middleware(TracingMiddleware)

    @app.route("/test")
    async def test_route(request: Request):
        return JSONResponse({"correlation_id": get_correlation_id()})

    client = TestClient(app)
    correlation_id = "correlation-123"
    request_id = "request-456"

    response = client.get(
        "/test", headers={CORRELATION_ID_HEADER: correlation_id, REQUEST_ID_HEADER: request_id}
    )

    assert response.status_code == 200
    assert response.headers[CORRELATION_ID_HEADER] == correlation_id
    assert response.json()["correlation_id"] == correlation_id


def test_tracing_middleware_with_exception():
    """Test middleware logs exceptions and re-raises them."""
    app = Starlette()
    app.add_middleware(TracingMiddleware)

    @app.route("/test")
    async def test_route(request: Request):
        raise ValueError("Test error")

    client = TestClient(app)

    with pytest.raises(ValueError, match="Test error"):
        client.get("/test")
