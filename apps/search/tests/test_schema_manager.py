"""Tests for Qdrant schema manager."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from qdrant_client.http import models

from search.clients.qdrant import QdrantClientWrapper
from search.config import Settings
from search.services.schema_manager import CollectionSchema, SchemaManager


class TestSchemaManager:
    """Tests for SchemaManager."""

    @pytest.fixture
    def mock_settings(self) -> Settings:
        """Create mock settings."""
        return Settings(
            qdrant_url="http://localhost:6333",
            qdrant_collection="test_collection",
        )

    @pytest.fixture
    def mock_qdrant_wrapper(self, mock_settings: Settings) -> QdrantClientWrapper:
        """Create mock Qdrant client wrapper."""
        wrapper = QdrantClientWrapper(mock_settings)
        wrapper._client = AsyncMock()
        return wrapper

    @pytest.fixture
    def schema_manager(
        self, mock_qdrant_wrapper: QdrantClientWrapper, mock_settings: Settings
    ) -> SchemaManager:
        """Create SchemaManager instance."""
        return SchemaManager(mock_qdrant_wrapper, mock_settings)

    @pytest.fixture
    def default_schema(self) -> CollectionSchema:
        """Create default collection schema."""
        return CollectionSchema(
            collection_name="test_collection",
            dense_vector_size=768,
            dense_vector_name="text_dense",
            sparse_vector_name="text_sparse",
            colbert_vector_name="text_colbert",
            colbert_vector_size=128,
            enable_colbert=True,
        )

    @pytest.mark.asyncio
    async def test_ensure_collection_creates_new(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
        default_schema: CollectionSchema,
    ) -> None:
        """Test ensure_collection creates new collection when it doesn't exist."""
        # Mock collection doesn't exist
        mock_qdrant_wrapper.collection_exists = AsyncMock(return_value=False)  # type: ignore[method-assign]
        mock_qdrant_wrapper.client.create_collection = AsyncMock()  # type: ignore[method-assign]

        result = await schema_manager.ensure_collection(default_schema)

        assert result is True
        mock_qdrant_wrapper.client.create_collection.assert_called_once()

    @pytest.mark.asyncio
    async def test_ensure_collection_exists_already(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
        default_schema: CollectionSchema,
    ) -> None:
        """Test ensure_collection returns False when collection already exists."""
        # Mock collection exists
        mock_qdrant_wrapper.collection_exists = AsyncMock(return_value=True)  # type: ignore[method-assign]

        result = await schema_manager.ensure_collection(default_schema)

        assert result is False
        mock_qdrant_wrapper.client.create_collection.assert_not_called()  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_create_collection_with_all_vectors(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
        default_schema: CollectionSchema,
    ) -> None:
        """Test create_collection with dense, sparse, and ColBERT vectors."""
        mock_qdrant_wrapper.client.create_collection = AsyncMock()  # type: ignore[method-assign]

        await schema_manager.create_collection(default_schema)

        # Verify create_collection was called
        call_args = mock_qdrant_wrapper.client.create_collection.call_args
        assert call_args.kwargs["collection_name"] == "test_collection"

        # Verify vectors_config has dense and colbert
        vectors_config = call_args.kwargs["vectors_config"]
        assert "text_dense" in vectors_config
        assert "text_colbert" in vectors_config

        # Verify dense vector config
        dense_config = vectors_config["text_dense"]
        assert dense_config.size == 768
        assert dense_config.distance == models.Distance.COSINE

        # Verify ColBERT multi-vector config
        colbert_config = vectors_config["text_colbert"]
        assert colbert_config.size == 128
        assert colbert_config.multivector_config is not None
        assert colbert_config.multivector_config.comparator == models.MultiVectorComparator.MAX_SIM

        # Verify sparse_vectors_config
        sparse_config = call_args.kwargs["sparse_vectors_config"]
        assert "text_sparse" in sparse_config

    @pytest.mark.asyncio
    async def test_create_collection_without_colbert(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
    ) -> None:
        """Test create_collection without ColBERT multi-vector."""
        schema = CollectionSchema(
            collection_name="test_collection",
            dense_vector_size=768,
            enable_colbert=False,
        )

        mock_qdrant_wrapper.client.create_collection = AsyncMock()  # type: ignore[method-assign]

        await schema_manager.create_collection(schema)

        # Verify ColBERT vector is not in config
        call_args = mock_qdrant_wrapper.client.create_collection.call_args
        vectors_config = call_args.kwargs["vectors_config"]
        assert "text_colbert" not in vectors_config
        assert "text_dense" in vectors_config

    @pytest.mark.asyncio
    async def test_delete_collection_success(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
    ) -> None:
        """Test successful collection deletion."""
        mock_qdrant_wrapper.collection_exists = AsyncMock(return_value=True)  # type: ignore[method-assign]
        mock_qdrant_wrapper.client.delete_collection = AsyncMock()  # type: ignore[method-assign]

        result = await schema_manager.delete_collection("test_collection")

        assert result is True
        mock_qdrant_wrapper.client.delete_collection.assert_called_once_with(
            collection_name="test_collection"
        )

    @pytest.mark.asyncio
    async def test_delete_collection_not_exists(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
    ) -> None:
        """Test deleting non-existent collection."""
        mock_qdrant_wrapper.collection_exists = AsyncMock(return_value=False)  # type: ignore[method-assign]

        result = await schema_manager.delete_collection("test_collection")

        assert result is False
        mock_qdrant_wrapper.client.delete_collection.assert_not_called()  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_get_collection_info_success(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
    ) -> None:
        """Test getting collection info."""
        # Create mock CollectionInfo
        mock_vectors_config = {
            "text_dense": models.VectorParams(size=768, distance=models.Distance.COSINE),
            "text_colbert": models.VectorParams(
                size=128,
                distance=models.Distance.COSINE,
                multivector_config=models.MultiVectorConfig(
                    comparator=models.MultiVectorComparator.MAX_SIM
                ),
            ),
        }

        mock_sparse_config = {"text_sparse": models.SparseVectorParams()}

        mock_params = MagicMock()
        mock_params.vectors = mock_vectors_config
        mock_params.sparse_vectors = mock_sparse_config

        mock_config = MagicMock()
        mock_config.params = mock_params

        mock_info = MagicMock()
        mock_info.status = models.CollectionStatus.GREEN
        mock_info.points_count = 100
        mock_info.indexed_vectors_count = 95
        mock_info.segments_count = 3
        mock_info.config = mock_config

        mock_qdrant_wrapper.get_collection_info = AsyncMock(return_value=mock_info)  # type: ignore[method-assign]

        info = await schema_manager.get_collection_info("test_collection")

        assert info is not None
        assert info["name"] == "test_collection"
        assert info["status"] == "green"
        assert info["points_count"] == 100
        assert info["indexed_vectors_count"] == 95
        assert info["segments_count"] == 3

        # Verify vectors config parsing
        vectors = info["config"]["params"]["vectors"]
        assert "text_dense" in vectors
        assert vectors["text_dense"]["size"] == 768
        assert vectors["text_dense"]["multivector"] is False

        assert "text_colbert" in vectors
        assert vectors["text_colbert"]["size"] == 128
        assert vectors["text_colbert"]["multivector"] is True

        # Verify sparse vectors
        sparse = info["config"]["params"]["sparse_vectors"]
        assert "text_sparse" in sparse

    @pytest.mark.asyncio
    async def test_get_collection_info_not_found(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
    ) -> None:
        """Test getting info for non-existent collection."""
        mock_qdrant_wrapper.get_collection_info = AsyncMock(return_value=None)  # type: ignore[method-assign]

        info = await schema_manager.get_collection_info("nonexistent")

        assert info is None

    @pytest.mark.asyncio
    async def test_update_collection_params(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
    ) -> None:
        """Test updating collection HNSW parameters."""
        mock_qdrant_wrapper.collection_exists = AsyncMock(return_value=True)  # type: ignore[method-assign]
        mock_qdrant_wrapper.client.update_collection = AsyncMock()  # type: ignore[method-assign]

        await schema_manager.update_collection_params(
            collection_name="test_collection",
            hnsw_m=32,
            hnsw_ef_construct=200,
        )

        # Verify update was called
        mock_qdrant_wrapper.client.update_collection.assert_called_once()
        call_args = mock_qdrant_wrapper.client.update_collection.call_args

        assert call_args.kwargs["collection_name"] == "test_collection"
        hnsw_config = call_args.kwargs["hnsw_config"]
        assert hnsw_config.m == 32
        assert hnsw_config.ef_construct == 200

    @pytest.mark.asyncio
    async def test_update_collection_params_not_exists(
        self,
        schema_manager: SchemaManager,
        mock_qdrant_wrapper: QdrantClientWrapper,
    ) -> None:
        """Test updating non-existent collection raises error."""
        mock_qdrant_wrapper.collection_exists = AsyncMock(return_value=False)  # type: ignore[method-assign]

        with pytest.raises(ValueError, match="does not exist"):
            await schema_manager.update_collection_params(
                collection_name="nonexistent",
                hnsw_m=32,
            )

    def test_collection_schema_defaults(self) -> None:
        """Test CollectionSchema default values."""
        schema = CollectionSchema(collection_name="test")

        assert schema.collection_name == "test"
        assert schema.dense_vector_size == 768
        assert schema.dense_vector_name == "text_dense"
        assert schema.sparse_vector_name == "text_sparse"
        assert schema.colbert_vector_name == "text_colbert"
        assert schema.colbert_vector_size == 128
        assert schema.enable_colbert is True
        assert schema.distance == models.Distance.COSINE
        assert schema.on_disk is False
        assert schema.hnsw_m == 16
        assert schema.hnsw_ef_construct == 100

    def test_collection_schema_custom_values(self) -> None:
        """Test CollectionSchema with custom values."""
        schema = CollectionSchema(
            collection_name="custom",
            dense_vector_size=1024,
            dense_vector_name="custom_dense",
            sparse_vector_name="custom_sparse",
            colbert_vector_name="custom_colbert",
            colbert_vector_size=256,
            enable_colbert=False,
            distance=models.Distance.DOT,
            on_disk=True,
            hnsw_m=32,
            hnsw_ef_construct=200,
        )

        assert schema.collection_name == "custom"
        assert schema.dense_vector_size == 1024
        assert schema.dense_vector_name == "custom_dense"
        assert schema.sparse_vector_name == "custom_sparse"
        assert schema.colbert_vector_name == "custom_colbert"
        assert schema.colbert_vector_size == 256
        assert schema.enable_colbert is False
        assert schema.distance == models.Distance.DOT
        assert schema.on_disk is True
        assert schema.hnsw_m == 32
        assert schema.hnsw_ef_construct == 200
