"""ColBERT embedder using RAGatouille."""

import logging
from typing import Any

from ragatouille import RAGPretrainedModel

from search.embedders.base import BaseEmbedder

logger = logging.getLogger(__name__)


class ColBERTEmbedder(BaseEmbedder):
	"""ColBERT late interaction embedder using RAGatouille.

	ColBERT produces multiple vectors per document (one per token),
	enabling late interaction matching via MaxSim scoring.

	Uses colbert-ir/colbertv2.0 by default.
	"""

	def __init__(
		self,
		model_name: str = "colbert-ir/colbertv2.0",
		device: str = "cpu",
		batch_size: int = 32,
		cache_size: int = 10000,
		n_gpu: int = -1,  # -1 for auto-detect
		**kwargs: Any,
	) -> None:
		"""Initialize ColBERT embedder.

		Args:
			model_name: ColBERT model identifier.
			device: Device for inference (cpu, cuda, mps).
			batch_size: Batch size for batch operations.
			cache_size: LRU cache size.
			n_gpu: Number of GPUs to use (-1 for auto-detect).
			**kwargs: Additional RAGatouille arguments.
		"""
		super().__init__(model_name, device, batch_size, cache_size)
		self.n_gpu = n_gpu
		self._model_kwargs = kwargs

	def _load_model(self) -> None:
		"""Load RAGatouille ColBERT model."""
		logger.info(f"Loading ColBERT model via RAGatouille: {self.model_name}")

		# RAGatouille uses different device naming
		rag_device = "cpu" if self.device == "cpu" else "cuda"

		try:
			self._model = RAGPretrainedModel.from_pretrained(
				self.model_name,
				n_gpu=self.n_gpu if rag_device == "cuda" else 0,
				verbose=1,
			)

			logger.info(
				f"Loaded ColBERT model {self.model_name} on device {self.device}"
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

		# Get multi-vector representation
		if is_query:
			# RAGatouille's encode_queries returns list of embeddings per query
			embeddings = self._model.encode_queries([text])
			if embeddings and len(embeddings) > 0:
				# Average across token vectors
				import numpy as np
				avg_embedding = np.mean(embeddings[0], axis=0)
				return avg_embedding.tolist()
		else:
			# For documents, RAGatouille's encode_documents returns dict
			# We'll use a simpler approach - treat as query for embedding
			embeddings = self._model.encode_queries([text])
			if embeddings and len(embeddings) > 0:
				import numpy as np
				avg_embedding = np.mean(embeddings[0], axis=0)
				return avg_embedding.tolist()

		# Fallback: return zero vector
		return [0.0] * 128

	def _embed_batch_sync(
		self, texts: list[str], is_query: bool = True
	) -> list[list[float]]:
		"""Synchronous batch embedding.

		Args:
			texts: List of texts to embed.
			is_query: Whether these are queries.

		Returns:
			List of averaged embedding vectors.
		"""
		if not self._model:
			raise RuntimeError("Model not loaded. Call load() first.")

		embeddings_list = []

		if is_query:
			embeddings = self._model.encode_queries(texts)
			import numpy as np
			for emb in embeddings:
				if len(emb) > 0:
					avg_emb = np.mean(emb, axis=0)
					embeddings_list.append(avg_emb.tolist())
				else:
					embeddings_list.append([0.0] * 128)
		else:
			# Treat documents as queries for batch embedding
			embeddings = self._model.encode_queries(texts)
			import numpy as np
			for emb in embeddings:
				if len(emb) > 0:
					avg_emb = np.mean(emb, axis=0)
					embeddings_list.append(avg_emb.tolist())
				else:
					embeddings_list.append([0.0] * 128)

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

		embeddings = self._model.encode_queries([query])
		if embeddings and len(embeddings) > 0:
			return [vec.tolist() for vec in embeddings[0]]
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

		# For documents, we use the same encoding as queries
		# RAGatouille handles indexing separately
		embeddings = self._model.encode_queries([document])
		if embeddings and len(embeddings) > 0:
			return [vec.tolist() for vec in embeddings[0]]
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

		embeddings = self._model.encode_queries(queries)
		return [[vec.tolist() for vec in emb] for emb in embeddings]

	@property
	def dimensions(self) -> int:
		"""Get embedding dimensions per token.

		ColBERT uses 128 dimensions per token vector.

		Returns:
			Number of dimensions per token vector.
		"""
		return 128
