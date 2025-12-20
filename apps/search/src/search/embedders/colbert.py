"""ColBERT embedder using PyLate for late interaction multi-vector embeddings."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

from search.embedders.base import BaseEmbedder

logger = logging.getLogger(__name__)


class ColBERTEmbedder(BaseEmbedder):
    """ColBERT late interaction embedder using PyLate.

    ColBERT produces multiple vectors per document (one per token),
    enabling late interaction matching via MaxSim scoring.

    Uses colbert-ir/colbertv2.0 or answerai-colbert-small-v1 by default.
    """

    def __init__(
        self,
        model_name: str = "answerdotai/answerai-colbert-small-v1",
        device: str = "cpu",
        batch_size: int = 32,
        cache_size: int = 10000,
        **kwargs: Any,
    ) -> None:
        """Initialize ColBERT embedder.

        Args:
            model_name: ColBERT model identifier from HuggingFace.
            device: Device for inference (cpu, cuda, mps).
            batch_size: Batch size for batch operations.
            cache_size: LRU cache size.
            **kwargs: Additional PyLate arguments.
        """
        super().__init__(model_name, device, batch_size, cache_size)
        self._model_kwargs = kwargs
        self._embedding_dim = 128  # Default ColBERT dimension

    def _load_model(self) -> None:
        """Load PyLate ColBERT model."""
        logger.info(f"Loading ColBERT model via PyLate: {self.model_name}")

        try:
            from pylate import models  # type: ignore

            self._model = models.ColBERT(
                model_name_or_path=self.model_name,
                device=self.device,
                **self._model_kwargs,
            )

            # Get embedding dimension from model config if available
            if hasattr(self._model, "config") and hasattr(self._model.config, "embedding_size"):
                self._embedding_dim = self._model.config.embedding_size

            logger.info(
                f"Loaded ColBERT model {self.model_name} "
                f"({self._embedding_dim}d) on device {self.device}"
            )
        except Exception as e:
            logger.error(f"Failed to load ColBERT model: {e}")
            raise

    def _embed_sync(self, text: str, is_query: bool = True) -> list[float]:
        """Synchronous single text embedding.

        Note: ColBERT produces MULTIPLE vectors per text (one per token).
        This method returns a single averaged vector for compatibility
        with the base class. For true ColBERT late interaction,
        use embed_document() or embed_query().

        Args:
            text: Text to embed.
            is_query: Whether this is a query.

        Returns:
            Averaged embedding vector.
        """
        if not self._model:
            raise RuntimeError("Model not loaded. Call load() first.")

        # Encode with PyLate - returns tensor of shape [1, num_tokens, dim]
        if is_query:
            embeddings = self._model.encode([text], is_query=True)
        else:
            embeddings = self._model.encode([text], is_query=False)

        if embeddings is not None and len(embeddings) > 0:
            # Average across token vectors
            # embeddings[0] has shape [num_tokens, dim]
            emb_array = np.array(embeddings[0])
            avg_embedding = np.mean(emb_array, axis=0)
            result: list[float] = avg_embedding.tolist()
            return result

        # Fallback: return zero vector
        return [0.0] * self._embedding_dim

    def _embed_batch_sync(self, texts: list[str], is_query: bool = True) -> list[list[float]]:
        """Synchronous batch embedding.

        Args:
            texts: List of texts to embed.
            is_query: Whether these are queries.

        Returns:
            List of averaged embedding vectors.
        """
        if not self._model:
            raise RuntimeError("Model not loaded. Call load() first.")

        # Encode batch with PyLate
        embeddings = self._model.encode(texts, is_query=is_query)

        embeddings_list = []
        for emb in embeddings:
            if len(emb) > 0:
                emb_array = np.array(emb)
                avg_emb = np.mean(emb_array, axis=0)
                embeddings_list.append(avg_emb.tolist())
            else:
                embeddings_list.append([0.0] * self._embedding_dim)

        return embeddings_list

    def embed_query(self, query: str) -> list[list[float]]:
        """Embed query as multi-vector (true ColBERT representation).

        Args:
            query: Query text.

        Returns:
            List of token-level embedding vectors.
        """
        if not self._model_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        embeddings = self._model.encode([query], is_query=True)
        if embeddings is not None and len(embeddings) > 0:
            return [vec.tolist() if hasattr(vec, "tolist") else list(vec) for vec in embeddings[0]]
        return []

    def embed_document(self, document: str) -> list[list[float]]:
        """Embed document as multi-vector (true ColBERT representation).

        Args:
            document: Document text.

        Returns:
            List of token-level embedding vectors.
        """
        if not self._model_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        embeddings = self._model.encode([document], is_query=False)
        if embeddings is not None and len(embeddings) > 0:
            return [vec.tolist() if hasattr(vec, "tolist") else list(vec) for vec in embeddings[0]]
        return []

    def embed_query_batch(self, queries: list[str]) -> list[list[list[float]]]:
        """Batch embed queries as multi-vectors.

        Args:
            queries: List of query texts.

        Returns:
            List of multi-vector embeddings (one per query).
        """
        if not self._model_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        embeddings = self._model.encode(queries, is_query=True)
        return [
            [vec.tolist() if hasattr(vec, "tolist") else list(vec) for vec in emb]
            for emb in embeddings
        ]

    def embed_document_batch(self, documents: list[str]) -> list[list[list[float]]]:
        """Batch embed documents as multi-vectors.

        Args:
            documents: List of document texts.

        Returns:
            List of multi-vector embeddings (one per document).
        """
        if not self._model_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        embeddings = self._model.encode(documents, is_query=False)
        return [
            [vec.tolist() if hasattr(vec, "tolist") else list(vec) for vec in emb]
            for emb in embeddings
        ]

    @property
    def dimensions(self) -> int:
        """Get embedding dimensions per token.

        Returns:
            Number of dimensions per token vector.
        """
        return self._embedding_dim
