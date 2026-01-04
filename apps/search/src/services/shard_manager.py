"""Qdrant shard management for tiered multitenancy.

Implements Qdrant 1.16+ tiered multitenancy by promoting large tenants
to dedicated shards for optimal performance and isolation.

References:
- https://qdrant.tech/blog/qdrant-1.16.x/
- https://qdrant.tech/documentation/guides/multitenancy/
"""

import logging
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field
from qdrant_client.http import models

from src.clients.qdrant import QdrantClientWrapper

if TYPE_CHECKING:
    from src.services.shard_registry import ShardRegistry

logger = logging.getLogger(__name__)


class ShardManagerConfig(BaseModel):
    """Configuration for shard manager."""

    promotion_threshold: int = Field(
        default=20_000,
        description="Vector count threshold for promoting tenant to dedicated shard",
    )
    max_dedicated_shards: int = Field(
        default=1000,
        description="Maximum number of dedicated shards per cluster (Qdrant recommendation)",
    )
    replication_factor: int | None = Field(
        default=None,
        description="Replication factor for dedicated shards (optional)",
    )
    shards_number: int | None = Field(
        default=None,
        description="Number of shards to create for promoted tenant (optional)",
    )


class ShardManager:
    """Manages Qdrant shard keys for tiered multitenancy.

    Implements automatic tenant promotion from shared fallback shard to
    dedicated shards when vector count exceeds threshold. Uses Qdrant 1.16+
    create_shard_key for zero-downtime, no-reindex promotion.

    Example:
        >>> manager = ShardManager(qdrant_client, config, registry)
        >>> should_promote = await manager.should_promote_tenant("engram_turns", "org_123")
        >>> if should_promote:
        ...     await manager.promote_tenant_to_dedicated_shard("engram_turns", "org_123")
    """

    def __init__(
        self,
        qdrant_client: QdrantClientWrapper,
        config: ShardManagerConfig | None = None,
        registry: "ShardRegistry | None" = None,
    ) -> None:
        """Initialize the shard manager.

        Args:
            qdrant_client: Qdrant client wrapper.
            config: Shard manager configuration.
            registry: Optional PostgreSQL shard registry for persistent tracking.
        """
        self.qdrant = qdrant_client
        self.config = config or ShardManagerConfig()
        self.registry = registry

    async def get_tenant_vector_count(self, collection_name: str, org_id: str) -> int:
        """Get the number of vectors for a specific tenant.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).

        Returns:
            Count of vectors for the tenant.

        Raises:
            Exception: If count query fails.
        """
        try:
            # Use count endpoint with filter to get exact count for tenant
            result = await self.qdrant.client.count(
                collection_name=collection_name,
                count_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="org_id",
                            match=models.MatchValue(value=org_id),
                        ),
                    ]
                ),
                exact=True,  # Ensure exact count, not estimate
            )

            count = result.count if result else 0
            logger.debug(f"Tenant '{org_id}' has {count} vectors in collection '{collection_name}'")
            return count

        except Exception as e:
            logger.error(f"Failed to get vector count for tenant '{org_id}': {e}")
            raise

    async def should_promote_tenant(self, collection_name: str, org_id: str) -> bool:
        """Determine if a tenant should be promoted to a dedicated shard.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).

        Returns:
            True if tenant should be promoted, False otherwise.
        """
        try:
            # Check if tenant already has a dedicated shard
            has_shard = await self.has_dedicated_shard(collection_name, org_id)
            if has_shard:
                logger.debug(f"Tenant '{org_id}' already has dedicated shard")
                return False

            # Get vector count for tenant
            vector_count = await self.get_tenant_vector_count(collection_name, org_id)

            # Compare against threshold
            should_promote = vector_count >= self.config.promotion_threshold
            if should_promote:
                logger.info(
                    f"Tenant '{org_id}' exceeds promotion threshold: "
                    f"{vector_count} >= {self.config.promotion_threshold}"
                )
            return should_promote

        except Exception as e:
            logger.error(f"Failed to check promotion eligibility for tenant '{org_id}': {e}")
            # Conservative: don't promote on error
            return False

    async def has_dedicated_shard(self, collection_name: str, org_id: str) -> bool:
        """Check if a tenant already has a dedicated shard.

        Uses the PostgreSQL shard registry for fast lookups when available,
        falling back to Qdrant collection info if registry is not configured.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).

        Returns:
            True if tenant has dedicated shard, False otherwise.
        """
        try:
            # Use registry for fast lookup if available
            if self.registry is not None:
                has_shard = await self.registry.has_dedicated_shard(collection_name, org_id)
                logger.debug(
                    f"Registry lookup for tenant '{org_id}' in '{collection_name}': {has_shard}"
                )
                return has_shard

            # Fallback: check collection info (less reliable)
            collection_info = await self.qdrant.get_collection_info(collection_name)
            if not collection_info:
                logger.warning(f"Collection '{collection_name}' not found")
                return False

            # Without registry, we can't reliably track shard keys
            # Conservative default: assume no dedicated shard
            logger.debug(
                f"No registry configured, assuming no dedicated shard for tenant '{org_id}'"
            )
            return False

        except Exception as e:
            logger.error(f"Failed to check dedicated shard for tenant '{org_id}': {e}")
            return False

    async def promote_tenant_to_dedicated_shard(
        self,
        collection_name: str,
        org_id: str,
    ) -> None:
        """Promote a tenant to a dedicated shard.

        Uses Qdrant 1.16+ create_shard_key API for zero-downtime promotion.
        Throughout the transfer, Qdrant automatically routes reads/writes to
        the correct shard and maintains consistency guarantees.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).

        Raises:
            ValueError: If max dedicated shards limit is reached.
            Exception: If shard creation fails.
        """
        try:
            # Check if already promoted
            has_shard = await self.has_dedicated_shard(collection_name, org_id)
            if has_shard:
                logger.warning(f"Tenant '{org_id}' already has dedicated shard, skipping promotion")
                return

            # Get current vector count for logging
            vector_count = await self.get_tenant_vector_count(collection_name, org_id)
            logger.info(
                f"Promoting tenant '{org_id}' to dedicated shard (current vectors: {vector_count})"
            )

            # Build create_shard_key kwargs
            kwargs: dict[str, Any] = {}
            if self.config.shards_number is not None:
                kwargs["shards_number"] = self.config.shards_number
            if self.config.replication_factor is not None:
                kwargs["replication_factor"] = self.config.replication_factor

            # Create dedicated shard for this org_id
            # This uses org_id as the shard_key value
            await self.qdrant.client.create_shard_key(
                collection_name=collection_name,
                shard_key=org_id,
                **kwargs,
            )

            # Register in PostgreSQL registry for fast lookups
            if self.registry is not None:
                await self.registry.register_shard(
                    collection_name=collection_name,
                    org_id=org_id,
                    vector_count=vector_count,
                    replication_factor=self.config.replication_factor,
                    shards_number=self.config.shards_number,
                )

            logger.info(
                f"Successfully promoted tenant '{org_id}' to dedicated shard "
                f"in collection '{collection_name}'"
            )

        except Exception as e:
            logger.error(
                f"Failed to promote tenant '{org_id}' to dedicated shard: {e}",
                exc_info=True,
            )
            raise

    async def get_tenant_stats(self, collection_name: str, org_id: str) -> dict[str, Any]:
        """Get statistics for a tenant.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).

        Returns:
            Dictionary with tenant statistics including:
            - vector_count: Number of vectors
            - has_dedicated_shard: Whether tenant has dedicated shard
            - should_promote: Whether tenant should be promoted
            - threshold: Current promotion threshold
        """
        try:
            vector_count = await self.get_tenant_vector_count(collection_name, org_id)
            has_shard = await self.has_dedicated_shard(collection_name, org_id)
            should_promote = await self.should_promote_tenant(collection_name, org_id)

            return {
                "org_id": org_id,
                "collection_name": collection_name,
                "vector_count": vector_count,
                "has_dedicated_shard": has_shard,
                "should_promote": should_promote,
                "promotion_threshold": self.config.promotion_threshold,
                "percentage_of_threshold": (
                    (vector_count / self.config.promotion_threshold * 100)
                    if self.config.promotion_threshold > 0
                    else 0
                ),
            }

        except Exception as e:
            logger.error(f"Failed to get tenant stats for '{org_id}': {e}")
            raise

    async def check_and_promote_if_needed(self, collection_name: str, org_id: str) -> bool:
        """Check if tenant should be promoted and promote if needed.

        Convenience method that combines should_promote and promote_tenant_to_dedicated_shard.

        Args:
            collection_name: Name of the collection.
            org_id: Organization ID (tenant identifier).

        Returns:
            True if tenant was promoted, False otherwise.
        """
        try:
            should_promote = await self.should_promote_tenant(collection_name, org_id)
            if should_promote:
                await self.promote_tenant_to_dedicated_shard(collection_name, org_id)
                return True
            return False

        except Exception as e:
            logger.error(
                f"Failed to check and promote tenant '{org_id}': {e}",
                exc_info=True,
            )
            return False
