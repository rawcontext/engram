"""Dense text embedder using sentence-transformers."""

import logging
from typing import Any

from sentence_transformers import SentenceTransformer  # type: ignore

from src.embedders.base import BaseEmbedder

logger = logging.getLogger(__name__)


class TextEmbedder(BaseEmbedder):
    """Dense text embedder using sentence-transformers.

    Uses BAAI/bge-base-en-v1.5 by default (768 dimensions).
    Supports query vs document prefixes for improved retrieval.
    """

    def __init__(
        self,
        model_name: str = "BAAI/bge-base-en-v1.5",
        device: str = "cpu",
        batch_size: int = 32,
        cache_size: int = 10000,
        normalize_embeddings: bool = True,
        **kwargs: Any,
    ) -> None:
        """Initialize text embedder.

        Args:
                model_name: HuggingFace model identifier.
                device: Device for inference (cpu, cuda, mps).
                batch_size: Batch size for batch operations.
                cache_size: LRU cache size.
                normalize_embeddings: Whether to normalize embeddings to unit length.
                **kwargs: Additional sentence-transformers arguments.
        """
        super().__init__(model_name, device, batch_size, cache_size)
        self.normalize_embeddings = normalize_embeddings
        self._model_kwargs = kwargs

        # BGE models use specific prefixes for queries
        self._query_prefix = "Represent this sentence for searching relevant passages: "
        self._doc_prefix = ""  # Documents don't need prefix for BGE

    def _load_model(self) -> None:
        """Load sentence-transformers model."""
        logger.info(f"Loading sentence-transformers model: {self.model_name}")

        self._model = SentenceTransformer(
            self.model_name,
            device=self.device,
            **self._model_kwargs,
        )

        # Get actual embedding dimension from model
        self._embedding_dim = self._model.get_sentence_embedding_dimension()

        logger.info(
            f"Loaded {self.model_name} with {self._embedding_dim} dimensions "
            f"on device {self.device}"
        )

    def _add_prefix(self, text: str, is_query: bool) -> str:
        """Add appropriate prefix based on text type.

        Args:
                text: Input text.
                is_query: Whether this is a query (vs document).

        Returns:
                Text with appropriate prefix.
        """
        if is_query and self._query_prefix:
            return f"{self._query_prefix}{text}"
        if not is_query and self._doc_prefix:
            return f"{self._doc_prefix}{text}"
        return text

    def _embed_sync(self, text: str, is_query: bool = True) -> list[float]:
        """Synchronous single text embedding.

        Args:
                text: Text to embed.
                is_query: Whether this is a query.

        Returns:
                Embedding vector.
        """
        if not self._model:
            raise RuntimeError("Model not loaded. Call load() first.")

        text_with_prefix = self._add_prefix(text, is_query)

        embedding = self._model.encode(
            text_with_prefix,
            normalize_embeddings=self.normalize_embeddings,
            convert_to_numpy=True,
        )

        result: list[float] = embedding.tolist()
        return result

    def _embed_batch_sync(self, texts: list[str], is_query: bool = True) -> list[list[float]]:
        """Synchronous batch embedding.

        Args:
                texts: List of texts to embed.
                is_query: Whether these are queries.

        Returns:
                List of embedding vectors.
        """
        if not self._model:
            raise RuntimeError("Model not loaded. Call load() first.")

        # Add prefixes to all texts
        texts_with_prefix = [self._add_prefix(text, is_query) for text in texts]

        embeddings = self._model.encode(
            texts_with_prefix,
            batch_size=self.batch_size,
            normalize_embeddings=self.normalize_embeddings,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

        result: list[list[float]] = embeddings.tolist()
        return result

    @property
    def dimensions(self) -> int:
        """Get embedding dimensions.

        Returns:
                Number of dimensions in embedding vector.
        """
        if self._model_loaded and hasattr(self, "_embedding_dim"):
            dim: int = self._embedding_dim
            return dim
        # Default for BGE-base
        return 768
