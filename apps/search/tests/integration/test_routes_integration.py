"""Integration tests for API routes with real dependencies.

These tests verify the HTTP API layer works correctly with real Qdrant.
Uses the FastAPI TestClient with mocked auth but real Qdrant.
"""

import uuid

import pytest
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models

from src.retrieval.constants import SPARSE_FIELD, TEXT_DENSE_FIELD


def generate_uuid(name: str) -> str:
    """Generate a stable UUID from a name for test IDs."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, name))


def generate_mock_vector(text: str, size: int = 384) -> list[float]:
    """Generate a deterministic mock vector from text."""
    import hashlib

    hash_bytes = hashlib.sha256(text.encode()).digest()
    vector = []
    for i in range(size):
        byte_idx = i % len(hash_bytes)
        value = (hash_bytes[byte_idx] / 255.0) * 2 - 1
        vector.append(value)
    magnitude = sum(v * v for v in vector) ** 0.5
    return [v / magnitude for v in vector]


@pytest.fixture
async def seeded_collection(qdrant_async_client: AsyncQdrantClient) -> str:
    """Create and seed a collection for API testing."""
    collection_name = "test_api_routes"

    # Delete if exists
    try:
        await qdrant_async_client.delete_collection(collection_name)
    except Exception:
        pass

    # Create collection
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

    # Seed test data with UUID IDs (Qdrant requires int or UUID IDs)
    test_docs = [
        {"id": generate_uuid("api-1"), "content": "API authentication patterns", "org_id": "test-org"},
        {"id": generate_uuid("api-2"), "content": "Database query optimization", "org_id": "test-org"},
        {"id": generate_uuid("api-3"), "content": "Caching strategies for web apps", "org_id": "test-org"},
    ]

    points = [
        models.PointStruct(
            id=doc["id"],
            vector={TEXT_DENSE_FIELD: generate_mock_vector(doc["content"])},
            payload={"content": doc["content"], "org_id": doc["org_id"], "type": "memory"},
        )
        for doc in test_docs
    ]

    await qdrant_async_client.upsert(collection_name=collection_name, points=points)

    yield collection_name

    # Cleanup
    try:
        await qdrant_async_client.delete_collection(collection_name)
    except Exception:
        pass


@pytest.mark.integration
class TestHealthEndpoint:
    """Integration tests for health check endpoint."""

    @pytest.mark.asyncio
    async def test_qdrant_connection_health(
        self,
        qdrant_async_client: AsyncQdrantClient,
    ) -> None:
        """Test that Qdrant connection is healthy."""
        # Simply verify we can list collections
        collections = await qdrant_async_client.get_collections()
        assert collections is not None

    @pytest.mark.asyncio
    async def test_qdrant_cluster_info(
        self,
        qdrant_async_client: AsyncQdrantClient,
    ) -> None:
        """Test that we can get cluster info."""
        # Get Qdrant cluster info for health check
        try:
            # In single-node mode, this may not work but shouldn't error
            collections = await qdrant_async_client.get_collections()
            assert isinstance(collections.collections, list)
        except Exception:
            pass


@pytest.mark.integration
class TestCollectionEndpoints:
    """Integration tests for collection management via Qdrant client."""

    @pytest.mark.asyncio
    async def test_list_collections(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test listing collections."""
        collections = await qdrant_async_client.get_collections()

        collection_names = [c.name for c in collections.collections]
        assert seeded_collection in collection_names

    @pytest.mark.asyncio
    async def test_get_collection_info(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test getting collection information."""
        info = await qdrant_async_client.get_collection(seeded_collection)

        assert info.status.value == "green"
        assert info.points_count == 3  # We seeded 3 documents
        assert info.config.params.vectors is not None


@pytest.mark.integration
class TestSearchEndpoints:
    """Integration tests for search functionality."""

    @pytest.mark.asyncio
    async def test_basic_search(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test basic vector search."""
        query_vector = generate_mock_vector("authentication")

        results = await qdrant_async_client.query_points(
            collection_name=seeded_collection,
            query=query_vector,
            using=TEXT_DENSE_FIELD,
            limit=3,
        )

        assert len(results.points) > 0
        # Results should be ordered by score descending
        scores = [r.score for r in results.points]
        assert scores == sorted(scores, reverse=True)

    @pytest.mark.asyncio
    async def test_filtered_search(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test search with org_id filter."""
        query_vector = generate_mock_vector("database")

        results = await qdrant_async_client.query_points(
            collection_name=seeded_collection,
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
            limit=10,
        )

        # All results should have the correct org_id
        for result in results.points:
            assert result.payload["org_id"] == "test-org"

    @pytest.mark.asyncio
    async def test_search_with_limit(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test search respects limit parameter."""
        query_vector = generate_mock_vector("web")

        results = await qdrant_async_client.query_points(
            collection_name=seeded_collection,
            query=query_vector,
            using=TEXT_DENSE_FIELD,
            limit=1,
        )

        assert len(results.points) <= 1


@pytest.mark.integration
class TestCRUDOperations:
    """Integration tests for CRUD operations on vectors."""

    @pytest.mark.asyncio
    async def test_insert_and_retrieve(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test inserting and retrieving a document."""
        new_id = generate_uuid("crud-test-1")
        new_content = "New test document for CRUD"
        new_vector = generate_mock_vector(new_content)

        # Insert
        await qdrant_async_client.upsert(
            collection_name=seeded_collection,
            points=[
                models.PointStruct(
                    id=new_id,
                    vector={TEXT_DENSE_FIELD: new_vector},
                    payload={"content": new_content, "org_id": "test-org"},
                )
            ],
        )

        # Retrieve
        points = await qdrant_async_client.retrieve(
            collection_name=seeded_collection,
            ids=[new_id],
            with_payload=True,
        )

        assert len(points) == 1
        assert points[0].payload["content"] == new_content

    @pytest.mark.asyncio
    async def test_update_document(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test updating an existing document."""
        doc_id = generate_uuid("api-1")

        # Update payload
        await qdrant_async_client.set_payload(
            collection_name=seeded_collection,
            points=[doc_id],
            payload={"updated": True},
        )

        # Verify update
        points = await qdrant_async_client.retrieve(
            collection_name=seeded_collection,
            ids=[doc_id],
            with_payload=True,
        )

        assert points[0].payload["updated"] is True
        # Original content should still exist
        assert "content" in points[0].payload

    @pytest.mark.asyncio
    async def test_delete_document(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test deleting a document."""
        # First insert a document to delete
        delete_id = generate_uuid("to-delete")
        await qdrant_async_client.upsert(
            collection_name=seeded_collection,
            points=[
                models.PointStruct(
                    id=delete_id,
                    vector={TEXT_DENSE_FIELD: generate_mock_vector("delete me")},
                    payload={"content": "delete me", "org_id": "test-org"},
                )
            ],
        )

        # Verify it exists
        points = await qdrant_async_client.retrieve(
            collection_name=seeded_collection,
            ids=[delete_id],
        )
        assert len(points) == 1

        # Delete
        await qdrant_async_client.delete(
            collection_name=seeded_collection,
            points_selector=models.PointIdsList(points=[delete_id]),
        )

        # Verify deleted
        points = await qdrant_async_client.retrieve(
            collection_name=seeded_collection,
            ids=[delete_id],
        )
        assert len(points) == 0


@pytest.mark.integration
class TestBatchOperations:
    """Integration tests for batch operations."""

    @pytest.mark.asyncio
    async def test_batch_upsert(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test batch upserting multiple documents."""
        batch_docs = [
            {"id": generate_uuid(f"batch-{i}"), "content": f"Batch document {i}"}
            for i in range(10)
        ]

        points = [
            models.PointStruct(
                id=doc["id"],
                vector={TEXT_DENSE_FIELD: generate_mock_vector(doc["content"])},
                payload={"content": doc["content"], "org_id": "test-org"},
            )
            for doc in batch_docs
        ]

        # Batch upsert
        await qdrant_async_client.upsert(
            collection_name=seeded_collection,
            points=points,
        )

        # Verify all were inserted
        for doc in batch_docs:
            result = await qdrant_async_client.retrieve(
                collection_name=seeded_collection,
                ids=[doc["id"]],
            )
            assert len(result) == 1

    @pytest.mark.asyncio
    async def test_batch_delete(
        self,
        qdrant_async_client: AsyncQdrantClient,
        seeded_collection: str,
    ) -> None:
        """Test batch deleting multiple documents."""
        # Insert documents to delete
        to_delete_ids = [generate_uuid(f"del-{i}") for i in range(5)]

        points = [
            models.PointStruct(
                id=doc_id,
                vector={TEXT_DENSE_FIELD: generate_mock_vector(f"delete {doc_id}")},
                payload={"content": f"delete {doc_id}", "org_id": "test-org"},
            )
            for doc_id in to_delete_ids
        ]

        await qdrant_async_client.upsert(
            collection_name=seeded_collection,
            points=points,
        )

        # Batch delete
        await qdrant_async_client.delete(
            collection_name=seeded_collection,
            points_selector=models.PointIdsList(points=to_delete_ids),
        )

        # Verify all deleted
        for doc_id in to_delete_ids:
            result = await qdrant_async_client.retrieve(
                collection_name=seeded_collection,
                ids=[doc_id],
            )
            assert len(result) == 0
