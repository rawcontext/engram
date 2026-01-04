"""PostgreSQL-backed shard registry for tracking promoted tenants.

Maintains a record of which tenants have been promoted to dedicated shards,
enabling fast lookups without querying Qdrant.
"""

import logging
from datetime import UTC, datetime
from typing import Any

import asyncpg
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class ShardRegistryEntry(BaseModel):
    """A record of a tenant promoted to a dedicated shard."""

    org_id: str = Field(description="Organization ID (tenant identifier)")
    collection_name: str = Field(description="Qdrant collection name")
    promoted_at: datetime = Field(description="When the promotion occurred")
    vector_count_at_promotion: int = Field(description="Vector count when promoted")
    replication_factor: int | None = Field(default=None, description="Replication factor if set")
    shards_number: int | None = Field(default=None, description="Number of shards if set")


class ShardRegistry:
    """PostgreSQL-backed registry for tracking shard assignments.

    Provides fast lookups for whether a tenant has a dedicated shard,
    avoiding expensive Qdrant API calls.

    Example:
        >>> registry = ShardRegistry("postgresql://localhost:5432/engram")
        >>> await registry.connect()
        >>> await registry.register_shard("engram_turns", "org_123", 25000)
        >>> has_shard = await registry.has_dedicated_shard("engram_turns", "org_123")
    """

    def __init__(self, database_url: str) -> None:
        """Initialize the shard registry.

        Args:
            database_url: PostgreSQL connection URL.
        """
        self.database_url = database_url
        self._pool: asyncpg.Pool[asyncpg.Record] | None = None

    async def connect(self) -> None:
        """Connect to the database and ensure schema exists."""
        self._pool = await asyncpg.create_pool(self.database_url, min_size=1, max_size=5)

        # Create the shard registry table if it doesn't exist
        async with self._pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS shard_registry (
                    org_id VARCHAR(255) NOT NULL,
                    collection_name VARCHAR(255) NOT NULL,
                    promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    vector_count_at_promotion INTEGER NOT NULL,
                    replication_factor INTEGER,
                    shards_number INTEGER,
                    PRIMARY KEY (org_id, collection_name)
                )
            """)

            # Create index for fast lookups by collection
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_shard_registry_collection
                ON shard_registry (collection_name)
            """)

        logger.info("Shard registry connected and schema initialized")

    async def disconnect(self) -> None:
        """Close the database connection pool."""
        if self._pool:
            await self._pool.close()
            logger.info("Shard registry disconnected")

    async def has_dedicated_shard(self, collection_name: str, org_id: str) -> bool:
        """Check if a tenant has a dedicated shard.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).

        Returns:
            True if tenant has dedicated shard, False otherwise.
        """
        if not self._pool:
            logger.warning("Shard registry not connected, returning False")
            return False

        async with self._pool.acquire() as conn:
            result = await conn.fetchval(
                """
                SELECT EXISTS(
                    SELECT 1 FROM shard_registry
                    WHERE org_id = $1 AND collection_name = $2
                )
                """,
                org_id,
                collection_name,
            )
            return bool(result)

    async def register_shard(
        self,
        collection_name: str,
        org_id: str,
        vector_count: int,
        replication_factor: int | None = None,
        shards_number: int | None = None,
    ) -> None:
        """Register a tenant as having a dedicated shard.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).
            vector_count: Vector count at time of promotion.
            replication_factor: Replication factor if set.
            shards_number: Number of shards if set.
        """
        if not self._pool:
            raise RuntimeError("Shard registry not connected")

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO shard_registry
                (org_id, collection_name, promoted_at, vector_count_at_promotion,
                 replication_factor, shards_number)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (org_id, collection_name) DO UPDATE SET
                    promoted_at = EXCLUDED.promoted_at,
                    vector_count_at_promotion = EXCLUDED.vector_count_at_promotion,
                    replication_factor = EXCLUDED.replication_factor,
                    shards_number = EXCLUDED.shards_number
                """,
                org_id,
                collection_name,
                datetime.now(UTC),
                vector_count,
                replication_factor,
                shards_number,
            )
            logger.info(
                f"Registered dedicated shard for org '{org_id}' in collection '{collection_name}'"
            )

    async def unregister_shard(self, collection_name: str, org_id: str) -> bool:
        """Remove a tenant's shard registration.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).

        Returns:
            True if a record was deleted, False if not found.
        """
        if not self._pool:
            raise RuntimeError("Shard registry not connected")

        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                DELETE FROM shard_registry
                WHERE org_id = $1 AND collection_name = $2
                """,
                org_id,
                collection_name,
            )
            deleted = result.endswith("1")
            if deleted:
                logger.info(
                    f"Unregistered shard for org '{org_id}' from collection '{collection_name}'"
                )
            return deleted

    async def get_shard_info(
        self, collection_name: str, org_id: str
    ) -> ShardRegistryEntry | None:
        """Get shard registration info for a tenant.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).

        Returns:
            Shard registry entry if found, None otherwise.
        """
        if not self._pool:
            return None

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT org_id, collection_name, promoted_at, vector_count_at_promotion,
                       replication_factor, shards_number
                FROM shard_registry
                WHERE org_id = $1 AND collection_name = $2
                """,
                org_id,
                collection_name,
            )
            if row:
                return ShardRegistryEntry(
                    org_id=row["org_id"],
                    collection_name=row["collection_name"],
                    promoted_at=row["promoted_at"],
                    vector_count_at_promotion=row["vector_count_at_promotion"],
                    replication_factor=row["replication_factor"],
                    shards_number=row["shards_number"],
                )
            return None

    async def list_shards(
        self, collection_name: str | None = None
    ) -> list[ShardRegistryEntry]:
        """List all registered shards.

        Args:
            collection_name: Optional filter by collection name.

        Returns:
            List of shard registry entries.
        """
        if not self._pool:
            return []

        async with self._pool.acquire() as conn:
            if collection_name:
                rows = await conn.fetch(
                    """
                    SELECT org_id, collection_name, promoted_at, vector_count_at_promotion,
                           replication_factor, shards_number
                    FROM shard_registry
                    WHERE collection_name = $1
                    ORDER BY promoted_at DESC
                    """,
                    collection_name,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT org_id, collection_name, promoted_at, vector_count_at_promotion,
                           replication_factor, shards_number
                    FROM shard_registry
                    ORDER BY promoted_at DESC
                    """
                )

            return [
                ShardRegistryEntry(
                    org_id=row["org_id"],
                    collection_name=row["collection_name"],
                    promoted_at=row["promoted_at"],
                    vector_count_at_promotion=row["vector_count_at_promotion"],
                    replication_factor=row["replication_factor"],
                    shards_number=row["shards_number"],
                )
                for row in rows
            ]

    async def get_stats(self) -> dict[str, Any]:
        """Get statistics about the shard registry.

        Returns:
            Dictionary with shard statistics.
        """
        if not self._pool:
            return {"total_shards": 0, "by_collection": {}}

        async with self._pool.acquire() as conn:
            total = await conn.fetchval("SELECT COUNT(*) FROM shard_registry")
            by_collection = await conn.fetch(
                """
                SELECT collection_name, COUNT(*) as count
                FROM shard_registry
                GROUP BY collection_name
                """
            )

            return {
                "total_shards": total,
                "by_collection": {row["collection_name"]: row["count"] for row in by_collection},
            }
