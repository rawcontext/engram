"""BM25 sparse embedder using FastEmbed (ONNX-based, no PyTorch required).

This module provides a lightweight BM25 sparse embedding implementation using
Qdrant's FastEmbed library. Unlike the SPLADE-based sparse embedder, this
uses ONNX Runtime and doesn't require PyTorch.

See: https://huggingface.co/Qdrant/bm25
"""

import asyncio
import logging
from functools import lru_cache

from fastembed import SparseTextEmbedding

logger = logging.getLogger(__name__)


class BM25Embedder:
    """BM25 sparse embedder using FastEmbed.

    Uses the Qdrant/bm25 model via FastEmbed's ONNX runtime for lightweight
    sparse embedding generation. No PyTorch or heavy ML dependencies required.

    The embeddings are compatible with Qdrant's sparse vector format and can
    be used for hybrid search alongside dense embeddings.

    Attributes:
        model_name: The FastEmbed model identifier.
        batch_size: Batch size for embedding generation.
        parallel: Number of parallel workers for embedding.
    """

    def __init__(
        self,
        model_name: str = "Qdrant/bm25",
        batch_size: int = 32,
        parallel: int | None = None,
    ) -> None:
        """Initialize BM25 embedder.

        Args:
            model_name: FastEmbed sparse model name. Defaults to "Qdrant/bm25".
            batch_size: Batch size for embedding generation.
            parallel: Number of parallel workers (None for auto).
        """
        self.model_name = model_name
        self.batch_size = batch_size
        self.parallel = parallel
        self._model: SparseTextEmbedding | None = None
        self._lock = asyncio.Lock()

        logger.info(f"Initialized BM25Embedder with model '{model_name}'")

    async def load(self) -> None:
        """Load the BM25 model.

        Thread-safe lazy loading of the model on first use.
        """
        async with self._lock:
            if self._model is None:
                logger.info(f"Loading BM25 model: {self.model_name}")
                # SparseTextEmbedding downloads and caches the model automatically
                self._model = SparseTextEmbedding(
                    model_name=self.model_name,
                    parallel=self.parallel,
                )
                logger.info(f"BM25 model loaded: {self.model_name}")

    async def unload(self) -> None:
        """Unload the model to free memory."""
        async with self._lock:
            self._model = None
            logger.info("BM25 model unloaded")

    def _get_model(self) -> SparseTextEmbedding:
        """Get the loaded model, raising if not loaded."""
        if self._model is None:
            raise RuntimeError("BM25 model not loaded. Call load() first.")
        return self._model

    def embed_sparse(self, text: str) -> dict[int, float]:
        """Generate sparse BM25 embedding for a single text.

        Args:
            text: Text to embed.

        Returns:
            Dictionary mapping token indices to weights.
        """
        if self._model is None:
            # Synchronous load for compatibility
            self._model = SparseTextEmbedding(
                model_name=self.model_name,
                parallel=self.parallel,
            )

        # FastEmbed returns a generator of SparseEmbedding objects
        embeddings = list(self._model.embed([text]))

        if not embeddings:
            return {}

        # SparseEmbedding has .indices and .values attributes
        sparse_embedding = embeddings[0]
        indices = sparse_embedding.indices.tolist()
        values = sparse_embedding.values.tolist()
        return dict(zip(indices, values, strict=True))

    async def embed_sparse_async(self, text: str) -> dict[int, float]:
        """Async version of embed_sparse.

        Args:
            text: Text to embed.

        Returns:
            Dictionary mapping token indices to weights.
        """
        await self.load()
        # Run in executor to avoid blocking
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.embed_sparse, text)

    def embed_sparse_batch(self, texts: list[str]) -> list[dict[int, float]]:
        """Generate sparse BM25 embeddings for multiple texts.

        Args:
            texts: List of texts to embed.

        Returns:
            List of dictionaries mapping token indices to weights.
        """
        if self._model is None:
            self._model = SparseTextEmbedding(
                model_name=self.model_name,
                parallel=self.parallel,
            )

        embeddings = list(self._model.embed(texts, batch_size=self.batch_size))

        results = []
        for sparse_embedding in embeddings:
            indices = sparse_embedding.indices.tolist()
            values = sparse_embedding.values.tolist()
            results.append(dict(zip(indices, values, strict=True)))
        return results

    async def embed_sparse_batch_async(self, texts: list[str]) -> list[dict[int, float]]:
        """Async version of embed_sparse_batch.

        Args:
            texts: List of texts to embed.

        Returns:
            List of dictionaries mapping token indices to weights.
        """
        await self.load()
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.embed_sparse_batch, texts)


@lru_cache(maxsize=1)
def get_bm25_embedder() -> BM25Embedder:
    """Get singleton BM25 embedder instance.

    Returns:
        Cached BM25Embedder instance.
    """
    return BM25Embedder()
