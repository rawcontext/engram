"""Async Qdrant client wrapper with connection management."""

import logging
from typing import Any

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models

from src.config import Settings

logger = logging.getLogger(__name__)


class QdrantClientWrapper:
    """Wrapper around AsyncQdrantClient with lifecycle management.

    Provides async context manager interface for proper resource cleanup.
    """

    def __init__(self, settings: Settings) -> None:
        """Initialize the Qdrant client wrapper.

        Args:
            settings: Application settings containing Qdrant configuration.
        """
        self.settings = settings
        self._client: AsyncQdrantClient | None = None
        self._collection_name = settings.qdrant_collection

    async def connect(self) -> None:
        """Establish connection to Qdrant server.

        Creates AsyncQdrantClient instance with configured timeout and gRPC settings.
        """
        logger.info(
            f"Connecting to Qdrant at {self.settings.qdrant_url} "
            f"(collection: {self._collection_name})"
        )

        # Build client kwargs, only include grpc_port if it's set
        client_kwargs: dict[str, Any] = {
            "url": self.settings.qdrant_url,
            "timeout": self.settings.qdrant_timeout,
            "prefer_grpc": self.settings.qdrant_prefer_grpc,
        }
        if self.settings.qdrant_grpc_port is not None:
            client_kwargs["grpc_port"] = self.settings.qdrant_grpc_port

        self._client = AsyncQdrantClient(**client_kwargs)

        # Verify connection by getting collection info
        try:
            await self._client.get_collection(collection_name=self._collection_name)
            logger.info(f"Successfully connected to Qdrant collection: {self._collection_name}")
        except Exception as e:
            logger.warning(
                f"Could not verify collection '{self._collection_name}': {e}. "
                "Collection may not exist yet."
            )

    async def close(self) -> None:
        """Close the Qdrant client connection.

        Properly cleans up resources and closes the underlying HTTP client.
        """
        if self._client is not None:
            logger.info("Closing Qdrant client connection")
            await self._client.close()
            self._client = None

    @property
    def client(self) -> AsyncQdrantClient:
        """Get the underlying AsyncQdrantClient instance.

        Returns:
            The AsyncQdrantClient instance.

        Raises:
            RuntimeError: If client is not connected.
        """
        if self._client is None:
            raise RuntimeError("Qdrant client not connected. Call connect() first.")
        return self._client

    async def health_check(self) -> bool:
        """Check if Qdrant is healthy and responsive.

        Returns:
            True if Qdrant is healthy, False otherwise.
        """
        try:
            if self._client is None:
                return False

            # Try to get collection info as a lightweight health check
            await self._client.get_collection(collection_name=self._collection_name)
            return True
        except Exception as e:
            logger.error(f"Qdrant health check failed: {e}")
            return False

    async def collection_exists(self, collection_name: str | None = None) -> bool:
        """Check if a collection exists.

        Args:
            collection_name: Name of the collection to check. Defaults to configured collection.

        Returns:
            True if collection exists, False otherwise.
        """
        if self._client is None:
            return False

        collection = collection_name or self._collection_name
        try:
            await self._client.get_collection(collection_name=collection)
            return True
        except Exception:
            return False

    async def get_collection_info(
        self, collection_name: str | None = None
    ) -> models.CollectionInfo | None:
        """Get information about a collection.

        Args:
            collection_name: Name of the collection. Defaults to configured collection.

        Returns:
            Collection information or None if collection doesn't exist.
        """
        if self._client is None:
            return None

        collection = collection_name or self._collection_name
        try:
            return await self._client.get_collection(collection_name=collection)
        except Exception as e:
            logger.error(f"Failed to get collection info for '{collection}': {e}")
            return None

    async def __aenter__(self) -> "QdrantClientWrapper":
        """Async context manager entry.

        Returns:
            Self for context manager protocol.
        """
        await self.connect()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit.

        Args:
            exc_type: Exception type if an exception was raised.
            exc_val: Exception value if an exception was raised.
            exc_tb: Exception traceback if an exception was raised.
        """
        await self.close()
