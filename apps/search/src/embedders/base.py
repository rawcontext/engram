"""Base abstract class for all embedders."""

import asyncio
import logging
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import torch  # type: ignore

logger = logging.getLogger(__name__)


class BaseEmbedder(ABC):
    """Abstract base class for all embedder implementations.

    All embedders must:
    - Support async operations (using thread pool for sync models)
    - Implement both single and batch embedding
    - Handle GPU/CPU device management
    - Provide proper error handling and logging
    """

    def __init__(
        self,
        model_name: str,
        device: str = "cpu",
        batch_size: int = 32,
        cache_size: int = 10000,
        **kwargs: Any,
    ) -> None:
        """Initialize base embedder.

        Args:
                model_name: HuggingFace model identifier.
                device: Device to use for inference (cpu, cuda, mps).
                batch_size: Default batch size for batch operations.
                cache_size: Size of LRU cache for embeddings.
                **kwargs: Additional model-specific arguments.
        """
        self.model_name = model_name
        self.device = self._get_device(device)
        self.batch_size = batch_size
        self.cache_size = cache_size
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._model: Any = None
        self._model_loaded = False

        logger.info(
            f"Initializing {self.__class__.__name__} with model '{model_name}' "
            f"on device '{self.device}'"
        )

    def _get_device(self, device: str) -> str:
        """Auto-detect and validate device.

        Args:
                device: Requested device (cpu, cuda, mps, auto).

        Returns:
                Validated device string.
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

    @abstractmethod
    def _load_model(self) -> None:
        """Load the embedding model.

        This must be implemented by each embedder subclass.
        Should set self._model and self._model_loaded = True.
        """
        pass

    @abstractmethod
    def _embed_sync(self, text: str, is_query: bool = True) -> list[float]:
        """Synchronous embedding of a single text.

        Args:
                text: Text to embed.
                is_query: Whether this is a query (vs document). Some models use different
                        prefixes or processing for queries vs documents.

        Returns:
                Embedding vector as list of floats.
        """
        pass

    @abstractmethod
    def _embed_batch_sync(self, texts: list[str], is_query: bool = True) -> list[list[float]]:
        """Synchronous batch embedding.

        Args:
                texts: List of texts to embed.
                is_query: Whether these are queries (vs documents).

        Returns:
                List of embedding vectors.
        """
        pass

    async def embed(self, text: str, is_query: bool = True) -> list[float]:
        """Async embedding of a single text.

        Args:
                text: Text to embed.
                is_query: Whether this is a query.

        Returns:
                Embedding vector.
        """
        if not self._model_loaded:
            await self.load()

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, self._embed_sync, text, is_query)

    async def embed_batch(self, texts: list[str], is_query: bool = True) -> list[list[float]]:
        """Async batch embedding.

        Args:
                texts: List of texts to embed.
                is_query: Whether these are queries.

        Returns:
                List of embedding vectors.
        """
        if not self._model_loaded:
            await self.load()

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, self._embed_batch_sync, texts, is_query)

    async def load(self) -> None:
        """Load the model asynchronously.

        This runs the synchronous _load_model in a thread pool.
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

    @property
    def dimensions(self) -> int:
        """Get embedding dimensions.

        This should be overridden by subclasses to return the correct dimension.
        """
        return 0

    def __del__(self) -> None:
        """Cleanup executor on deletion."""
        self._executor.shutdown(wait=False)
