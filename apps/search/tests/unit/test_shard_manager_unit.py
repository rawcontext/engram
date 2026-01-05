"""Unit tests for shard manager with mocks.

These tests don't require a running Qdrant instance and can run in CI.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from qdrant_client.http import models

from src.services.shard_manager import ShardManager, ShardManagerConfig


class TestShardManagerConfig:
    """Tests for ShardManagerConfig."""

    def test_default_config(self) -> None:
        """Test default configuration values."""
        config = ShardManagerConfig()
        assert config.promotion_threshold == 20_000
        assert config.max_dedicated_shards == 1000
        assert config.replication_factor is None
        assert config.shards_number is None

    def test_custom_config(self) -> None:
        """Test custom configuration values."""
        config = ShardManagerConfig(
            promotion_threshold=5000,
            max_dedicated_shards=500,
            replication_factor=2,
            shards_number=3,
        )
        assert config.promotion_threshold == 5000
        assert config.max_dedicated_shards == 500
        assert config.replication_factor == 2
        assert config.shards_number == 3


class TestShardManager:
    """Unit tests for ShardManager with mocked dependencies."""

    @pytest.fixture
    def mock_qdrant_client(self) -> MagicMock:
        """Create a mock Qdrant client wrapper."""
        mock = MagicMock()
        mock.client = AsyncMock()
        mock.get_collection_info = AsyncMock()
        return mock

    @pytest.fixture
    def mock_registry(self) -> MagicMock:
        """Create a mock shard registry."""
        mock = MagicMock()
        mock.has_dedicated_shard = AsyncMock(return_value=False)
        mock.register_shard = AsyncMock()
        return mock

    @pytest.fixture
    def shard_config(self) -> ShardManagerConfig:
        """Create a test shard manager configuration."""
        return ShardManagerConfig(
            promotion_threshold=1000,
            max_dedicated_shards=100,
            replication_factor=1,
        )

    @pytest.fixture
    def shard_manager(
        self, mock_qdrant_client: MagicMock, shard_config: ShardManagerConfig
    ) -> ShardManager:
        """Create a shard manager with mocked dependencies."""
        return ShardManager(mock_qdrant_client, shard_config)

    @pytest.fixture
    def shard_manager_with_registry(
        self,
        mock_qdrant_client: MagicMock,
        shard_config: ShardManagerConfig,
        mock_registry: MagicMock,
    ) -> ShardManager:
        """Create a shard manager with mocked registry."""
        return ShardManager(mock_qdrant_client, shard_config, mock_registry)

    @pytest.mark.asyncio
    async def test_initialization(
        self, shard_manager: ShardManager, shard_config: ShardManagerConfig
    ) -> None:
        """Test shard manager initializes with correct config."""
        assert shard_manager.config.promotion_threshold == shard_config.promotion_threshold
        assert shard_manager.config.max_dedicated_shards == shard_config.max_dedicated_shards
        assert shard_manager.config.replication_factor == shard_config.replication_factor
        assert shard_manager.registry is None

    @pytest.mark.asyncio
    async def test_initialization_with_registry(
        self,
        shard_manager_with_registry: ShardManager,
        mock_registry: MagicMock,
    ) -> None:
        """Test shard manager initializes with registry."""
        assert shard_manager_with_registry.registry is mock_registry

    @pytest.mark.asyncio
    async def test_get_tenant_vector_count_success(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test getting vector count for a tenant."""
        mock_count_result = MagicMock()
        mock_count_result.count = 500
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)

        count = await shard_manager.get_tenant_vector_count("test_collection", "org_123")

        assert count == 500
        mock_qdrant_client.client.count.assert_called_once()
        call_args = mock_qdrant_client.client.count.call_args
        assert call_args.kwargs["collection_name"] == "test_collection"
        assert call_args.kwargs["exact"] is True

    @pytest.mark.asyncio
    async def test_get_tenant_vector_count_empty(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test getting vector count returns 0 for empty result."""
        mock_qdrant_client.client.count = AsyncMock(return_value=None)

        count = await shard_manager.get_tenant_vector_count("test_collection", "org_123")

        assert count == 0

    @pytest.mark.asyncio
    async def test_get_tenant_vector_count_zero_count(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test getting vector count when tenant has no vectors."""
        mock_count_result = MagicMock()
        mock_count_result.count = 0
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)

        count = await shard_manager.get_tenant_vector_count("test_collection", "org_123")

        assert count == 0

    @pytest.mark.asyncio
    async def test_get_tenant_vector_count_error(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test getting vector count raises on error."""
        mock_qdrant_client.client.count = AsyncMock(side_effect=Exception("Connection failed"))

        with pytest.raises(Exception, match="Connection failed"):
            await shard_manager.get_tenant_vector_count("test_collection", "org_123")

    @pytest.mark.asyncio
    async def test_should_promote_tenant_below_threshold(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test should_promote returns False when below threshold."""
        mock_count_result = MagicMock()
        mock_count_result.count = 500  # Below 1000 threshold
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.get_collection_info = AsyncMock(return_value=MagicMock())

        should_promote = await shard_manager.should_promote_tenant("test_collection", "org_123")

        assert should_promote is False

    @pytest.mark.asyncio
    async def test_should_promote_tenant_above_threshold(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test should_promote returns True when above threshold."""
        mock_count_result = MagicMock()
        mock_count_result.count = 1500  # Above 1000 threshold
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.get_collection_info = AsyncMock(return_value=MagicMock())

        should_promote = await shard_manager.should_promote_tenant("test_collection", "org_123")

        assert should_promote is True

    @pytest.mark.asyncio
    async def test_should_promote_tenant_at_threshold(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test should_promote returns True when exactly at threshold."""
        mock_count_result = MagicMock()
        mock_count_result.count = 1000  # Exactly at 1000 threshold
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.get_collection_info = AsyncMock(return_value=MagicMock())

        should_promote = await shard_manager.should_promote_tenant("test_collection", "org_123")

        assert should_promote is True

    @pytest.mark.asyncio
    async def test_should_promote_tenant_already_has_shard_via_registry(
        self, shard_manager_with_registry: ShardManager, mock_registry: MagicMock
    ) -> None:
        """Test should_promote returns False when tenant already has dedicated shard."""
        mock_registry.has_dedicated_shard = AsyncMock(return_value=True)

        should_promote = await shard_manager_with_registry.should_promote_tenant(
            "test_collection", "org_123"
        )

        assert should_promote is False
        mock_registry.has_dedicated_shard.assert_called_once_with("test_collection", "org_123")

    @pytest.mark.asyncio
    async def test_should_promote_tenant_error_returns_false(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test should_promote returns False on error (conservative)."""
        mock_qdrant_client.get_collection_info = AsyncMock(
            side_effect=Exception("Connection failed")
        )

        should_promote = await shard_manager.should_promote_tenant("test_collection", "org_123")

        assert should_promote is False

    @pytest.mark.asyncio
    async def test_has_dedicated_shard_with_registry_true(
        self, shard_manager_with_registry: ShardManager, mock_registry: MagicMock
    ) -> None:
        """Test has_dedicated_shard uses registry when available."""
        mock_registry.has_dedicated_shard = AsyncMock(return_value=True)

        has_shard = await shard_manager_with_registry.has_dedicated_shard(
            "test_collection", "org_123"
        )

        assert has_shard is True
        mock_registry.has_dedicated_shard.assert_called_once_with("test_collection", "org_123")

    @pytest.mark.asyncio
    async def test_has_dedicated_shard_with_registry_false(
        self, shard_manager_with_registry: ShardManager, mock_registry: MagicMock
    ) -> None:
        """Test has_dedicated_shard returns False from registry."""
        mock_registry.has_dedicated_shard = AsyncMock(return_value=False)

        has_shard = await shard_manager_with_registry.has_dedicated_shard(
            "test_collection", "org_123"
        )

        assert has_shard is False

    @pytest.mark.asyncio
    async def test_has_dedicated_shard_without_registry_no_collection(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test has_dedicated_shard returns False when collection not found."""
        mock_qdrant_client.get_collection_info = AsyncMock(return_value=None)

        has_shard = await shard_manager.has_dedicated_shard("test_collection", "org_123")

        assert has_shard is False

    @pytest.mark.asyncio
    async def test_has_dedicated_shard_without_registry_with_collection(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test has_dedicated_shard returns False without registry (conservative)."""
        mock_qdrant_client.get_collection_info = AsyncMock(return_value=MagicMock())

        has_shard = await shard_manager.has_dedicated_shard("test_collection", "org_123")

        assert has_shard is False

    @pytest.mark.asyncio
    async def test_has_dedicated_shard_error_returns_false(
        self, shard_manager_with_registry: ShardManager, mock_registry: MagicMock
    ) -> None:
        """Test has_dedicated_shard returns False on error."""
        mock_registry.has_dedicated_shard = AsyncMock(side_effect=Exception("DB error"))

        has_shard = await shard_manager_with_registry.has_dedicated_shard(
            "test_collection", "org_123"
        )

        assert has_shard is False

    @pytest.mark.asyncio
    async def test_promote_tenant_to_dedicated_shard_success(
        self,
        shard_manager_with_registry: ShardManager,
        mock_qdrant_client: MagicMock,
        mock_registry: MagicMock,
    ) -> None:
        """Test promoting a tenant to dedicated shard."""
        mock_registry.has_dedicated_shard = AsyncMock(return_value=False)
        mock_count_result = MagicMock()
        mock_count_result.count = 25000
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.client.create_shard_key = AsyncMock()

        await shard_manager_with_registry.promote_tenant_to_dedicated_shard(
            "test_collection", "org_123"
        )

        mock_qdrant_client.client.create_shard_key.assert_called_once()
        call_args = mock_qdrant_client.client.create_shard_key.call_args
        assert call_args.kwargs["collection_name"] == "test_collection"
        assert call_args.kwargs["shard_key"] == "org_123"
        assert call_args.kwargs["replication_factor"] == 1

        mock_registry.register_shard.assert_called_once_with(
            collection_name="test_collection",
            org_id="org_123",
            vector_count=25000,
            replication_factor=1,
            shards_number=None,
        )

    @pytest.mark.asyncio
    async def test_promote_tenant_already_promoted_skips(
        self,
        shard_manager_with_registry: ShardManager,
        mock_qdrant_client: MagicMock,
        mock_registry: MagicMock,
    ) -> None:
        """Test promoting skips if tenant already has dedicated shard."""
        mock_registry.has_dedicated_shard = AsyncMock(return_value=True)

        await shard_manager_with_registry.promote_tenant_to_dedicated_shard(
            "test_collection", "org_123"
        )

        mock_qdrant_client.client.create_shard_key.assert_not_called()
        mock_registry.register_shard.assert_not_called()

    @pytest.mark.asyncio
    async def test_promote_tenant_error_propagates(
        self,
        shard_manager_with_registry: ShardManager,
        mock_qdrant_client: MagicMock,
        mock_registry: MagicMock,
    ) -> None:
        """Test promoting raises on error."""
        mock_registry.has_dedicated_shard = AsyncMock(return_value=False)
        mock_count_result = MagicMock()
        mock_count_result.count = 25000
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.client.create_shard_key = AsyncMock(
            side_effect=Exception("Shard creation failed")
        )

        with pytest.raises(Exception, match="Shard creation failed"):
            await shard_manager_with_registry.promote_tenant_to_dedicated_shard(
                "test_collection", "org_123"
            )

    @pytest.mark.asyncio
    async def test_get_tenant_stats_success(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test getting comprehensive tenant statistics."""
        mock_count_result = MagicMock()
        mock_count_result.count = 500
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.get_collection_info = AsyncMock(return_value=MagicMock())

        stats = await shard_manager.get_tenant_stats("test_collection", "org_123")

        assert stats["org_id"] == "org_123"
        assert stats["collection_name"] == "test_collection"
        assert stats["vector_count"] == 500
        assert stats["has_dedicated_shard"] is False
        assert stats["should_promote"] is False
        assert stats["promotion_threshold"] == 1000
        assert stats["percentage_of_threshold"] == 50.0

    @pytest.mark.asyncio
    async def test_get_tenant_stats_above_threshold(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test tenant stats when above promotion threshold."""
        mock_count_result = MagicMock()
        mock_count_result.count = 1500
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.get_collection_info = AsyncMock(return_value=MagicMock())

        stats = await shard_manager.get_tenant_stats("test_collection", "org_123")

        assert stats["vector_count"] == 1500
        assert stats["should_promote"] is True
        assert stats["percentage_of_threshold"] == 150.0

    @pytest.mark.asyncio
    async def test_get_tenant_stats_zero_threshold(
        self, mock_qdrant_client: MagicMock
    ) -> None:
        """Test tenant stats with zero threshold."""
        config = ShardManagerConfig(promotion_threshold=0)
        manager = ShardManager(mock_qdrant_client, config)

        mock_count_result = MagicMock()
        mock_count_result.count = 100
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.get_collection_info = AsyncMock(return_value=MagicMock())

        stats = await manager.get_tenant_stats("test_collection", "org_123")

        assert stats["percentage_of_threshold"] == 0

    @pytest.mark.asyncio
    async def test_get_tenant_stats_error_propagates(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test tenant stats raises on error."""
        mock_qdrant_client.client.count = AsyncMock(side_effect=Exception("Query failed"))

        with pytest.raises(Exception, match="Query failed"):
            await shard_manager.get_tenant_stats("test_collection", "org_123")

    @pytest.mark.asyncio
    async def test_check_and_promote_if_needed_promotes(
        self,
        shard_manager_with_registry: ShardManager,
        mock_qdrant_client: MagicMock,
        mock_registry: MagicMock,
    ) -> None:
        """Test check_and_promote promotes when above threshold."""
        mock_registry.has_dedicated_shard = AsyncMock(return_value=False)
        mock_count_result = MagicMock()
        mock_count_result.count = 1500
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.client.create_shard_key = AsyncMock()

        promoted = await shard_manager_with_registry.check_and_promote_if_needed(
            "test_collection", "org_123"
        )

        assert promoted is True
        mock_qdrant_client.client.create_shard_key.assert_called_once()

    @pytest.mark.asyncio
    async def test_check_and_promote_if_needed_does_not_promote(
        self,
        shard_manager_with_registry: ShardManager,
        mock_qdrant_client: MagicMock,
        mock_registry: MagicMock,
    ) -> None:
        """Test check_and_promote does not promote when below threshold."""
        mock_registry.has_dedicated_shard = AsyncMock(return_value=False)
        mock_count_result = MagicMock()
        mock_count_result.count = 500
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)

        promoted = await shard_manager_with_registry.check_and_promote_if_needed(
            "test_collection", "org_123"
        )

        assert promoted is False
        mock_qdrant_client.client.create_shard_key.assert_not_called()

    @pytest.mark.asyncio
    async def test_check_and_promote_if_needed_error_returns_false(
        self, shard_manager: ShardManager, mock_qdrant_client: MagicMock
    ) -> None:
        """Test check_and_promote returns False on error."""
        mock_qdrant_client.get_collection_info = AsyncMock(
            side_effect=Exception("Connection failed")
        )

        promoted = await shard_manager.check_and_promote_if_needed("test_collection", "org_123")

        assert promoted is False

    @pytest.mark.asyncio
    async def test_promote_with_shards_number(
        self, mock_qdrant_client: MagicMock, mock_registry: MagicMock
    ) -> None:
        """Test promoting with custom shards_number."""
        config = ShardManagerConfig(
            promotion_threshold=1000,
            shards_number=4,
            replication_factor=2,
        )
        manager = ShardManager(mock_qdrant_client, config, mock_registry)

        mock_registry.has_dedicated_shard = AsyncMock(return_value=False)
        mock_count_result = MagicMock()
        mock_count_result.count = 1500
        mock_qdrant_client.client.count = AsyncMock(return_value=mock_count_result)
        mock_qdrant_client.client.create_shard_key = AsyncMock()

        await manager.promote_tenant_to_dedicated_shard("test_collection", "org_123")

        call_args = mock_qdrant_client.client.create_shard_key.call_args
        assert call_args.kwargs["shards_number"] == 4
        assert call_args.kwargs["replication_factor"] == 2
