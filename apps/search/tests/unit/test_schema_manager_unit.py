"""Unit tests for schema manager with mocks.

These tests don't require a running Qdrant instance and can run in CI.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from qdrant_client.http import models
from qdrant_client.http.models import Distance

from src.config import Settings
from src.services.schema_manager import (
    CollectionSchema,
    SchemaManager,
    get_memory_collection_schema,
    get_turns_collection_schema,
)


class TestCollectionSchemaFactories:
    """Tests for collection schema factory functions."""

    def test_get_memory_collection_schema_default(self) -> None:
        """Test default memory collection schema."""
        schema = get_memory_collection_schema()
        assert schema.collection_name == "engram_memory"
        assert schema.dense_vector_size == 384
        assert schema.dense_vector_name == "text_dense"
        assert schema.sparse_vector_name == "text_sparse"
        assert schema.colbert_vector_name == "text_colbert"
        assert schema.colbert_vector_size == 128
        assert schema.enable_colbert is False
        assert schema.distance == Distance.COSINE

    def test_get_memory_collection_schema_custom_name(self) -> None:
        """Test memory collection schema with custom name."""
        schema = get_memory_collection_schema("custom_memory")
        assert schema.collection_name == "custom_memory"

    def test_get_turns_collection_schema_default(self) -> None:
        """Test default turns collection schema."""
        schema = get_turns_collection_schema()
        assert schema.collection_name == "engram_turns"
        assert schema.dense_vector_size == 384
        assert schema.dense_vector_name == "turn_dense"
        assert schema.sparse_vector_name == "turn_sparse"
        assert schema.colbert_vector_name == "turn_colbert"
        assert schema.colbert_vector_size == 128
        assert schema.enable_colbert is True
        assert schema.distance == Distance.COSINE

    def test_get_turns_collection_schema_custom_name(self) -> None:
        """Test turns collection schema with custom name."""
        schema = get_turns_collection_schema("custom_turns")
        assert schema.collection_name == "custom_turns"


class TestCollectionSchema:
    """Tests for CollectionSchema model."""

    def test_default_values(self) -> None:
        """Test schema with default values."""
        schema = CollectionSchema(collection_name="test")
        assert schema.collection_name == "test"
        assert schema.dense_vector_size == 768
        assert schema.dense_vector_name == "text_dense"
        assert schema.sparse_vector_name == "text_sparse"
        assert schema.colbert_vector_name == "text_colbert"
        assert schema.colbert_vector_size == 128
        assert schema.enable_colbert is True
        assert schema.distance == Distance.COSINE
        assert schema.on_disk is False
        assert schema.hnsw_m == 16
        assert schema.hnsw_ef_construct == 100

    def test_custom_values(self) -> None:
        """Test schema with custom values."""
        schema = CollectionSchema(
            collection_name="custom",
            dense_vector_size=1024,
            dense_vector_name="dense",
            sparse_vector_name="sparse",
            colbert_vector_name="colbert",
            colbert_vector_size=256,
            enable_colbert=False,
            distance=Distance.EUCLID,
            on_disk=True,
            hnsw_m=32,
            hnsw_ef_construct=200,
        )
        assert schema.collection_name == "custom"
        assert schema.dense_vector_size == 1024
        assert schema.dense_vector_name == "dense"
        assert schema.sparse_vector_name == "sparse"
        assert schema.colbert_vector_name == "colbert"
        assert schema.colbert_vector_size == 256
        assert schema.enable_colbert is False
        assert schema.distance == Distance.EUCLID
        assert schema.on_disk is True
        assert schema.hnsw_m == 32
        assert schema.hnsw_ef_construct == 200


class TestSchemaManager:
    """Unit tests for SchemaManager with mocked dependencies."""

    @pytest.fixture
    def mock_qdrant_client(self) -> MagicMock:
        """Create a mock Qdrant client wrapper."""
        mock = MagicMock()
        mock.client = AsyncMock()
        mock.collection_exists = AsyncMock()
        mock.get_collection_info = AsyncMock()
        return mock

    @pytest.fixture
    def mock_settings(self) -> MagicMock:
        """Create mock settings."""
        return MagicMock(spec=Settings)

    @pytest.fixture
    def schema_manager(
        self, mock_qdrant_client: MagicMock, mock_settings: MagicMock
    ) -> SchemaManager:
        """Create a schema manager with mocked dependencies."""
        return SchemaManager(mock_qdrant_client, mock_settings)

    @pytest.fixture
    def test_schema(self) -> CollectionSchema:
        """Create a test collection schema."""
        return CollectionSchema(
            collection_name="test_collection",
            dense_vector_size=384,
            dense_vector_name="dense",
            sparse_vector_name="sparse",
            enable_colbert=True,
            colbert_vector_name="colbert",
            colbert_vector_size=128,
        )

    @pytest.mark.asyncio
    async def test_initialization(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test schema manager initializes correctly."""
        assert schema_manager.qdrant is mock_qdrant_client

    @pytest.mark.asyncio
    async def test_ensure_collection_already_exists(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock, test_schema: CollectionSchema
    ) -> None:
        """Test ensure_collection returns False when collection exists."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=True)

        created = await schema_manager.ensure_collection(test_schema)

        assert created is False
        mock_qdrant_client.collection_exists.assert_called_once_with("test_collection")
        mock_qdrant_client.client.create_collection.assert_not_called()

    @pytest.mark.asyncio
    async def test_ensure_collection_creates_new(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock, test_schema: CollectionSchema
    ) -> None:
        """Test ensure_collection creates collection when it doesn't exist."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=False)

        created = await schema_manager.ensure_collection(test_schema)

        assert created is True
        mock_qdrant_client.client.create_collection.assert_called_once()

    @pytest.mark.asyncio
    async def test_ensure_collection_error_propagates(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock, test_schema: CollectionSchema
    ) -> None:
        """Test ensure_collection propagates errors."""
        mock_qdrant_client.collection_exists = AsyncMock(side_effect=Exception("Connection failed"))

        with pytest.raises(Exception, match="Connection failed"):
            await schema_manager.ensure_collection(test_schema)

    @pytest.mark.asyncio
    async def test_create_collection_with_colbert(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock, test_schema: CollectionSchema
    ) -> None:
        """Test create_collection includes ColBERT when enabled."""
        await schema_manager.create_collection(test_schema)

        mock_qdrant_client.client.create_collection.assert_called_once()
        call_kwargs = mock_qdrant_client.client.create_collection.call_args.kwargs

        assert call_kwargs["collection_name"] == "test_collection"
        assert "dense" in call_kwargs["vectors_config"]
        assert "colbert" in call_kwargs["vectors_config"]
        assert "sparse" in call_kwargs["sparse_vectors_config"]

    @pytest.mark.asyncio
    async def test_create_collection_without_colbert(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test create_collection excludes ColBERT when disabled."""
        schema = CollectionSchema(
            collection_name="test",
            enable_colbert=False,
        )

        await schema_manager.create_collection(schema)

        call_kwargs = mock_qdrant_client.client.create_collection.call_args.kwargs
        assert "text_dense" in call_kwargs["vectors_config"]
        assert "text_colbert" not in call_kwargs["vectors_config"]

    @pytest.mark.asyncio
    async def test_create_collection_error_propagates(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock, test_schema: CollectionSchema
    ) -> None:
        """Test create_collection propagates errors."""
        mock_qdrant_client.client.create_collection = AsyncMock(
            side_effect=Exception("Create failed")
        )

        with pytest.raises(Exception, match="Create failed"):
            await schema_manager.create_collection(test_schema)

    @pytest.mark.asyncio
    async def test_delete_collection_exists(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test delete_collection deletes existing collection."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=True)

        deleted = await schema_manager.delete_collection("test_collection")

        assert deleted is True
        mock_qdrant_client.client.delete_collection.assert_called_once_with(
            collection_name="test_collection"
        )

    @pytest.mark.asyncio
    async def test_delete_collection_not_exists(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test delete_collection returns False when collection doesn't exist."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=False)

        deleted = await schema_manager.delete_collection("test_collection")

        assert deleted is False
        mock_qdrant_client.client.delete_collection.assert_not_called()

    @pytest.mark.asyncio
    async def test_delete_collection_error_propagates(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test delete_collection propagates errors."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=True)
        mock_qdrant_client.client.delete_collection = AsyncMock(
            side_effect=Exception("Delete failed")
        )

        with pytest.raises(Exception, match="Delete failed"):
            await schema_manager.delete_collection("test_collection")

    @pytest.mark.asyncio
    async def test_get_collection_info_exists_named_vectors(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test get_collection_info returns info for collection with named vectors."""
        # Create mock collection info with named vectors
        mock_info = MagicMock()
        mock_info.status = MagicMock()
        mock_info.status.value = "green"
        mock_info.points_count = 1000
        mock_info.indexed_vectors_count = 950
        mock_info.segments_count = 4

        # Create named vectors config as a dict
        dense_params = MagicMock()
        dense_params.size = 384
        dense_params.distance = Distance.COSINE
        dense_params.on_disk = False
        dense_params.multivector_config = None

        sparse_keys = ["text_sparse"]

        mock_info.config = MagicMock()
        mock_info.config.params = MagicMock()
        mock_info.config.params.vectors = {"text_dense": dense_params}
        mock_info.config.params.sparse_vectors = {"text_sparse": MagicMock()}

        mock_qdrant_client.get_collection_info = AsyncMock(return_value=mock_info)

        info = await schema_manager.get_collection_info("test_collection")

        assert info is not None
        assert info["name"] == "test_collection"
        assert info["status"] == "green"
        assert info["points_count"] == 1000
        assert info["indexed_vectors_count"] == 950
        assert info["segments_count"] == 4
        assert "text_dense" in info["config"]["params"]["vectors"]
        assert info["config"]["params"]["vectors"]["text_dense"]["size"] == 384

    @pytest.mark.asyncio
    async def test_get_collection_info_exists_single_vector(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test get_collection_info returns info for collection with single vector."""
        # Create mock collection info with single (unnamed) vector
        mock_info = MagicMock()
        mock_info.status = MagicMock()
        mock_info.status.value = "green"
        mock_info.points_count = 500
        mock_info.indexed_vectors_count = 450
        mock_info.segments_count = 2

        # Create single vector config (not a dict)
        vector_params = MagicMock()
        vector_params.size = 768
        vector_params.distance = Distance.COSINE
        vector_params.on_disk = True
        vector_params.multivector_config = None

        mock_info.config = MagicMock()
        mock_info.config.params = MagicMock()
        mock_info.config.params.vectors = vector_params  # Single vector, not dict
        mock_info.config.params.sparse_vectors = None

        mock_qdrant_client.get_collection_info = AsyncMock(return_value=mock_info)

        info = await schema_manager.get_collection_info("test_collection")

        assert info is not None
        assert "default" in info["config"]["params"]["vectors"]
        assert info["config"]["params"]["vectors"]["default"]["size"] == 768
        assert info["config"]["params"]["vectors"]["default"]["on_disk"] is True

    @pytest.mark.asyncio
    async def test_get_collection_info_not_exists(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test get_collection_info returns None when collection doesn't exist."""
        mock_qdrant_client.get_collection_info = AsyncMock(return_value=None)

        info = await schema_manager.get_collection_info("test_collection")

        assert info is None

    @pytest.mark.asyncio
    async def test_get_collection_info_error_returns_none(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test get_collection_info returns None on error."""
        mock_qdrant_client.get_collection_info = AsyncMock(
            side_effect=Exception("Query failed")
        )

        info = await schema_manager.get_collection_info("test_collection")

        assert info is None

    @pytest.mark.asyncio
    async def test_get_collection_info_with_multivector(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test get_collection_info correctly identifies multivector."""
        mock_info = MagicMock()
        mock_info.status = MagicMock()
        mock_info.status.value = "green"
        mock_info.points_count = 100
        mock_info.indexed_vectors_count = 100
        mock_info.segments_count = 1

        # ColBERT vector with multivector config
        colbert_params = MagicMock()
        colbert_params.size = 128
        colbert_params.distance = Distance.COSINE
        colbert_params.on_disk = False
        colbert_params.multivector_config = MagicMock()  # Not None

        mock_info.config = MagicMock()
        mock_info.config.params = MagicMock()
        mock_info.config.params.vectors = {"text_colbert": colbert_params}
        mock_info.config.params.sparse_vectors = None

        mock_qdrant_client.get_collection_info = AsyncMock(return_value=mock_info)

        info = await schema_manager.get_collection_info("test_collection")

        assert info is not None
        assert info["config"]["params"]["vectors"]["text_colbert"]["multivector"] is True

    @pytest.mark.asyncio
    async def test_update_collection_params_success(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test update_collection_params updates HNSW config."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=True)

        await schema_manager.update_collection_params(
            "test_collection",
            hnsw_m=32,
            hnsw_ef_construct=200,
        )

        mock_qdrant_client.client.update_collection.assert_called_once()
        call_kwargs = mock_qdrant_client.client.update_collection.call_args.kwargs
        assert call_kwargs["collection_name"] == "test_collection"
        assert call_kwargs["hnsw_config"].m == 32
        assert call_kwargs["hnsw_config"].ef_construct == 200

    @pytest.mark.asyncio
    async def test_update_collection_params_partial(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test update_collection_params with partial update."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=True)

        await schema_manager.update_collection_params(
            "test_collection",
            hnsw_m=32,
        )

        call_kwargs = mock_qdrant_client.client.update_collection.call_args.kwargs
        assert call_kwargs["hnsw_config"].m == 32
        assert call_kwargs["hnsw_config"].ef_construct is None

    @pytest.mark.asyncio
    async def test_update_collection_params_not_exists(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test update_collection_params raises when collection doesn't exist."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=False)

        with pytest.raises(ValueError, match="does not exist"):
            await schema_manager.update_collection_params("test_collection", hnsw_m=32)

    @pytest.mark.asyncio
    async def test_update_collection_params_error_propagates(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test update_collection_params propagates errors."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=True)
        mock_qdrant_client.client.update_collection = AsyncMock(
            side_effect=Exception("Update failed")
        )

        with pytest.raises(Exception, match="Update failed"):
            await schema_manager.update_collection_params("test_collection", hnsw_m=32)

    @pytest.mark.asyncio
    async def test_ensure_tenant_index_success(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test ensure_tenant_index creates tenant-aware index."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=True)

        await schema_manager.ensure_tenant_index("test_collection")

        mock_qdrant_client.client.create_payload_index.assert_called_once()
        call_kwargs = mock_qdrant_client.client.create_payload_index.call_args.kwargs
        assert call_kwargs["collection_name"] == "test_collection"
        assert call_kwargs["field_name"] == "org_id"
        assert call_kwargs["wait"] is True
        # Check is_tenant flag
        field_schema = call_kwargs["field_schema"]
        assert field_schema.is_tenant is True

    @pytest.mark.asyncio
    async def test_ensure_tenant_index_not_exists(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test ensure_tenant_index raises when collection doesn't exist."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=False)

        with pytest.raises(ValueError, match="does not exist"):
            await schema_manager.ensure_tenant_index("test_collection")

    @pytest.mark.asyncio
    async def test_ensure_tenant_index_error_propagates(
        self, schema_manager: SchemaManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test ensure_tenant_index propagates errors."""
        mock_qdrant_client.collection_exists = AsyncMock(return_value=True)
        mock_qdrant_client.client.create_payload_index = AsyncMock(
            side_effect=Exception("Index creation failed")
        )

        with pytest.raises(Exception, match="Index creation failed"):
            await schema_manager.ensure_tenant_index("test_collection")
