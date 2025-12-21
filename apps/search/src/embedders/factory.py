"""Factory for creating embedder instances."""

import asyncio
import logging
from typing import TYPE_CHECKING, Any, Literal, cast

from src.config import Settings
from src.embedders.base import BaseEmbedder

if TYPE_CHECKING:
    from src.clients.huggingface import HuggingFaceEmbedder

logger = logging.getLogger(__name__)

EmbedderType = Literal["text", "code", "sparse", "colbert"]


class EmbedderFactory:
    """Factory for creating and managing embedder instances.

    Provides:
    - Lazy loading of embedders
    - Singleton pattern for each embedder type
    - Easy access to all embedder types
    - Thread-safe creation with asyncio locks
    """

    def __init__(self, settings: Settings) -> None:
        """Initialize embedder factory.

        Args:
                settings: Application settings.
        """
        self.settings = settings
        self._embedders: dict[str, BaseEmbedder] = {}
        self._locks: dict[str, asyncio.Lock] = {
            "text": asyncio.Lock(),
            "code": asyncio.Lock(),
            "sparse": asyncio.Lock(),
            "colbert": asyncio.Lock(),
        }

    async def get_text_embedder(self) -> Any:
        """Get or create text embedder instance.

        Returns backend-appropriate embedder based on settings.embedder_backend:
        - 'local': Returns TextEmbedder (SentenceTransformer-based)
        - 'huggingface': Returns HuggingFaceEmbedder (API-based)

        Returns:
            TextEmbedder or HuggingFaceEmbedder instance.
        """
        async with self._locks["text"]:
            if "text" not in self._embedders:
                if self.settings.embedder_backend == "huggingface":
                    from src.clients.huggingface import HuggingFaceEmbedder

                    logger.info("Creating HuggingFace text embedder")
                    self._embedders["text"] = HuggingFaceEmbedder(
                        model_id=self.settings.embedder_text_model,
                        api_token=self.settings.hf_api_token,
                    )
                else:
                    from src.embedders.text import TextEmbedder

                    logger.info("Creating local text embedder")
                    self._embedders["text"] = TextEmbedder(
                        model_name=self.settings.embedder_text_model,
                        device=self.settings.embedder_device,
                        batch_size=self.settings.embedder_batch_size,
                        cache_size=self.settings.embedder_cache_size,
                    )
            return self._embedders["text"]

    async def get_code_embedder(self) -> Any:
        """Get or create code embedder instance.

        Returns backend-appropriate embedder based on settings.embedder_backend:
        - 'local': Returns CodeEmbedder (SentenceTransformer-based)
        - 'huggingface': Returns HuggingFaceEmbedder (API-based)

        Returns:
            CodeEmbedder or HuggingFaceEmbedder instance.
        """
        async with self._locks["code"]:
            if "code" not in self._embedders:
                if self.settings.embedder_backend == "huggingface":
                    from src.clients.huggingface import HuggingFaceEmbedder

                    logger.info("Creating HuggingFace code embedder")
                    self._embedders["code"] = HuggingFaceEmbedder(
                        model_id=self.settings.embedder_code_model,
                        api_token=self.settings.hf_api_token,
                    )
                else:
                    from src.embedders.code import CodeEmbedder

                    logger.info("Creating local code embedder")
                    self._embedders["code"] = CodeEmbedder(
                        model_name=self.settings.embedder_code_model,
                        device=self.settings.embedder_device,
                        batch_size=self.settings.embedder_batch_size,
                        cache_size=self.settings.embedder_cache_size,
                    )
            return self._embedders["code"]

    async def get_sparse_embedder(self) -> Any:
        """Get or create sparse embedder instance.

        Note: Sparse embedders require local dependencies and are not available
        via HuggingFace Inference API.

        Returns:
                SparseEmbedder instance.

        Raises:
            ImportError: If local ML dependencies are not installed.
        """
        async with self._locks["sparse"]:
            if "sparse" not in self._embedders:
                from src.embedders.sparse import SparseEmbedder

                logger.info("Creating sparse embedder")
                self._embedders["sparse"] = SparseEmbedder(
                    model_name=self.settings.embedder_sparse_model,
                    device=self.settings.embedder_device,
                    batch_size=self.settings.embedder_batch_size,
                    cache_size=self.settings.embedder_cache_size,
                )
            return self._embedders["sparse"]

    async def get_colbert_embedder(self) -> Any:
        """Get or create ColBERT embedder instance.

        Note: ColBERT embedders require local dependencies and are not available
        via HuggingFace Inference API.

        Returns:
                ColBERTEmbedder instance.

        Raises:
            ImportError: If local ML dependencies are not installed.
        """
        async with self._locks["colbert"]:
            if "colbert" not in self._embedders:
                from src.embedders.colbert import ColBERTEmbedder

                logger.info("Creating ColBERT embedder")
                self._embedders["colbert"] = ColBERTEmbedder(
                    model_name=self.settings.embedder_colbert_model,
                    device=self.settings.embedder_device,
                    batch_size=self.settings.embedder_batch_size,
                    cache_size=self.settings.embedder_cache_size,
                )
            return self._embedders["colbert"]

    async def get_embedder(self, embedder_type: EmbedderType) -> BaseEmbedder:
        """Get embedder by type.

        Args:
                embedder_type: Type of embedder to get.

        Returns:
                Embedder instance.

        Raises:
                ValueError: If embedder type is invalid.
        """
        if embedder_type == "text":
            return await self.get_text_embedder()
        elif embedder_type == "code":
            return await self.get_code_embedder()
        elif embedder_type == "sparse":
            return await self.get_sparse_embedder()
        elif embedder_type == "colbert":
            return await self.get_colbert_embedder()
        else:
            raise ValueError(f"Invalid embedder type: {embedder_type}")

    async def preload_all(self) -> None:
        """Preload all embedder models.

        This is useful for warming up models during application startup.
        Failures in individual embedders are logged but don't stop other embedders.
        """
        logger.info("Preloading all embedder models...")

        # Get embedders (this will create them if they don't exist)
        embedders = await asyncio.gather(
            self.get_text_embedder(),
            self.get_code_embedder(),
            self.get_sparse_embedder(),
            self.get_colbert_embedder(),
            return_exceptions=True,
        )

        # Filter out failed embedders
        successful_embedders = [e for e in embedders if not isinstance(e, Exception)]

        # Load all models concurrently, collecting any errors
        results = await asyncio.gather(
            *[embedder.load() for embedder in successful_embedders],
            return_exceptions=True,
        )

        # Log any failures but continue
        for embedder, result in zip(successful_embedders, results, strict=True):
            if isinstance(result, Exception):
                logger.error(f"Failed to preload {embedder.model_name}: {result}")
                # Remove failed embedder from the factory
                for key, value in list(self._embedders.items()):
                    if value is embedder:
                        del self._embedders[key]
                        break

        logger.info(f"Preloaded {len(self._embedders)} embedder models successfully")

    async def unload_all(self) -> None:
        """Unload all embedder models to free memory."""
        logger.info("Unloading all embedder models...")

        await asyncio.gather(*[embedder.unload() for embedder in self._embedders.values()])

        self._embedders.clear()
        logger.info("All embedder models unloaded")

    def __len__(self) -> int:
        """Get number of loaded embedders.

        Returns:
                Number of currently loaded embedders.
        """
        return len(self._embedders)
