"""
Sentence-transformers embedder for benchmark suite.

Provides a lightweight wrapper around sentence-transformers for:
- Dense vector embeddings
- Multiple embedding models
- Async operations via thread pool
- CPU/GPU device management

This mirrors the pattern from search-py but simplified for benchmarking.
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import torch  # type: ignore
from sentence_transformers import SentenceTransformer  # type: ignore

logger = logging.getLogger(__name__)


class EmbeddingProvider:
    """
    Sentence-transformers wrapper for embedding generation.

    Examples:
        >>> provider = EmbeddingProvider(model_name="BAAI/bge-base-en-v1.5")
        >>> await provider.load()
        >>> embedding = await provider.embed("Hello world")
        >>> len(embedding)
        768
        >>> embeddings = await provider.embed_batch(["Text 1", "Text 2"])
        >>> len(embeddings)
        2
    """

    def __init__(
        self,
        model_name: str = "BAAI/bge-base-en-v1.5",
        device: str = "cpu",
        batch_size: int = 32,
        normalize_embeddings: bool = True,
        **kwargs: Any,
    ) -> None:
        """
        Initialize embedding provider.

        Args:
            model_name: HuggingFace model identifier
            device: Device for inference (cpu, cuda, mps, auto)
            batch_size: Batch size for batch operations
            normalize_embeddings: Whether to normalize embeddings to unit length
            **kwargs: Additional sentence-transformers arguments
        """
        self.model_name = model_name
        self.device = self._get_device(device)
        self.batch_size = batch_size
        self.normalize_embeddings = normalize_embeddings
        self._model_kwargs = kwargs
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._model: SentenceTransformer | None = None
        self._model_loaded = False
        self._embedding_dim = 0

        logger.info(
            f"Initializing EmbeddingProvider with model '{model_name}' on device '{self.device}'"
        )

    def _get_device(self, device: str) -> str:
        """
        Auto-detect and validate device.

        Args:
            device: Requested device (cpu, cuda, mps, auto)

        Returns:
            Validated device string
        """
        if device == "auto":
            if torch.cuda.is_available():
                return "cuda"
            elif torch.backends.mps.is_available():
                return "mps"
            return "cpu"

        if device == "cuda" and not torch.cuda.is_available():
            logger.warning("CUDA requested but not available, falling back to CPU")
            return "cpu"

        if device == "mps" and not torch.backends.mps.is_available():
            logger.warning("MPS requested but not available, falling back to CPU")
            return "cpu"

        return device

    def _load_model(self) -> None:
        """Load sentence-transformers model (sync operation)."""
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

    def _embed_sync(self, text: str) -> list[float]:
        """
        Synchronous single text embedding.

        Args:
            text: Text to embed

        Returns:
            Embedding vector as list of floats

        Raises:
            RuntimeError: If model not loaded
        """
        if not self._model:
            raise RuntimeError("Model not loaded. Call load() first.")

        embedding = self._model.encode(
            text,
            normalize_embeddings=self.normalize_embeddings,
            convert_to_numpy=True,
        )

        result: list[float] = embedding.tolist()
        return result

    def _embed_batch_sync(self, texts: list[str]) -> list[list[float]]:
        """
        Synchronous batch embedding.

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors

        Raises:
            RuntimeError: If model not loaded
        """
        if not self._model:
            raise RuntimeError("Model not loaded. Call load() first.")

        embeddings = self._model.encode(
            texts,
            batch_size=self.batch_size,
            normalize_embeddings=self.normalize_embeddings,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

        result: list[list[float]] = embeddings.tolist()
        return result

    async def load(self) -> None:
        """
        Load the model asynchronously.

        Runs the synchronous _load_model in a thread pool.
        """
        if self._model_loaded:
            logger.debug(f"Model {self.model_name} already loaded")
            return

        logger.info(f"Loading model {self.model_name}...")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(self._executor, self._load_model)
        self._model_loaded = True
        logger.info(f"Model {self.model_name} loaded successfully")

    async def unload(self) -> None:
        """Unload the model to free memory."""
        if not self._model_loaded:
            return

        logger.info(f"Unloading model {self.model_name}...")
        self._model = None
        self._model_loaded = False

        # Clear CUDA cache if using GPU
        if self.device == "cuda":
            torch.cuda.empty_cache()

    async def embed(self, text: str) -> list[float]:
        """
        Async embedding of a single text.

        Args:
            text: Text to embed

        Returns:
            Embedding vector
        """
        if not self._model_loaded:
            await self.load()

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, self._embed_sync, text)

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """
        Async batch embedding.

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors
        """
        if not self._model_loaded:
            await self.load()

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, self._embed_batch_sync, texts)

    @property
    def dimensions(self) -> int:
        """
        Get embedding dimensions.

        Returns:
            Number of dimensions in embedding vector
        """
        if self._model_loaded and self._embedding_dim > 0:
            return self._embedding_dim
        # Default for BGE-base (will be updated after model loads)
        return 768

    def __del__(self) -> None:
        """Cleanup executor on deletion."""
        self._executor.shutdown(wait=False)
