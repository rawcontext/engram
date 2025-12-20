"""Factory for creating embedder instances."""

import logging
from typing import Literal

from search.config import Settings
from search.embedders.base import BaseEmbedder
from search.embedders.code import CodeEmbedder
from search.embedders.colbert import ColBERTEmbedder
from search.embedders.sparse import SparseEmbedder
from search.embedders.text import TextEmbedder

logger = logging.getLogger(__name__)

EmbedderType = Literal["text", "code", "sparse", "colbert"]


class EmbedderFactory:
	"""Factory for creating and managing embedder instances.

	Provides:
	- Lazy loading of embedders
	- Singleton pattern for each embedder type
	- Easy access to all embedder types
	"""

	def __init__(self, settings: Settings) -> None:
		"""Initialize embedder factory.

		Args:
			settings: Application settings.
		"""
		self.settings = settings
		self._embedders: dict[str, BaseEmbedder] = {}

	def get_text_embedder(self) -> TextEmbedder:
		"""Get or create text embedder instance.

		Returns:
			TextEmbedder instance.
		"""
		if "text" not in self._embedders:
			logger.info("Creating text embedder")
			self._embedders["text"] = TextEmbedder(
				model_name=self.settings.embedder_text_model,
				device=self.settings.embedder_device,
				batch_size=self.settings.embedder_batch_size,
				cache_size=self.settings.embedder_cache_size,
			)
		return self._embedders["text"]  # type: ignore

	def get_code_embedder(self) -> CodeEmbedder:
		"""Get or create code embedder instance.

		Returns:
			CodeEmbedder instance.
		"""
		if "code" not in self._embedders:
			logger.info("Creating code embedder")
			self._embedders["code"] = CodeEmbedder(
				model_name=self.settings.embedder_code_model,
				device=self.settings.embedder_device,
				batch_size=self.settings.embedder_batch_size,
				cache_size=self.settings.embedder_cache_size,
			)
		return self._embedders["code"]  # type: ignore

	def get_sparse_embedder(self) -> SparseEmbedder:
		"""Get or create sparse embedder instance.

		Returns:
			SparseEmbedder instance.
		"""
		if "sparse" not in self._embedders:
			logger.info("Creating sparse embedder")
			self._embedders["sparse"] = SparseEmbedder(
				model_name=self.settings.embedder_sparse_model,
				device=self.settings.embedder_device,
				batch_size=self.settings.embedder_batch_size,
				cache_size=self.settings.embedder_cache_size,
			)
		return self._embedders["sparse"]  # type: ignore

	def get_colbert_embedder(self) -> ColBERTEmbedder:
		"""Get or create ColBERT embedder instance.

		Returns:
			ColBERTEmbedder instance.
		"""
		if "colbert" not in self._embedders:
			logger.info("Creating ColBERT embedder")
			self._embedders["colbert"] = ColBERTEmbedder(
				model_name=self.settings.embedder_colbert_model,
				device=self.settings.embedder_device,
				batch_size=self.settings.embedder_batch_size,
				cache_size=self.settings.embedder_cache_size,
			)
		return self._embedders["colbert"]  # type: ignore

	def get_embedder(self, embedder_type: EmbedderType) -> BaseEmbedder:
		"""Get embedder by type.

		Args:
			embedder_type: Type of embedder to get.

		Returns:
			Embedder instance.

		Raises:
			ValueError: If embedder type is invalid.
		"""
		if embedder_type == "text":
			return self.get_text_embedder()
		elif embedder_type == "code":
			return self.get_code_embedder()
		elif embedder_type == "sparse":
			return self.get_sparse_embedder()
		elif embedder_type == "colbert":
			return self.get_colbert_embedder()
		else:
			raise ValueError(f"Invalid embedder type: {embedder_type}")

	async def preload_all(self) -> None:
		"""Preload all embedder models.

		This is useful for warming up models during application startup.
		"""
		logger.info("Preloading all embedder models...")

		embedders = [
			self.get_text_embedder(),
			self.get_code_embedder(),
			self.get_sparse_embedder(),
			self.get_colbert_embedder(),
		]

		# Load all models concurrently
		import asyncio
		await asyncio.gather(*[embedder.load() for embedder in embedders])

		logger.info("All embedder models preloaded successfully")

	async def unload_all(self) -> None:
		"""Unload all embedder models to free memory."""
		logger.info("Unloading all embedder models...")

		import asyncio
		await asyncio.gather(
			*[embedder.unload() for embedder in self._embedders.values()]
		)

		self._embedders.clear()
		logger.info("All embedder models unloaded")

	def __len__(self) -> int:
		"""Get number of loaded embedders.

		Returns:
			Number of currently loaded embedders.
		"""
		return len(self._embedders)
