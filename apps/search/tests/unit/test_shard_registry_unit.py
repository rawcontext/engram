"""Unit tests for shard registry with mocks.

These tests don't require a running PostgreSQL instance and can run in CI.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.shard_registry import ShardRegistry, ShardRegistryEntry


class TestShardRegistryEntry:
    """Tests for ShardRegistryEntry model."""

    def test_entry_creation(self) -> None:
        """Test creating a shard registry entry."""
        now = datetime.now(UTC)
        entry = ShardRegistryEntry(
            org_id="org_123",
            collection_name="test_collection",
            promoted_at=now,
            vector_count_at_promotion=25000,
            replication_factor=2,
            shards_number=4,
        )
        assert entry.org_id == "org_123"
        assert entry.collection_name == "test_collection"
        assert entry.promoted_at == now
        assert entry.vector_count_at_promotion == 25000
        assert entry.replication_factor == 2
        assert entry.shards_number == 4

    def test_entry_optional_fields(self) -> None:
        """Test entry with optional fields as None."""
        entry = ShardRegistryEntry(
            org_id="org_123",
            collection_name="test_collection",
            promoted_at=datetime.now(UTC),
            vector_count_at_promotion=25000,
        )
        assert entry.replication_factor is None
        assert entry.shards_number is None


class TestShardRegistry:
    """Unit tests for ShardRegistry with mocked database."""

    @pytest.fixture
    def registry(self) -> ShardRegistry:
        """Create a shard registry instance."""
        return ShardRegistry("postgresql://localhost:5432/test")

    @pytest.fixture
    def mock_pool(self) -> MagicMock:
        """Create a mock connection pool."""
        pool = MagicMock()
        pool.acquire = MagicMock()
        pool.close = AsyncMock()
        return pool

    @pytest.fixture
    def mock_conn(self) -> MagicMock:
        """Create a mock database connection."""
        conn = AsyncMock()
        return conn

    def test_initialization(self, registry: ShardRegistry) -> None:
        """Test registry initializes correctly."""
        assert registry.database_url == "postgresql://localhost:5432/test"
        assert registry._pool is None

    @pytest.mark.asyncio
    async def test_connect_creates_pool_and_schema(self, registry: ShardRegistry) -> None:
        """Test connect creates pool and initializes schema."""
        mock_conn = AsyncMock()
        mock_pool = MagicMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("src.services.shard_registry.asyncpg.create_pool", new=AsyncMock(return_value=mock_pool)):
            await registry.connect()

        assert registry._pool is mock_pool
        # Should create table and index
        assert mock_conn.execute.call_count == 2

    @pytest.mark.asyncio
    async def test_disconnect_closes_pool(self, registry: ShardRegistry, mock_pool: MagicMock) -> None:
        """Test disconnect closes the pool."""
        registry._pool = mock_pool

        await registry.disconnect()

        mock_pool.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_disconnect_no_pool(self, registry: ShardRegistry) -> None:
        """Test disconnect with no pool does nothing."""
        await registry.disconnect()  # Should not raise

    @pytest.mark.asyncio
    async def test_has_dedicated_shard_no_pool(self, registry: ShardRegistry) -> None:
        """Test has_dedicated_shard returns False when not connected."""
        result = await registry.has_dedicated_shard("test_collection", "org_123")
        assert result is False

    @pytest.mark.asyncio
    async def test_has_dedicated_shard_exists(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test has_dedicated_shard returns True when shard exists."""
        mock_conn.fetchval = AsyncMock(return_value=True)
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        result = await registry.has_dedicated_shard("test_collection", "org_123")

        assert result is True
        mock_conn.fetchval.assert_called_once()

    @pytest.mark.asyncio
    async def test_has_dedicated_shard_not_exists(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test has_dedicated_shard returns False when shard doesn't exist."""
        mock_conn.fetchval = AsyncMock(return_value=False)
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        result = await registry.has_dedicated_shard("test_collection", "org_123")

        assert result is False

    @pytest.mark.asyncio
    async def test_register_shard_no_pool(self, registry: ShardRegistry) -> None:
        """Test register_shard raises when not connected."""
        with pytest.raises(RuntimeError, match="Shard registry not connected"):
            await registry.register_shard("test_collection", "org_123", 25000)

    @pytest.mark.asyncio
    async def test_register_shard_success(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test register_shard inserts record."""
        mock_conn.execute = AsyncMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        await registry.register_shard(
            collection_name="test_collection",
            org_id="org_123",
            vector_count=25000,
            replication_factor=2,
            shards_number=4,
        )

        mock_conn.execute.assert_called_once()
        call_args = mock_conn.execute.call_args[0]
        assert "INSERT INTO shard_registry" in call_args[0]
        assert call_args[1] == "org_123"
        assert call_args[2] == "test_collection"

    @pytest.mark.asyncio
    async def test_unregister_shard_no_pool(self, registry: ShardRegistry) -> None:
        """Test unregister_shard raises when not connected."""
        with pytest.raises(RuntimeError, match="Shard registry not connected"):
            await registry.unregister_shard("test_collection", "org_123")

    @pytest.mark.asyncio
    async def test_unregister_shard_success(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test unregister_shard deletes record."""
        mock_conn.execute = AsyncMock(return_value="DELETE 1")
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        result = await registry.unregister_shard("test_collection", "org_123")

        assert result is True

    @pytest.mark.asyncio
    async def test_unregister_shard_not_found(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test unregister_shard returns False when record not found."""
        mock_conn.execute = AsyncMock(return_value="DELETE 0")
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        result = await registry.unregister_shard("test_collection", "org_123")

        assert result is False

    @pytest.mark.asyncio
    async def test_get_shard_info_no_pool(self, registry: ShardRegistry) -> None:
        """Test get_shard_info returns None when not connected."""
        result = await registry.get_shard_info("test_collection", "org_123")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_shard_info_exists(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test get_shard_info returns entry when found."""
        now = datetime.now(UTC)
        mock_row = {
            "org_id": "org_123",
            "collection_name": "test_collection",
            "promoted_at": now,
            "vector_count_at_promotion": 25000,
            "replication_factor": 2,
            "shards_number": 4,
        }
        mock_conn.fetchrow = AsyncMock(return_value=mock_row)
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        result = await registry.get_shard_info("test_collection", "org_123")

        assert result is not None
        assert result.org_id == "org_123"
        assert result.collection_name == "test_collection"
        assert result.vector_count_at_promotion == 25000

    @pytest.mark.asyncio
    async def test_get_shard_info_not_exists(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test get_shard_info returns None when not found."""
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        result = await registry.get_shard_info("test_collection", "org_123")

        assert result is None

    @pytest.mark.asyncio
    async def test_list_shards_no_pool(self, registry: ShardRegistry) -> None:
        """Test list_shards returns empty list when not connected."""
        result = await registry.list_shards()
        assert result == []

    @pytest.mark.asyncio
    async def test_list_shards_all(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test list_shards returns all shards."""
        now = datetime.now(UTC)
        mock_rows = [
            {
                "org_id": "org_123",
                "collection_name": "collection_a",
                "promoted_at": now,
                "vector_count_at_promotion": 25000,
                "replication_factor": None,
                "shards_number": None,
            },
            {
                "org_id": "org_456",
                "collection_name": "collection_b",
                "promoted_at": now,
                "vector_count_at_promotion": 30000,
                "replication_factor": 2,
                "shards_number": 4,
            },
        ]
        mock_conn.fetch = AsyncMock(return_value=mock_rows)
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        result = await registry.list_shards()

        assert len(result) == 2
        assert result[0].org_id == "org_123"
        assert result[1].org_id == "org_456"

    @pytest.mark.asyncio
    async def test_list_shards_filtered_by_collection(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test list_shards filters by collection name."""
        now = datetime.now(UTC)
        mock_rows = [
            {
                "org_id": "org_123",
                "collection_name": "test_collection",
                "promoted_at": now,
                "vector_count_at_promotion": 25000,
                "replication_factor": None,
                "shards_number": None,
            },
        ]
        mock_conn.fetch = AsyncMock(return_value=mock_rows)
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        result = await registry.list_shards(collection_name="test_collection")

        assert len(result) == 1
        mock_conn.fetch.assert_called_once()
        call_args = mock_conn.fetch.call_args[0]
        assert "WHERE collection_name = $1" in call_args[0]

    @pytest.mark.asyncio
    async def test_get_stats_no_pool(self, registry: ShardRegistry) -> None:
        """Test get_stats returns empty stats when not connected."""
        result = await registry.get_stats()
        assert result == {"total_shards": 0, "by_collection": {}}

    @pytest.mark.asyncio
    async def test_get_stats_with_data(
        self, registry: ShardRegistry, mock_pool: MagicMock, mock_conn: MagicMock
    ) -> None:
        """Test get_stats returns correct statistics."""
        mock_conn.fetchval = AsyncMock(return_value=5)
        mock_conn.fetch = AsyncMock(
            return_value=[
                {"collection_name": "collection_a", "count": 3},
                {"collection_name": "collection_b", "count": 2},
            ]
        )
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        registry._pool = mock_pool

        result = await registry.get_stats()

        assert result["total_shards"] == 5
        assert result["by_collection"]["collection_a"] == 3
        assert result["by_collection"]["collection_b"] == 2
