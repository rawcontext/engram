"""Integration tests for shard manager and registry using testcontainers.

These tests run against real Qdrant and PostgreSQL containers.
"""

import pytest
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models

from src.services.shard_manager import ShardManager, ShardManagerConfig
from src.services.shard_registry import ShardRegistry


@pytest.mark.integration
class TestShardRegistryIntegration:
    """Integration tests for ShardRegistry with real PostgreSQL."""

    @pytest.mark.asyncio
    async def test_registry_lifecycle(self, postgres_url: str) -> None:
        """Test complete registry lifecycle: connect, register, query, unregister."""
        registry = ShardRegistry(postgres_url)

        try:
            # Connect and initialize schema
            await registry.connect()

            # Initially no shards
            has_shard = await registry.has_dedicated_shard("test_collection", "org_123")
            assert has_shard is False

            # Register a shard
            await registry.register_shard(
                collection_name="test_collection",
                org_id="org_123",
                vector_count=25000,
                replication_factor=2,
                shards_number=4,
            )

            # Now should exist
            has_shard = await registry.has_dedicated_shard("test_collection", "org_123")
            assert has_shard is True

            # Get shard info
            info = await registry.get_shard_info("test_collection", "org_123")
            assert info is not None
            assert info.org_id == "org_123"
            assert info.collection_name == "test_collection"
            assert info.vector_count_at_promotion == 25000
            assert info.replication_factor == 2
            assert info.shards_number == 4

            # List shards
            shards = await registry.list_shards()
            assert len(shards) >= 1
            assert any(s.org_id == "org_123" for s in shards)

            # List shards filtered by collection
            shards = await registry.list_shards(collection_name="test_collection")
            assert len(shards) == 1

            # Get stats
            stats = await registry.get_stats()
            assert stats["total_shards"] >= 1

            # Unregister
            deleted = await registry.unregister_shard("test_collection", "org_123")
            assert deleted is True

            # Should no longer exist
            has_shard = await registry.has_dedicated_shard("test_collection", "org_123")
            assert has_shard is False

        finally:
            await registry.disconnect()

    @pytest.mark.asyncio
    async def test_registry_upsert_on_conflict(self, postgres_url: str) -> None:
        """Test that register_shard updates on conflict."""
        registry = ShardRegistry(postgres_url)

        try:
            await registry.connect()

            # First registration
            await registry.register_shard(
                collection_name="test_upsert",
                org_id="org_upsert",
                vector_count=10000,
            )

            # Second registration should update
            await registry.register_shard(
                collection_name="test_upsert",
                org_id="org_upsert",
                vector_count=20000,
                replication_factor=3,
            )

            # Should reflect updated values
            info = await registry.get_shard_info("test_upsert", "org_upsert")
            assert info is not None
            assert info.vector_count_at_promotion == 20000
            assert info.replication_factor == 3

        finally:
            await registry.disconnect()


@pytest.mark.integration
class TestShardManagerIntegration:
    """Integration tests for ShardManager with real Qdrant."""

    @pytest.fixture
    async def collection_name(self, qdrant_async_client: AsyncQdrantClient) -> str:
        """Create a test collection and return its name."""
        name = "test_shard_manager"

        # Create collection with tenant-aware sharding
        await qdrant_async_client.create_collection(
            collection_name=name,
            vectors_config=models.VectorParams(
                size=384,
                distance=models.Distance.COSINE,
            ),
        )

        # Create tenant index
        await qdrant_async_client.create_payload_index(
            collection_name=name,
            field_name="org_id",
            field_schema=models.KeywordIndexParams(
                type=models.PayloadSchemaType.KEYWORD,
                is_tenant=True,
            ),
        )

        yield name

        # Cleanup
        try:
            await qdrant_async_client.delete_collection(collection_name=name)
        except Exception:
            pass

    @pytest.mark.asyncio
    async def test_get_tenant_vector_count_empty(
        self,
        qdrant_async_client: AsyncQdrantClient,
        collection_name: str,
    ) -> None:
        """Test getting vector count for tenant with no vectors."""
        # Create a minimal mock for QdrantClientWrapper
        class MockQdrantWrapper:
            def __init__(self, client: AsyncQdrantClient) -> None:
                self.client = client

            async def get_collection_info(self, name: str) -> models.CollectionInfo | None:
                try:
                    return await self.client.get_collection(name)
                except Exception:
                    return None

        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = ShardManager(wrapper)  # type: ignore[arg-type]

        count = await manager.get_tenant_vector_count(collection_name, "org_empty")
        assert count == 0

    @pytest.mark.asyncio
    async def test_get_tenant_vector_count_with_data(
        self,
        qdrant_async_client: AsyncQdrantClient,
        collection_name: str,
    ) -> None:
        """Test getting vector count for tenant with vectors."""

        class MockQdrantWrapper:
            def __init__(self, client: AsyncQdrantClient) -> None:
                self.client = client

            async def get_collection_info(self, name: str) -> models.CollectionInfo | None:
                try:
                    return await self.client.get_collection(name)
                except Exception:
                    return None

        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = ShardManager(wrapper)  # type: ignore[arg-type]

        org_id = "org_with_data"

        # Insert some vectors
        points = [
            models.PointStruct(
                id=i,
                vector=[0.1] * 384,
                payload={"org_id": org_id, "content": f"test {i}"},
            )
            for i in range(10)
        ]
        await qdrant_async_client.upsert(
            collection_name=collection_name,
            points=points,
        )

        count = await manager.get_tenant_vector_count(collection_name, org_id)
        assert count == 10

    @pytest.mark.asyncio
    async def test_should_promote_tenant(
        self,
        qdrant_async_client: AsyncQdrantClient,
        collection_name: str,
    ) -> None:
        """Test promotion eligibility check."""

        class MockQdrantWrapper:
            def __init__(self, client: AsyncQdrantClient) -> None:
                self.client = client

            async def get_collection_info(self, name: str) -> models.CollectionInfo | None:
                try:
                    return await self.client.get_collection(name)
                except Exception:
                    return None

        wrapper = MockQdrantWrapper(qdrant_async_client)

        # Low threshold for testing
        config = ShardManagerConfig(promotion_threshold=5)
        manager = ShardManager(wrapper, config)  # type: ignore[arg-type]

        org_id = "org_promote_test"

        # Initially below threshold
        should_promote = await manager.should_promote_tenant(collection_name, org_id)
        assert should_promote is False

        # Add vectors above threshold
        points = [
            models.PointStruct(
                id=i,
                vector=[0.1] * 384,
                payload={"org_id": org_id, "content": f"test {i}"},
            )
            for i in range(10)
        ]
        await qdrant_async_client.upsert(
            collection_name=collection_name,
            points=points,
        )

        # Now should be above threshold
        should_promote = await manager.should_promote_tenant(collection_name, org_id)
        assert should_promote is True

    @pytest.mark.asyncio
    async def test_get_tenant_stats(
        self,
        qdrant_async_client: AsyncQdrantClient,
        collection_name: str,
    ) -> None:
        """Test getting comprehensive tenant statistics."""

        class MockQdrantWrapper:
            def __init__(self, client: AsyncQdrantClient) -> None:
                self.client = client

            async def get_collection_info(self, name: str) -> models.CollectionInfo | None:
                try:
                    return await self.client.get_collection(name)
                except Exception:
                    return None

        wrapper = MockQdrantWrapper(qdrant_async_client)
        config = ShardManagerConfig(promotion_threshold=100)
        manager = ShardManager(wrapper, config)  # type: ignore[arg-type]

        org_id = "org_stats"

        # Add some vectors
        points = [
            models.PointStruct(
                id=i,
                vector=[0.1] * 384,
                payload={"org_id": org_id, "content": f"test {i}"},
            )
            for i in range(50)
        ]
        await qdrant_async_client.upsert(
            collection_name=collection_name,
            points=points,
        )

        stats = await manager.get_tenant_stats(collection_name, org_id)

        assert stats["org_id"] == org_id
        assert stats["collection_name"] == collection_name
        assert stats["vector_count"] == 50
        assert stats["has_dedicated_shard"] is False
        assert stats["should_promote"] is False  # 50 < 100
        assert stats["promotion_threshold"] == 100
        assert stats["percentage_of_threshold"] == 50.0


@pytest.mark.integration
class TestShardManagerWithRegistry:
    """Integration tests for ShardManager with PostgreSQL registry."""

    @pytest.fixture
    async def registry(self, postgres_url: str) -> ShardRegistry:
        """Create and connect a shard registry."""
        registry = ShardRegistry(postgres_url)
        await registry.connect()
        yield registry
        await registry.disconnect()

    @pytest.fixture
    async def collection_name(self, qdrant_async_client: AsyncQdrantClient) -> str:
        """Create a test collection."""
        name = "test_manager_with_registry"

        await qdrant_async_client.create_collection(
            collection_name=name,
            vectors_config=models.VectorParams(
                size=384,
                distance=models.Distance.COSINE,
            ),
        )

        await qdrant_async_client.create_payload_index(
            collection_name=name,
            field_name="org_id",
            field_schema=models.KeywordIndexParams(
                type=models.PayloadSchemaType.KEYWORD,
                is_tenant=True,
            ),
        )

        yield name

        try:
            await qdrant_async_client.delete_collection(collection_name=name)
        except Exception:
            pass

    @pytest.mark.asyncio
    async def test_has_dedicated_shard_uses_registry(
        self,
        qdrant_async_client: AsyncQdrantClient,
        registry: ShardRegistry,
        collection_name: str,
    ) -> None:
        """Test that has_dedicated_shard checks registry."""

        class MockQdrantWrapper:
            def __init__(self, client: AsyncQdrantClient) -> None:
                self.client = client

            async def get_collection_info(self, name: str) -> models.CollectionInfo | None:
                try:
                    return await self.client.get_collection(name)
                except Exception:
                    return None

        wrapper = MockQdrantWrapper(qdrant_async_client)
        manager = ShardManager(wrapper, registry=registry)  # type: ignore[arg-type]

        org_id = "org_registry_test"

        # Initially no shard in registry
        has_shard = await manager.has_dedicated_shard(collection_name, org_id)
        assert has_shard is False

        # Register in registry
        await registry.register_shard(
            collection_name=collection_name,
            org_id=org_id,
            vector_count=25000,
        )

        # Now should find it in registry
        has_shard = await manager.has_dedicated_shard(collection_name, org_id)
        assert has_shard is True
