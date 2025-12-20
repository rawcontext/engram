"""Pytest configuration and shared fixtures."""

import pytest
from httpx import ASGITransport, AsyncClient

from search.main import create_app


@pytest.fixture
def app():
    """Create a test FastAPI application instance.

    Returns:
        FastAPI application for testing.
    """
    return create_app()


@pytest.fixture
async def client(app):
    """Create an async test client.

    Args:
        app: FastAPI application fixture.

    Yields:
        AsyncClient for making test requests.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
