"""Integration tests for SchemaManager with real Qdrant.

These tests verify collection creation, schema management, and tenant indexing
against a real Qdrant instance running in a testcontainer.
"""

import pytest
from qdrant_client import AsyncQdrantClient

from src.config import Settings
from src.services.schema_manager import (
    CollectionSchema,
    SchemaManager,
    get_memory_collection_schema,
    get_turns_collection_schema,
)


class MockQdrantWrapper:
    """Minimal wrapper for testing SchemaManager with real Qdrant client."""

    def __init__(self, client: AsyncQdrantClient) -> None:
        self.client = client

    async def collection_exists(self, collection_name: str) -> bool:
        """Check if collection exists."""
        try:
            collections = await self.client.get_collections()
            return any(c.name == collection_name for c in collections.collections)
        except Exception:
            return False

    async def get_collection_info(self, collection_name: str):
        """Get collection info."""
        try:
            return await self.client.get_collection(collection_name)
        except Exception:
            return None


@pytest.fixture
def mock_settings() -> Settings:
    """Create mock settings for testing."""
    return Settings(
        qdrant_url="http://localhost:6333",
        qdrant_collection="test_collection",
    )


@pytest.mark.integration
class TestSchemaManagerCollectionLifecycle:
    """Integration tests for collection creation and deletion."""

    @pytest.mark.asyncio
    async def test_create_memory_collection(
        self,
        qdrant_async_client: AsyncQdrantClient,
        mock_settings: Settings,
    ) -> None:
        """Test creating a memory collection with correct schema."""
        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = SchemaManager(wrapper, mock_settings)  # type: ignore[arg-type]

        schema = get_memory_collection_schema("test_memory_collection")

        # Ensure collection doesn't exist
        try:
            await qdrant_async_client.delete_collection("test_memory_collection")
        except Exception:
            pass

        # Create collection
        created = await manager.ensure_collection(schema)
        assert created is True

        # Verify collection exists with correct config
        info = await manager.get_collection_info("test_memory_collection")
        assert info is not None
        assert info["name"] == "test_memory_collection"
        assert info["status"] == "green"

        # Verify vector configs
        vectors = info["config"]["params"]["vectors"]
        assert "text_dense" in vectors
        assert vectors["text_dense"]["size"] == 384
        assert vectors["text_dense"]["distance"] == "Cosine"

        # Verify sparse vector config
        sparse_vectors = info["config"]["params"]["sparse_vectors"]
        assert "text_sparse" in sparse_vectors

        # Cleanup
        await manager.delete_collection("test_memory_collection")

    @pytest.mark.asyncio
    async def test_create_turns_collection_with_colbert(
        self,
        qdrant_async_client: AsyncQdrantClient,
        mock_settings: Settings,
    ) -> None:
        """Test creating a turns collection with ColBERT multi-vector."""
        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = SchemaManager(wrapper, mock_settings)  # type: ignore[arg-type]

        schema = get_turns_collection_schema("test_turns_collection")

        # Ensure collection doesn't exist
        try:
            await qdrant_async_client.delete_collection("test_turns_collection")
        except Exception:
            pass

        # Create collection
        created = await manager.ensure_collection(schema)
        assert created is True

        # Verify collection exists
        info = await manager.get_collection_info("test_turns_collection")
        assert info is not None

        # Verify vector configs including ColBERT
        vectors = info["config"]["params"]["vectors"]
        assert "turn_dense" in vectors
        assert vectors["turn_dense"]["size"] == 384

        # ColBERT multi-vector should be present
        assert "turn_colbert" in vectors
        assert vectors["turn_colbert"]["size"] == 128
        assert vectors["turn_colbert"]["multivector"] is True

        # Verify sparse vector
        sparse_vectors = info["config"]["params"]["sparse_vectors"]
        assert "turn_sparse" in sparse_vectors

        # Cleanup
        await manager.delete_collection("test_turns_collection")

    @pytest.mark.asyncio
    async def test_ensure_collection_idempotent(
        self,
        qdrant_async_client: AsyncQdrantClient,
        mock_settings: Settings,
    ) -> None:
        """Test that ensure_collection is idempotent (doesn't recreate existing collection)."""
        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = SchemaManager(wrapper, mock_settings)  # type: ignore[arg-type]

        schema = CollectionSchema(
            collection_name="test_idempotent",
            dense_vector_size=384,
            dense_vector_name="text_dense",
            enable_colbert=False,
        )

        # Cleanup first
        try:
            await qdrant_async_client.delete_collection("test_idempotent")
        except Exception:
            pass

        # First call should create
        created1 = await manager.ensure_collection(schema)
        assert created1 is True

        # Second call should not recreate
        created2 = await manager.ensure_collection(schema)
        assert created2 is False

        # Cleanup
        await manager.delete_collection("test_idempotent")

    @pytest.mark.asyncio
    async def test_delete_collection(
        self,
        qdrant_async_client: AsyncQdrantClient,
        mock_settings: Settings,
    ) -> None:
        """Test deleting a collection."""
        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = SchemaManager(wrapper, mock_settings)  # type: ignore[arg-type]

        schema = CollectionSchema(
            collection_name="test_delete",
            dense_vector_size=384,
            enable_colbert=False,
        )

        # Create collection first
        await manager.ensure_collection(schema)

        # Delete should succeed
        deleted = await manager.delete_collection("test_delete")
        assert deleted is True

        # Delete again should return False (doesn't exist)
        deleted2 = await manager.delete_collection("test_delete")
        assert deleted2 is False

    @pytest.mark.asyncio
    async def test_get_collection_info_nonexistent(
        self,
        qdrant_async_client: AsyncQdrantClient,
        mock_settings: Settings,
    ) -> None:
        """Test getting info for a collection that doesn't exist."""
        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = SchemaManager(wrapper, mock_settings)  # type: ignore[arg-type]

        info = await manager.get_collection_info("nonexistent_collection_xyz")
        assert info is None


@pytest.mark.integration
class TestSchemaManagerTenantIndex:
    """Integration tests for tenant-aware indexing."""

    @pytest.mark.asyncio
    async def test_ensure_tenant_index(
        self,
        qdrant_async_client: AsyncQdrantClient,
        mock_settings: Settings,
    ) -> None:
        """Test creating a tenant-aware index on org_id field."""
        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = SchemaManager(wrapper, mock_settings)  # type: ignore[arg-type]

        collection_name = "test_tenant_index"

        # Create collection first
        schema = CollectionSchema(
            collection_name=collection_name,
            dense_vector_size=384,
            enable_colbert=False,
        )

        # Cleanup first
        try:
            await qdrant_async_client.delete_collection(collection_name)
        except Exception:
            pass

        await manager.ensure_collection(schema)

        # Create tenant index
        await manager.ensure_tenant_index(collection_name)

        # Verify index was created by checking collection info
        # Note: Qdrant doesn't expose index details in collection info,
        # but we can verify the collection is still functional
        info = await manager.get_collection_info(collection_name)
        assert info is not None
        assert info["status"] == "green"

        # Cleanup
        await manager.delete_collection(collection_name)

    @pytest.mark.asyncio
    async def test_tenant_index_on_nonexistent_collection(
        self,
        qdrant_async_client: AsyncQdrantClient,
        mock_settings: Settings,
    ) -> None:
        """Test that creating tenant index on nonexistent collection raises error."""
        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = SchemaManager(wrapper, mock_settings)  # type: ignore[arg-type]

        with pytest.raises(ValueError, match="does not exist"):
            await manager.ensure_tenant_index("nonexistent_tenant_collection")


@pytest.mark.integration
class TestSchemaManagerUpdateParams:
    """Integration tests for updating collection parameters."""

    @pytest.mark.asyncio
    async def test_update_hnsw_params(
        self,
        qdrant_async_client: AsyncQdrantClient,
        mock_settings: Settings,
    ) -> None:
        """Test updating HNSW parameters on existing collection."""
        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = SchemaManager(wrapper, mock_settings)  # type: ignore[arg-type]

        collection_name = "test_update_params"

        # Create collection with default params
        schema = CollectionSchema(
            collection_name=collection_name,
            dense_vector_size=384,
            enable_colbert=False,
            hnsw_m=16,
            hnsw_ef_construct=100,
        )

        # Cleanup first
        try:
            await qdrant_async_client.delete_collection(collection_name)
        except Exception:
            pass

        await manager.ensure_collection(schema)

        # Update params
        await manager.update_collection_params(
            collection_name=collection_name,
            hnsw_m=32,
            hnsw_ef_construct=200,
        )

        # Verify collection still works
        info = await manager.get_collection_info(collection_name)
        assert info is not None
        assert info["status"] == "green"

        # Cleanup
        await manager.delete_collection(collection_name)

    @pytest.mark.asyncio
    async def test_update_params_nonexistent_collection(
        self,
        qdrant_async_client: AsyncQdrantClient,
        mock_settings: Settings,
    ) -> None:
        """Test updating params on nonexistent collection raises error."""
        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = SchemaManager(wrapper, mock_settings)  # type: ignore[arg-type]

        with pytest.raises(ValueError, match="does not exist"):
            await manager.update_collection_params(
                "nonexistent_update_collection",
                hnsw_m=32,
            )
