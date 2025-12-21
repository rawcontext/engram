"""Comprehensive tests for Qdrant client wrapper."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from qdrant_client.http import models

from src.clients.qdrant import QdrantClientWrapper
from src.config import Settings


class TestQdrantClientWrapper:
    """Tests for QdrantClientWrapper."""

    @pytest.fixture
    def settings(self) -> Settings:
        """Create test settings."""
        return Settings(
            qdrant_url="http://localhost:6333",
            qdrant_collection="test_collection",
            qdrant_timeout=30.0,
            qdrant_prefer_grpc=False,
            qdrant_grpc_port=None,
        )

    @pytest.fixture
    def settings_with_grpc(self) -> Settings:
        """Create test settings with gRPC enabled."""
        return Settings(
            qdrant_url="http://localhost:6333",
            qdrant_collection="test_collection",
            qdrant_timeout=30.0,
            qdrant_prefer_grpc=True,
            qdrant_grpc_port=6334,
        )

    @pytest.fixture
    def mock_async_client(self):
        """Create mock AsyncQdrantClient."""
        with patch("src.clients.qdrant.AsyncQdrantClient") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value = mock_client
            yield mock_client

    def test_initialization(self, settings: Settings) -> None:
        """Test wrapper initialization."""
        wrapper = QdrantClientWrapper(settings)

        assert wrapper.settings is settings
        assert wrapper._client is None
        assert wrapper._collection_name == "test_collection"

    async def test_connect_success(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test successful connection."""
        mock_collection_info = MagicMock()
        mock_async_client.get_collection = AsyncMock(return_value=mock_collection_info)

        wrapper = QdrantClientWrapper(settings)
        await wrapper.connect()

        assert wrapper._client is mock_async_client
        mock_async_client.get_collection.assert_called_with(collection_name="test_collection")

    async def test_connect_with_grpc(
        self, settings_with_grpc: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test connection with gRPC port configured."""
        with patch("src.clients.qdrant.AsyncQdrantClient") as mock_cls:
            mock_cls.return_value = mock_async_client
            mock_async_client.get_collection = AsyncMock()

            wrapper = QdrantClientWrapper(settings_with_grpc)
            await wrapper.connect()

            # Verify gRPC port was passed
            mock_cls.assert_called_once()
            call_kwargs = mock_cls.call_args.kwargs
            assert call_kwargs["grpc_port"] == 6334
            assert call_kwargs["prefer_grpc"] is True

    async def test_connect_collection_not_exists(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test connection when collection doesn't exist."""
        mock_async_client.get_collection = AsyncMock(side_effect=Exception("Not found"))

        wrapper = QdrantClientWrapper(settings)
        # Should not raise, just log warning
        await wrapper.connect()

        assert wrapper._client is mock_async_client

    async def test_close(self, settings: Settings, mock_async_client: AsyncMock) -> None:
        """Test closing connection."""
        mock_async_client.close = AsyncMock()

        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        await wrapper.close()

        assert wrapper._client is None
        mock_async_client.close.assert_called_once()

    async def test_close_when_not_connected(self, settings: Settings) -> None:
        """Test closing when not connected does nothing."""
        wrapper = QdrantClientWrapper(settings)
        # Should not raise
        await wrapper.close()

    def test_client_property_connected(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test client property when connected."""
        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        assert wrapper.client is mock_async_client

    def test_client_property_not_connected(self, settings: Settings) -> None:
        """Test client property raises when not connected."""
        wrapper = QdrantClientWrapper(settings)

        with pytest.raises(RuntimeError, match="not connected"):
            _ = wrapper.client

    async def test_health_check_healthy(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test health check returns True when healthy."""
        mock_async_client.get_collection = AsyncMock()

        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        result = await wrapper.health_check()

        assert result is True
        mock_async_client.get_collection.assert_called_with(
            collection_name="test_collection"
        )

    async def test_health_check_unhealthy(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test health check returns False on error."""
        mock_async_client.get_collection = AsyncMock(side_effect=Exception("Error"))

        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        result = await wrapper.health_check()

        assert result is False

    async def test_health_check_not_connected(self, settings: Settings) -> None:
        """Test health check returns False when not connected."""
        wrapper = QdrantClientWrapper(settings)

        result = await wrapper.health_check()

        assert result is False

    async def test_collection_exists_true(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test collection_exists returns True when collection exists."""
        mock_async_client.get_collection = AsyncMock()

        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        result = await wrapper.collection_exists()

        assert result is True

    async def test_collection_exists_false(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test collection_exists returns False when collection doesn't exist."""
        mock_async_client.get_collection = AsyncMock(side_effect=Exception("Not found"))

        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        result = await wrapper.collection_exists()

        assert result is False

    async def test_collection_exists_custom_name(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test collection_exists with custom collection name."""
        mock_async_client.get_collection = AsyncMock()

        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        result = await wrapper.collection_exists("custom_collection")

        assert result is True
        mock_async_client.get_collection.assert_called_with(
            collection_name="custom_collection"
        )

    async def test_collection_exists_not_connected(self, settings: Settings) -> None:
        """Test collection_exists returns False when not connected."""
        wrapper = QdrantClientWrapper(settings)

        result = await wrapper.collection_exists()

        assert result is False

    async def test_get_collection_info_success(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test get_collection_info returns info."""
        mock_info = MagicMock(spec=models.CollectionInfo)
        mock_async_client.get_collection = AsyncMock(return_value=mock_info)

        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        result = await wrapper.get_collection_info()

        assert result is mock_info

    async def test_get_collection_info_custom_name(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test get_collection_info with custom collection name."""
        mock_info = MagicMock(spec=models.CollectionInfo)
        mock_async_client.get_collection = AsyncMock(return_value=mock_info)

        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        result = await wrapper.get_collection_info("custom_collection")

        assert result is mock_info
        mock_async_client.get_collection.assert_called_with(
            collection_name="custom_collection"
        )

    async def test_get_collection_info_error(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test get_collection_info returns None on error."""
        mock_async_client.get_collection = AsyncMock(side_effect=Exception("Error"))

        wrapper = QdrantClientWrapper(settings)
        wrapper._client = mock_async_client

        result = await wrapper.get_collection_info()

        assert result is None

    async def test_get_collection_info_not_connected(self, settings: Settings) -> None:
        """Test get_collection_info returns None when not connected."""
        wrapper = QdrantClientWrapper(settings)

        result = await wrapper.get_collection_info()

        assert result is None

    async def test_context_manager_enter(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test async context manager entry."""
        mock_async_client.get_collection = AsyncMock()
        mock_async_client.close = AsyncMock()

        wrapper = QdrantClientWrapper(settings)

        async with wrapper as w:
            assert w is wrapper
            assert wrapper._client is mock_async_client

    async def test_context_manager_exit(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test async context manager exit."""
        mock_async_client.get_collection = AsyncMock()
        mock_async_client.close = AsyncMock()

        wrapper = QdrantClientWrapper(settings)

        async with wrapper:
            pass

        assert wrapper._client is None
        mock_async_client.close.assert_called_once()

    async def test_context_manager_exit_with_exception(
        self, settings: Settings, mock_async_client: AsyncMock
    ) -> None:
        """Test async context manager exit on exception."""
        mock_async_client.get_collection = AsyncMock()
        mock_async_client.close = AsyncMock()

        wrapper = QdrantClientWrapper(settings)

        try:
            async with wrapper:
                raise ValueError("Test error")
        except ValueError:
            pass

        # Should still close connection
        mock_async_client.close.assert_called_once()
