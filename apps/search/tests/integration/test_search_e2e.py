"""End-to-end integration tests for the search pipeline.

These tests verify the complete search flow from indexing to retrieval
using real Qdrant containers. Uses simplified embeddings for testing.
"""

import uuid

import pytest
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models

from src.retrieval.constants import SPARSE_FIELD, TEXT_DENSE_FIELD


# Generate stable UUIDs for test documents (Qdrant requires int or UUID IDs)
DOC_IDS = {
    "doc-1": str(uuid.uuid5(uuid.NAMESPACE_DNS, "doc-1")),
    "doc-2": str(uuid.uuid5(uuid.NAMESPACE_DNS, "doc-2")),
    "doc-3": str(uuid.uuid5(uuid.NAMESPACE_DNS, "doc-3")),
    "doc-4": str(uuid.uuid5(uuid.NAMESPACE_DNS, "doc-4")),
    "doc-5": str(uuid.uuid5(uuid.NAMESPACE_DNS, "doc-5")),
}

# Test data - sample documents to index
SAMPLE_DOCUMENTS = [
    {
        "id": DOC_IDS["doc-1"],
        "content": "How to implement OAuth authentication in Python",
        "type": "memory",
        "org_id": "test-org",
        "session_id": "session-1",
    },
    {
        "id": DOC_IDS["doc-2"],
        "content": "Setting up PostgreSQL database connections with asyncpg",
        "type": "memory",
        "org_id": "test-org",
        "session_id": "session-1",
    },
    {
        "id": DOC_IDS["doc-3"],
        "content": "Building REST APIs with FastAPI and Pydantic",
        "type": "memory",
        "org_id": "test-org",
        "session_id": "session-2",
    },
    {
        "id": DOC_IDS["doc-4"],
        "content": "JavaScript async/await patterns for Node.js applications",
        "type": "memory",
        "org_id": "other-org",
        "session_id": "session-3",
    },
    {
        "id": DOC_IDS["doc-5"],
        "content": "Vector embeddings and semantic search fundamentals",
        "type": "memory",
        "org_id": "test-org",
        "session_id": "session-2",
    },
]


def generate_mock_dense_vector(text: str, size: int = 384) -> list[float]:
    """Generate a deterministic mock dense vector from text.

    Uses simple hashing to create reproducible vectors for testing.
    Not semantically meaningful, but deterministic for test assertions.
    """
    import hashlib

    # Hash the text to get a seed
    hash_bytes = hashlib.sha256(text.encode()).digest()

    # Use the hash bytes to generate a vector
    vector = []
    for i in range(size):
        byte_idx = i % len(hash_bytes)
        # Normalize to [-1, 1] range
        value = (hash_bytes[byte_idx] / 255.0) * 2 - 1
        vector.append(value)

    # Normalize to unit length
    magnitude = sum(v * v for v in vector) ** 0.5
    return [v / magnitude for v in vector]


def generate_mock_sparse_vector(text: str) -> tuple[list[int], list[float]]:
    """Generate a mock sparse vector from text.

    Creates indices and values based on word positions.
    """
    import hashlib

    words = text.lower().split()
    indices = []
    values = []

    for word in set(words):
        # Use hash to get consistent index
        word_hash = int(hashlib.md5(word.encode()).hexdigest()[:8], 16) % 30000
        indices.append(word_hash)
        values.append(1.0)  # Simple TF weight

    # Sort by index
    sorted_pairs = sorted(zip(indices, values))
    return [i for i, _ in sorted_pairs], [v for _, v in sorted_pairs]


@pytest.fixture
async def test_collection(qdrant_async_client: AsyncQdrantClient) -> str:
    """Create a test collection with proper schema and index sample documents."""
    collection_name = "test_search_e2e"

    # Delete if exists
    try:
        await qdrant_async_client.delete_collection(collection_name)
    except Exception:
        pass

    # Create collection with dense + sparse vectors
    await qdrant_async_client.create_collection(
        collection_name=collection_name,
        vectors_config={
            TEXT_DENSE_FIELD: models.VectorParams(
                size=384,
                distance=models.Distance.COSINE,
            ),
        },
        sparse_vectors_config={
            SPARSE_FIELD: models.SparseVectorParams(),
        },
    )

    # Create tenant index
    await qdrant_async_client.create_payload_index(
        collection_name=collection_name,
        field_name="org_id",
        field_schema=models.KeywordIndexParams(
            type=models.PayloadSchemaType.KEYWORD,
            is_tenant=True,
        ),
    )

    # Index sample documents
    points = []
    for doc in SAMPLE_DOCUMENTS:
        dense_vector = generate_mock_dense_vector(doc["content"])
        sparse_indices, sparse_values = generate_mock_sparse_vector(doc["content"])

        points.append(
            models.PointStruct(
                id=doc["id"],
                vector={
                    TEXT_DENSE_FIELD: dense_vector,
                },
                payload={
                    "content": doc["content"],
                    "type": doc["type"],
                    "org_id": doc["org_id"],
                    "session_id": doc["session_id"],
                },
            )
        )

    await qdrant_async_client.upsert(
        collection_name=collection_name,
        points=points,
    )

    yield collection_name

    # Cleanup
    try:
        await qdrant_async_client.delete_collection(collection_name)
    except Exception:
        pass


@pytest.mark.integration
class TestDenseSearch:
    """Integration tests for dense vector search."""

    @pytest.mark.asyncio
    async def test_dense_search_returns_results(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test that dense search returns results."""
        # Generate query vector
        query_text = "OAuth authentication"
        query_vector = generate_mock_dense_vector(query_text)

        # Execute search using query_points (async API)
        results = await qdrant_async_client.query_points(
            collection_name=test_collection,
            query=query_vector,
            using=TEXT_DENSE_FIELD,
            limit=5,
        )

        assert len(results.points) > 0
        # First result should have highest score
        assert results.points[0].score is not None
        assert results.points[0].score > 0

    @pytest.mark.asyncio
    async def test_dense_search_with_filter(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test dense search with org_id filter."""
        query_vector = generate_mock_dense_vector("database connections")

        # Search with filter using query_points (async API)
        results = await qdrant_async_client.query_points(
            collection_name=test_collection,
            query=query_vector,
            using=TEXT_DENSE_FIELD,
            query_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="org_id",
                        match=models.MatchValue(value="test-org"),
                    )
                ]
            ),
            limit=5,
        )

        # All results should be from test-org
        for result in results.points:
            assert result.payload["org_id"] == "test-org"

    @pytest.mark.asyncio
    async def test_dense_search_with_score_threshold(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test dense search with score threshold."""
        query_vector = generate_mock_dense_vector("Python programming")

        # Search with high threshold using query_points (async API)
        results = await qdrant_async_client.query_points(
            collection_name=test_collection,
            query=query_vector,
            using=TEXT_DENSE_FIELD,
            score_threshold=0.9,  # Very high threshold
            limit=10,
        )

        # All results should meet threshold
        for result in results.points:
            assert result.score >= 0.9


@pytest.mark.integration
class TestHybridSearch:
    """Integration tests for hybrid (dense + sparse) search."""

    @pytest.mark.asyncio
    async def test_hybrid_search_with_rrf(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test hybrid search using Qdrant's RRF prefetch."""
        query_text = "FastAPI REST API"
        query_vector = generate_mock_dense_vector(query_text)

        # Execute hybrid search with RRF
        results = await qdrant_async_client.query_points(
            collection_name=test_collection,
            prefetch=[
                models.Prefetch(
                    query=query_vector,
                    using=TEXT_DENSE_FIELD,
                    limit=10,
                ),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            limit=5,
        )

        assert len(results.points) > 0
        # RRF scores are typically lower than dense scores
        for point in results.points:
            assert point.score is not None


@pytest.mark.integration
class TestTenantIsolation:
    """Integration tests for multi-tenant isolation."""

    @pytest.mark.asyncio
    async def test_tenant_isolation(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test that searches are properly isolated by org_id."""
        query_vector = generate_mock_dense_vector("JavaScript")

        # Search for other-org (only doc-4 should match) using query_points (async API)
        results = await qdrant_async_client.query_points(
            collection_name=test_collection,
            query=query_vector,
            using=TEXT_DENSE_FIELD,
            query_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="org_id",
                        match=models.MatchValue(value="other-org"),
                    )
                ]
            ),
            limit=10,
        )

        # Should only get results from other-org
        assert len(results.points) == 1
        assert results.points[0].payload["org_id"] == "other-org"
        assert results.points[0].id == DOC_IDS["doc-4"]

    @pytest.mark.asyncio
    async def test_session_filter(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test filtering by session_id."""
        query_vector = generate_mock_dense_vector("programming")

        # Search for session-2 only using query_points (async API)
        results = await qdrant_async_client.query_points(
            collection_name=test_collection,
            query=query_vector,
            using=TEXT_DENSE_FIELD,
            query_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="session_id",
                        match=models.MatchValue(value="session-2"),
                    )
                ]
            ),
            limit=10,
        )

        # All results should be from session-2
        for result in results.points:
            assert result.payload["session_id"] == "session-2"


@pytest.mark.integration
class TestCollectionOperations:
    """Integration tests for collection-level operations."""

    @pytest.mark.asyncio
    async def test_count_vectors_in_collection(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test counting vectors in collection."""
        info = await qdrant_async_client.get_collection(test_collection)

        assert info.points_count == len(SAMPLE_DOCUMENTS)

    @pytest.mark.asyncio
    async def test_count_vectors_by_tenant(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test counting vectors for a specific tenant."""
        count_result = await qdrant_async_client.count(
            collection_name=test_collection,
            count_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="org_id",
                        match=models.MatchValue(value="test-org"),
                    )
                ]
            ),
        )

        # test-org has 4 documents
        assert count_result.count == 4

    @pytest.mark.asyncio
    async def test_retrieve_point_by_id(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test retrieving a specific point by ID."""
        points = await qdrant_async_client.retrieve(
            collection_name=test_collection,
            ids=[DOC_IDS["doc-1"]],
            with_payload=True,
            with_vectors=True,
        )

        assert len(points) == 1
        assert points[0].id == DOC_IDS["doc-1"]
        assert points[0].payload["content"] == SAMPLE_DOCUMENTS[0]["content"]
        assert TEXT_DENSE_FIELD in points[0].vector

    @pytest.mark.asyncio
    async def test_scroll_all_points(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test scrolling through all points in collection."""
        all_points = []
        offset = None

        while True:
            result, offset = await qdrant_async_client.scroll(
                collection_name=test_collection,
                limit=2,
                offset=offset,
                with_payload=True,
            )
            all_points.extend(result)

            if offset is None:
                break

        assert len(all_points) == len(SAMPLE_DOCUMENTS)


@pytest.mark.integration
class TestVectorOperations:
    """Integration tests for vector upsert/delete operations."""

    @pytest.mark.asyncio
    async def test_upsert_and_search(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test upserting a new point and searching for it."""
        new_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, "doc-new"))
        new_content = "Machine learning with PyTorch neural networks"
        new_vector = generate_mock_dense_vector(new_content)

        # Upsert new point
        await qdrant_async_client.upsert(
            collection_name=test_collection,
            points=[
                models.PointStruct(
                    id=new_id,
                    vector={TEXT_DENSE_FIELD: new_vector},
                    payload={
                        "content": new_content,
                        "type": "memory",
                        "org_id": "test-org",
                        "session_id": "session-new",
                    },
                )
            ],
        )

        # Search with same vector should find it using query_points (async API)
        results = await qdrant_async_client.query_points(
            collection_name=test_collection,
            query=new_vector,
            using=TEXT_DENSE_FIELD,
            limit=1,
        )

        assert len(results.points) == 1
        assert results.points[0].id == new_id
        assert results.points[0].score > 0.99  # Should be near-perfect match

    @pytest.mark.asyncio
    async def test_delete_point(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test deleting a point by ID."""
        # Get initial count
        info_before = await qdrant_async_client.get_collection(test_collection)
        count_before = info_before.points_count

        # Delete a point
        await qdrant_async_client.delete(
            collection_name=test_collection,
            points_selector=models.PointIdsList(points=[DOC_IDS["doc-1"]]),
        )

        # Verify point was deleted
        info_after = await qdrant_async_client.get_collection(test_collection)
        assert info_after.points_count == count_before - 1

        # Retrieve should return empty
        points = await qdrant_async_client.retrieve(
            collection_name=test_collection,
            ids=[DOC_IDS["doc-1"]],
        )
        assert len(points) == 0

    @pytest.mark.asyncio
    async def test_update_payload(
        self,
        qdrant_async_client: AsyncQdrantClient,
        test_collection: str,
    ) -> None:
        """Test updating point payload."""
        # Update payload
        await qdrant_async_client.set_payload(
            collection_name=test_collection,
            points=[DOC_IDS["doc-2"]],
            payload={"updated": True, "new_field": "test_value"},
        )

        # Retrieve and verify
        points = await qdrant_async_client.retrieve(
            collection_name=test_collection,
            ids=[DOC_IDS["doc-2"]],
            with_payload=True,
        )

        assert len(points) == 1
        assert points[0].payload["updated"] is True
        assert points[0].payload["new_field"] == "test_value"
        # Original fields should still exist
        assert points[0].payload["content"] is not None
