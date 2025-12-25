"""Pytest configuration and shared fixtures."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.main import create_app
from src.middleware.auth import ApiKeyContext

# Mock auth context for authenticated requests
MOCK_API_KEY_CONTEXT = ApiKeyContext(
    id="test-key-id",
    prefix="engram_test_abc123...",
    method="api_key",
    type="test",
    user_id="test-user",
    scopes=["memory:read", "memory:write", "search:read"],
    rate_limit_rpm=1000,
)


@pytest.fixture
def app():
    """Create a test FastAPI application instance.

    Returns:
        FastAPI application for testing.
    """
    return create_app()


@pytest.fixture
async def client(app):
    """Create an async test client with mocked authentication.

    The auth handler is mocked to always return a valid API key context,
    allowing tests to focus on endpoint logic rather than auth.

    Args:
        app: FastAPI application fixture.

    Yields:
        AsyncClient for making test requests.
    """
    # Mock the auth handler to return a valid context
    mock_handler = AsyncMock()
    mock_handler.validate = AsyncMock(return_value=MOCK_API_KEY_CONTEXT)

    with patch("src.middleware.auth._auth_handler", mock_handler):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": "Bearer engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
        ) as ac:
            yield ac


@pytest.fixture
async def unauthenticated_client(app):
    """Create an async test client without authentication.

    Args:
        app: FastAPI application fixture.

    Yields:
        AsyncClient for making unauthenticated test requests.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
