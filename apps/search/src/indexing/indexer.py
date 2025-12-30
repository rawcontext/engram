"""Document indexer with multi-vector embedding generation."""

import logging
from typing import Any

from pydantic import BaseModel, Field
from qdrant_client.http import models

from src.clients.qdrant import QdrantClientWrapper
from src.embedders.factory import EmbedderFactory
from src.indexing.batch import Document

logger = logging.getLogger(__name__)


class IndexerConfig(BaseModel):
    """Configuration for document indexer."""

    collection_name: str = Field(default="engram_turns", description="Qdrant collection")
    dense_vector_name: str = Field(default="text_dense", description="Dense vector field")
    sparse_vector_name: str = Field(default="text_sparse", description="Sparse vector field")
    colbert_vector_name: str = Field(default="text_colbert", description="ColBERT vector field")
    enable_colbert: bool = Field(default=True, description="Enable ColBERT embeddings")
    batch_size: int = Field(default=32, description="Embedding batch size")


class DocumentIndexer:
    """Indexes documents with multi-vector embeddings to Qdrant.

    Generates three types of embeddings for each document:
    1. Dense embeddings for semantic search
    2. Sparse embeddings (SPLADE) for keyword-based search
    3. ColBERT multi-vector embeddings for late interaction (optional)

    All three are stored in Qdrant for hybrid retrieval.
    """

    def __init__(
        self,
        qdrant_client: QdrantClientWrapper,
        embedder_factory: EmbedderFactory,
        config: IndexerConfig | None = None,
    ) -> None:
        """Initialize the document indexer.

        Args:
            qdrant_client: Qdrant client wrapper.
            embedder_factory: Factory for creating embedder instances.
            config: Indexer configuration.
        """
        self.qdrant = qdrant_client
        self.embedders = embedder_factory
        self.config = config or IndexerConfig()

    async def index_documents(self, documents: list[Document]) -> int:
        """Index a batch of documents with multi-vector embeddings.

        Args:
            documents: List of documents to index.

        Returns:
            Count of successfully indexed documents.
        """
        if not documents:
            return 0

        logger.info(f"Indexing batch of {len(documents)} documents")

        try:
            # Extract text content for embedding
            texts = [doc.content for doc in documents]

            # Generate dense embeddings
            logger.debug("Generating dense embeddings...")
            text_embedder = await self.embedders.get_text_embedder()
            await text_embedder.load()
            dense_embeddings = await text_embedder.embed_batch(texts, is_query=False)

            # Generate sparse embeddings
            logger.debug("Generating sparse embeddings...")
            sparse_embedder = await self.embedders.get_sparse_embedder()
            await sparse_embedder.load()
            sparse_embeddings = sparse_embedder.embed_sparse_batch(texts)

            # Generate ColBERT embeddings (optional)
            colbert_embeddings: list[list[list[float]] | None] = [None] * len(documents)
            if self.config.enable_colbert:
                logger.debug("Generating ColBERT embeddings...")
                colbert_embedder = await self.embedders.get_colbert_embedder()
                await colbert_embedder.load()
                colbert_embeddings = [
                    emb if emb else None for emb in colbert_embedder.embed_document_batch(texts)
                ]

            # Build Qdrant points
            points = []
            for i, doc in enumerate(documents):
                point = self._build_point(
                    doc=doc,
                    dense_vec=dense_embeddings[i],
                    sparse_vec=sparse_embeddings[i],
                    colbert_vecs=colbert_embeddings[i],
                )
                points.append(point)

            # Upsert to Qdrant
            logger.debug(f"Upserting {len(points)} points to Qdrant")
            await self.qdrant.client.upsert(
                collection_name=self.config.collection_name,
                points=points,
            )

            logger.info(f"Successfully indexed {len(documents)} documents")
            return len(documents)

        except Exception as e:
            logger.error(f"Error indexing documents: {e}", exc_info=True)
            return 0

    async def index_single(self, document: Document) -> bool:
        """Index a single document.

        Args:
            document: Document to index.

        Returns:
            True if successful, False otherwise.
        """
        count = await self.index_documents([document])
        return count == 1

    def _build_point(
        self,
        doc: Document,
        dense_vec: list[float],
        sparse_vec: dict[int, float],
        colbert_vecs: list[list[float]] | None,
    ) -> models.PointStruct:
        """Build a Qdrant point from document and embeddings.

        Args:
            doc: Source document.
            dense_vec: Dense embedding vector.
            sparse_vec: Sparse embedding dictionary (token_id -> weight).
            colbert_vecs: Optional ColBERT multi-vector embeddings.

        Returns:
            Qdrant PointStruct ready for upsertion.
        """
        # Build vector dictionary
        vectors: dict[str, Any] = {
            self.config.dense_vector_name: dense_vec,
            self.config.sparse_vector_name: models.SparseVector(
                indices=list(sparse_vec.keys()),
                values=list(sparse_vec.values()),
            ),
        }

        # Add ColBERT vectors if available
        # For ColBERT, Qdrant expects a list of token embeddings (multi-vector)
        if colbert_vecs and self.config.enable_colbert:
            vectors[self.config.colbert_vector_name] = colbert_vecs

        # Build payload with content, org_id (required for tenant isolation), and metadata
        payload = {
            "content": doc.content,
            "org_id": doc.org_id,  # Required for tenant filtering
            **doc.metadata,
        }

        # Add session_id to payload if present
        if doc.session_id:
            payload["session_id"] = doc.session_id

        # Create and return the point
        return models.PointStruct(
            id=doc.id,
            vector=vectors,
            payload=payload,
        )
