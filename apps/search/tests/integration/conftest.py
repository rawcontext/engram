"""Pytest fixtures for integration tests using testcontainers.

These fixtures provide real Qdrant and PostgreSQL containers for testing.
Tests using these fixtures require Docker to be running.
"""

import os
from collections.abc import Generator
from typing import Any

import pytest
from qdrant_client import AsyncQdrantClient, QdrantClient
from testcontainers.postgres import PostgresContainer
from testcontainers.qdrant import QdrantContainer


# Skip all integration tests if Docker is not available or in minimal CI
def pytest_configure(config: Any) -> None:
    """Configure pytest markers."""
    config.addinivalue_line(
        "markers",
        "integration: mark test as integration test requiring Docker containers",
    )


def pytest_collection_modifyitems(config: Any, items: list[Any]) -> None:
    """Skip integration tests if Docker is not available."""
    skip_integration = pytest.mark.skip(
        reason="Skipping integration tests (set RUN_INTEGRATION_TESTS=1 to run)"
    )

    # Only run integration tests if explicitly enabled
    if not os.environ.get("RUN_INTEGRATION_TESTS"):
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(skip_integration)


@pytest.fixture(scope="session")
def qdrant_container() -> Generator[QdrantContainer, None, None]:
    """Create a Qdrant container for the test session.

    This fixture is session-scoped for efficiency - the container is reused
    across all tests in the session. Uses v1.16 to match qdrant-client 1.16.x.
    """
    with QdrantContainer("qdrant/qdrant:v1.16.0") as qdrant:
        yield qdrant


@pytest.fixture(scope="session")
def qdrant_url(qdrant_container: QdrantContainer) -> str:
    """Get the Qdrant HTTP URL from the container."""
    host = qdrant_container.get_container_host_ip()
    port = qdrant_container.get_exposed_port(6333)
    return f"http://{host}:{port}"


@pytest.fixture(scope="function")
def qdrant_sync_client(qdrant_url: str) -> Generator[QdrantClient, None, None]:
    """Create a synchronous Qdrant client for tests."""
    client = QdrantClient(url=qdrant_url)
    yield client
    client.close()


@pytest.fixture(scope="function")
async def qdrant_async_client(qdrant_url: str) -> AsyncQdrantClient:
    """Create an async Qdrant client for tests."""
    client = AsyncQdrantClient(url=qdrant_url)
    yield client
    await client.close()


@pytest.fixture(scope="session")
def postgres_container() -> Generator[PostgresContainer, None, None]:
    """Create a PostgreSQL container for the test session.

    Uses PostgreSQL 16 with test credentials.
    """
    with PostgresContainer(
        image="postgres:16-alpine",
        username="test",
        password="test",
        dbname="test_db",
    ) as postgres:
        yield postgres


@pytest.fixture(scope="session")
def postgres_url(postgres_container: PostgresContainer) -> str:
    """Get the PostgreSQL connection URL from the container.

    Uses asyncpg-compatible format (without driver prefix for psycopg).
    """
    # Get connection URL without SQLAlchemy driver prefix
    host = postgres_container.get_container_host_ip()
    port = postgres_container.get_exposed_port(5432)
    return f"postgresql://test:test@{host}:{port}/test_db"
