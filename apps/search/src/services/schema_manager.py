"""Qdrant collection schema management."""

import logging
from typing import Any

from pydantic import BaseModel, Field
from qdrant_client.http import models
from qdrant_client.http.models import Distance, SparseVectorParams, VectorParams

from src.clients.qdrant import QdrantClientWrapper
from src.config import Settings

logger = logging.getLogger(__name__)


# Pre-defined collection schemas
def get_turns_collection_schema(collection_name: str = "engram_turns") -> "CollectionSchema":
    """Get schema for turn-level conversation indexing.

    Turn-level indexing provides complete conversation turns for semantic search,
    replacing fragment-level indexing for better retrieval quality.

    Args:
        collection_name: Name for the collection (default: engram_turns)

    Returns:
        CollectionSchema configured for turn-level documents with:
        - turn_dense: BGE-small dense vectors (384 dims)
        - turn_sparse: SPLADE sparse vectors
        - turn_colbert: ColBERT multi-vectors (128 dims)
    """
    return CollectionSchema(
        collection_name=collection_name,
        dense_vector_size=384,  # BGE-small-en-v1.5
        dense_vector_name="turn_dense",
        sparse_vector_name="turn_sparse",
        colbert_vector_name="turn_colbert",
        colbert_vector_size=128,
        enable_colbert=True,
        distance=Distance.COSINE,
    )


class CollectionSchema(BaseModel):
    """Schema definition for a Qdrant collection."""

    collection_name: str = Field(description="Collection name")
    dense_vector_size: int = Field(default=768, description="Dense vector dimensions")
    dense_vector_name: str = Field(default="text_dense", description="Dense vector field name")
    sparse_vector_name: str = Field(default="text_sparse", description="Sparse vector field name")
    colbert_vector_name: str = Field(
        default="text_colbert", description="ColBERT vector field name"
    )
    colbert_vector_size: int = Field(default=128, description="ColBERT token vector dimensions")
    enable_colbert: bool = Field(default=True, description="Enable ColBERT multi-vector")
    distance: Distance = Field(default=Distance.COSINE, description="Distance metric")
    # Index settings
    on_disk: bool = Field(default=False, description="Store vectors on disk")
    hnsw_m: int = Field(default=16, description="HNSW M parameter")
    hnsw_ef_construct: int = Field(default=100, description="HNSW ef_construct parameter")


class SchemaManager:
    """Manages Qdrant collection schemas.

    Ensures collections exist with correct configuration for multi-vector
    storage (dense + sparse + ColBERT embeddings).

    Example:
            >>> manager = SchemaManager(qdrant_client, settings)
            >>> await manager.ensure_collection(CollectionSchema(
            ...     collection_name="engram_memory",
            ...     dense_vector_size=768,
            ... ))
    """

    def __init__(self, qdrant_client: QdrantClientWrapper, settings: Settings) -> None:
        self.qdrant = qdrant_client
        self.settings = settings

    async def ensure_collection(self, schema: CollectionSchema) -> bool:
        """Ensure collection exists with correct schema.

        Creates collection if it doesn't exist.

        Args:
                schema: Collection schema definition.

        Returns:
                True if collection was created, False if it already existed.

        Raises:
                Exception: If collection creation fails.
        """
        try:
            # Check if collection exists
            exists = await self.qdrant.collection_exists(schema.collection_name)

            if exists:
                logger.info(f"Collection '{schema.collection_name}' already exists")
                return False

            # Collection doesn't exist, create it
            logger.info(f"Creating collection '{schema.collection_name}'")
            await self.create_collection(schema)
            return True

        except Exception as e:
            logger.error(f"Failed to ensure collection '{schema.collection_name}': {e}")
            raise

    async def create_collection(self, schema: CollectionSchema) -> None:
        """Create a new collection with the specified schema.

        Args:
                schema: Collection schema definition.

        Raises:
                Exception: If collection creation fails.
        """
        try:
            # Build vectors_config with named vectors
            # Dense vector is the primary named vector
            vectors_config: dict[str, VectorParams] = {
                schema.dense_vector_name: VectorParams(
                    size=schema.dense_vector_size,
                    distance=schema.distance,
                    on_disk=schema.on_disk,
                    hnsw_config=models.HnswConfigDiff(
                        m=schema.hnsw_m,
                        ef_construct=schema.hnsw_ef_construct,
                    ),
                ),
            }

            # Add ColBERT multi-vector if enabled
            if schema.enable_colbert:
                # ColBERT uses multi-vector (list of token embeddings)
                # Each point stores a matrix of token embeddings
                vectors_config[schema.colbert_vector_name] = VectorParams(
                    size=schema.colbert_vector_size,
                    distance=schema.distance,
                    on_disk=schema.on_disk,
                    multivector_config=models.MultiVectorConfig(
                        comparator=models.MultiVectorComparator.MAX_SIM,
                    ),
                    hnsw_config=models.HnswConfigDiff(
                        m=schema.hnsw_m,
                        ef_construct=schema.hnsw_ef_construct,
                    ),
                )

            # Build sparse_vectors_config
            # Sparse vectors must be named and always use dot product distance
            sparse_vectors_config: dict[str, SparseVectorParams] = {
                schema.sparse_vector_name: SparseVectorParams(),
            }

            # Create collection with named dense, sparse, and multi-vectors
            await self.qdrant.client.create_collection(
                collection_name=schema.collection_name,
                vectors_config=vectors_config,
                sparse_vectors_config=sparse_vectors_config,
            )

            logger.info(
                f"Successfully created collection '{schema.collection_name}' with "
                f"dense vector '{schema.dense_vector_name}' (size={schema.dense_vector_size}), "
                f"sparse vector '{schema.sparse_vector_name}'"
                + (
                    f", ColBERT multi-vector '{schema.colbert_vector_name}' "
                    f"(size={schema.colbert_vector_size})"
                    if schema.enable_colbert
                    else ""
                )
            )

        except Exception as e:
            logger.error(f"Failed to create collection '{schema.collection_name}': {e}")
            raise

    async def delete_collection(self, collection_name: str) -> bool:
        """Delete a collection.

        Args:
                collection_name: Name of the collection to delete.

        Returns:
                True if deleted, False if didn't exist.

        Raises:
                Exception: If deletion fails.
        """
        try:
            # Check if collection exists
            exists = await self.qdrant.collection_exists(collection_name)

            if not exists:
                logger.warning(f"Collection '{collection_name}' does not exist, cannot delete")
                return False

            # Delete the collection
            await self.qdrant.client.delete_collection(collection_name=collection_name)
            logger.info(f"Successfully deleted collection '{collection_name}'")
            return True

        except Exception as e:
            logger.error(f"Failed to delete collection '{collection_name}': {e}")
            raise

    async def get_collection_info(self, collection_name: str) -> dict[str, Any] | None:
        """Get collection information.

        Args:
                collection_name: Name of the collection.

        Returns:
                Collection information as a dictionary, or None if collection doesn't exist.
        """
        try:
            info = await self.qdrant.get_collection_info(collection_name)

            if info is None:
                return None

            # Convert CollectionInfo to dict with relevant fields
            # Build vectors info - handle Union[VectorParams, Dict[str, VectorParams], None]
            vectors_info: dict[str, Any] = {}
            if info.config and info.config.params and info.config.params.vectors is not None:
                vectors_config = info.config.params.vectors
                # Check if it's a dict (named vectors) or single VectorParams
                if isinstance(vectors_config, dict):
                    # Named vectors
                    vectors_info = {
                        name: {
                            "size": vec_config.size,
                            "distance": vec_config.distance.value,
                            "on_disk": vec_config.on_disk if vec_config.on_disk else False,
                            "multivector": vec_config.multivector_config is not None,
                        }
                        for name, vec_config in vectors_config.items()
                    }
                else:
                    # Single unnamed vector
                    vectors_info = {
                        "default": {
                            "size": vectors_config.size,
                            "distance": vectors_config.distance.value,
                            "on_disk": (
                                vectors_config.on_disk if vectors_config.on_disk else False
                            ),
                            "multivector": vectors_config.multivector_config is not None,
                        }
                    }

            return {
                "name": collection_name,
                "status": info.status.value if info.status else "unknown",
                "points_count": info.points_count if info.points_count else 0,
                "indexed_vectors_count": (
                    info.indexed_vectors_count if info.indexed_vectors_count else 0
                ),
                "segments_count": info.segments_count if info.segments_count else 0,
                "config": {
                    "params": {
                        "vectors": vectors_info,
                        "sparse_vectors": (
                            list(info.config.params.sparse_vectors.keys())
                            if info.config
                            and info.config.params
                            and info.config.params.sparse_vectors
                            else []
                        ),
                    }
                    if info.config and info.config.params
                    else {},
                },
            }

        except Exception as e:
            logger.error(f"Failed to get collection info for '{collection_name}': {e}")
            return None

    async def update_collection_params(
        self,
        collection_name: str,
        hnsw_m: int | None = None,
        hnsw_ef_construct: int | None = None,
    ) -> None:
        """Update collection HNSW parameters.

        Args:
                collection_name: Name of the collection to update.
                hnsw_m: HNSW M parameter (optional).
                hnsw_ef_construct: HNSW ef_construct parameter (optional).

        Raises:
                Exception: If update fails.
        """
        try:
            # Check if collection exists
            exists = await self.qdrant.collection_exists(collection_name)

            if not exists:
                raise ValueError(f"Collection '{collection_name}' does not exist")

            # Build update config
            hnsw_config = models.HnswConfigDiff()

            if hnsw_m is not None:
                hnsw_config.m = hnsw_m

            if hnsw_ef_construct is not None:
                hnsw_config.ef_construct = hnsw_ef_construct

            # Update collection
            await self.qdrant.client.update_collection(
                collection_name=collection_name,
                hnsw_config=hnsw_config,
            )

            logger.info(
                f"Successfully updated collection '{collection_name}' parameters: "
                f"m={hnsw_m}, ef_construct={hnsw_ef_construct}"
            )

        except Exception as e:
            logger.error(f"Failed to update collection '{collection_name}' parameters: {e}")
            raise
