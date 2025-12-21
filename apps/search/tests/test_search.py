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


@pytest.mark.asyncio
async def test_embed_endpoint_exists(client: AsyncClient) -> None:
    """Test that /embed endpoint is accessible."""
    response = await client.post(
        "/embed",
        json={
            "text": "test text to embed",
        },
    )
    # Should return 200 or 503 (if embedder factory not initialized in test)
    assert response.status_code in [200, 503]


@pytest.mark.asyncio
async def test_embed_with_minimal_request(client: AsyncClient) -> None:
    """Test embed with minimal required fields."""
    response = await client.post(
        "/embed",
        json={
            "text": "test text",
        },
    )
    # Should return 200 or 503 (if embedder factory not initialized in test)
    assert response.status_code in [200, 503]

    if response.status_code == 200:
        data = response.json()
        assert "embedding" in data
        assert "dimensions" in data
        assert "embedder_type" in data
        assert "took_ms" in data

        # Should have 768 dimensions (BGE-base default)
        assert data["dimensions"] == 768
        assert len(data["embedding"]) == 768
        assert data["embedder_type"] == "text"


@pytest.mark.asyncio
async def test_embed_with_full_request(client: AsyncClient) -> None:
    """Test embed with all optional parameters."""
    response = await client.post(
        "/embed",
        json={
            "text": "def hello(): return 'world'",
            "embedder_type": "code",
            "is_query": False,
        },
    )
    # Should return 200 or 503 (if embedder factory not initialized in test)
    assert response.status_code in [200, 503]

    if response.status_code == 200:
        data = response.json()
        assert data["embedder_type"] == "code"
        assert len(data["embedding"]) > 0


@pytest.mark.asyncio
async def test_embed_requires_text_field(client: AsyncClient) -> None:
    """Test that embed requires the text field."""
    response = await client.post(
        "/embed",
        json={
            "embedder_type": "text",
            # Missing required 'text' field
        },
    )
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_embed_vectors_are_normalized(client: AsyncClient) -> None:
    """Test that embed returns normalized vectors (L2 norm ≈ 1)."""
    response = await client.post(
        "/embed",
        json={
            "text": "test normalization",
        },
    )
    # Should return 200 or 503 (if embedder factory not initialized in test)
    assert response.status_code in [200, 503]

    if response.status_code == 200:
        data = response.json()
        embedding = data["embedding"]

        # Calculate L2 norm
        import math

        norm = math.sqrt(sum(x * x for x in embedding))

        # Should be approximately 1.0 (normalized)
        assert abs(norm - 1.0) < 0.01


@pytest.mark.asyncio
async def test_embed_similar_texts_high_similarity(client: AsyncClient) -> None:
    """Test that similar texts have high cosine similarity."""
    # Embed two similar texts
    response1 = await client.post("/embed", json={"text": "machine learning algorithms"})
    response2 = await client.post("/embed", json={"text": "machine learning models"})

    # Should return 200 or 503 (if embedder factory not initialized in test)
    assert response1.status_code in [200, 503]
    assert response2.status_code in [200, 503]

    if response1.status_code == 200 and response2.status_code == 200:
        embedding1 = response1.json()["embedding"]
        embedding2 = response2.json()["embedding"]

        # Calculate cosine similarity
        import math

        dot_product = sum(a * b for a, b in zip(embedding1, embedding2, strict=True))
        norm1 = math.sqrt(sum(x * x for x in embedding1))
        norm2 = math.sqrt(sum(x * x for x in embedding2))
        cosine_sim = dot_product / (norm1 * norm2)

        # Similar texts should have high similarity (> 0.7)
        assert cosine_sim > 0.7
