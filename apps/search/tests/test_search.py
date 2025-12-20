"""Tests for search endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_search_endpoint_exists(client: AsyncClient) -> None:
    """Test that /search endpoint is accessible."""
    response = await client.post(
        "/search",
        json={
            "text": "test query",
            "limit": 5,
        },
    )
    # Should return 200 or 503 (if Qdrant not available)
    assert response.status_code in [200, 503]


@pytest.mark.asyncio
async def test_search_with_minimal_request(client: AsyncClient) -> None:
    """Test search with minimal required fields."""
    response = await client.post(
        "/search",
        json={
            "text": "test query",
        },
    )
    # Phase 1: Should return 200 or 503
    assert response.status_code in [200, 503]

    if response.status_code == 200:
        data = response.json()
        assert "results" in data
        assert "total" in data
        assert "took_ms" in data


@pytest.mark.asyncio
async def test_search_with_full_request(client: AsyncClient) -> None:
    """Test search with all optional parameters."""
    response = await client.post(
        "/search",
        json={
            "text": "test query",
            "limit": 10,
            "threshold": 0.7,
            "filters": {
                "session_id": "test-session",
                "type": "thought",
            },
            "strategy": "hybrid",
            "rerank": True,
            "rerank_tier": "fast",
            "rerank_depth": 20,
        },
    )
    # Phase 1: Should return 200 or 503
    assert response.status_code in [200, 503]


@pytest.mark.asyncio
async def test_search_validates_limit_range(client: AsyncClient) -> None:
    """Test that search validates limit parameter range."""
    # Test limit too high
    response = await client.post(
        "/search",
        json={
            "text": "test query",
            "limit": 1000,  # Exceeds max of 100
        },
    )
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_search_validates_threshold_range(client: AsyncClient) -> None:
    """Test that search validates threshold parameter range."""
    # Test threshold too high
    response = await client.post(
        "/search",
        json={
            "text": "test query",
            "threshold": 1.5,  # Exceeds max of 1.0
        },
    )
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_search_requires_text_field(client: AsyncClient) -> None:
    """Test that search requires the text field."""
    response = await client.post(
        "/search",
        json={
            "limit": 10,
            # Missing required 'text' field
        },
    )
    assert response.status_code == 422  # Validation error
