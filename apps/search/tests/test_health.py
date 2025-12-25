"""Tests for health check endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_endpoint_returns_200(client: AsyncClient) -> None:
    """Test that /health endpoint returns 200 status."""
    response = await client.get("/v1/search/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_health_endpoint_returns_expected_structure(client: AsyncClient) -> None:
    """Test that /health endpoint returns expected JSON structure."""
    response = await client.get("/v1/search/health")
    data = response.json()

    assert "status" in data
    assert "version" in data
    assert "qdrant_connected" in data

    assert isinstance(data["status"], str)
    assert isinstance(data["version"], str)
    assert isinstance(data["qdrant_connected"], bool)


@pytest.mark.asyncio
async def test_health_status_is_healthy_or_degraded(client: AsyncClient) -> None:
    """Test that health status is either 'healthy' or 'degraded'."""
    response = await client.get("/v1/search/health")
    data = response.json()

    assert data["status"] in ["healthy", "degraded"]


@pytest.mark.asyncio
async def test_health_version_is_correct(client: AsyncClient) -> None:
    """Test that version matches expected value."""
    response = await client.get("/v1/search/health")
    data = response.json()

    assert data["version"] == "0.1.0"


@pytest.mark.asyncio
async def test_readiness_endpoint_returns_200(client: AsyncClient) -> None:
    """Test that /ready endpoint returns 200 status."""
    response = await client.get("/v1/search/ready")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_readiness_endpoint_returns_expected_structure(client: AsyncClient) -> None:
    """Test that /ready endpoint returns expected JSON structure."""
    response = await client.get("/v1/search/ready")
    data = response.json()

    assert "status" in data
    assert isinstance(data["status"], str)
