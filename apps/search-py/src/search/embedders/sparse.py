"""Sparse embedder using SPLADE."""

import logging
from typing import Any

import torch  # type: ignore
from transformers import AutoModelForMaskedLM, AutoTokenizer  # type: ignore

from search.embedders.base import BaseEmbedder

logger = logging.getLogger(__name__)


class SparseEmbedder(BaseEmbedder):
    """Sparse embedder using SPLADE (Sparse Lexical and Dense Expansion).

    SPLADE produces sparse vectors where non-zero elements represent
    semantically-expanded terms. This is useful for hybrid search combining
    dense and sparse retrieval.

    Uses naver/splade-cocondenser-ensembledistil by default.
    """

    def __init__(
        self,
        model_name: str = "naver/splade-cocondenser-ensembledistil",
        device: str = "cpu",
        batch_size: int = 32,
        cache_size: int = 10000,
        max_length: int = 256,
        **kwargs: Any,
    ) -> None:
        """Initialize sparse embedder.

        Args:
                model_name: HuggingFace model identifier for SPLADE model.
                device: Device for inference (cpu, cuda, mps).
                batch_size: Batch size for batch operations.
                cache_size: LRU cache size.
                max_length: Maximum token length.
                **kwargs: Additional model arguments.
        """
        super().__init__(model_name, device, batch_size, cache_size)
        self.max_length = max_length
        self._model_kwargs = kwargs
        self._tokenizer: Any = None

    def _load_model(self) -> None:
        """Load SPLADE model and tokenizer."""
        logger.info(f"Loading SPLADE model: {self.model_name}")

        self._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        self._model = AutoModelForMaskedLM.from_pretrained(self.model_name)
        self._model.to(self.device)
        self._model.eval()

        logger.info(f"Loaded SPLADE model {self.model_name} on device {self.device}")

    def _compute_sparse_vector(self, text: str) -> dict[int, float]:
        """Compute SPLADE sparse vector for a single text.

        Args:
                text: Text to encode.

        Returns:
                Dictionary mapping token IDs to weights (sparse representation).
        """
        if not self._model or not self._tokenizer:
            raise RuntimeError("Model not loaded. Call load() first.")

        # Tokenize
        tokens = self._tokenizer(
            text,
            max_length=self.max_length,
            padding=True,
            truncation=True,
            return_tensors="pt",
        )
        tokens = {k: v.to(self.device) for k, v in tokens.items()}

        # Forward pass
        with torch.no_grad():
            output = self._model(**tokens)
            logits = output.logits

        # Apply ReLU and max pooling (SPLADE technique)
        # ReLU ensures non-negativity, max pool across sequence dimension
        vec = torch.max(
            torch.log(1 + torch.relu(logits)) * tokens["attention_mask"].unsqueeze(-1),
            dim=1,
        )[0]

        # Convert to sparse representation (only non-zero values)
        vec = vec.squeeze()
        cols = torch.nonzero(vec, as_tuple=True)[0]
        weights = vec[cols]

        # Return as dictionary: {token_id: weight}
        sparse_dict = {
            int(col): float(weight)
            for col, weight in zip(cols.tolist(), weights.tolist(), strict=False)
        }

        return sparse_dict

    def _embed_sync(self, text: str, is_query: bool = True) -> list[float]:
        """Synchronous single text embedding.

        Note: This returns a DENSE representation of the sparse vector
        for compatibility with the base class. For true sparse vectors,
        use embed_sparse() or embed_sparse_batch().

        Args:
                text: Text to embed.
                is_query: Whether this is a query (unused for SPLADE).

        Returns:
                Dense embedding vector (sparse vector converted to dense).
        """
        sparse_dict = self._compute_sparse_vector(text)

        # Convert sparse dict to dense vector
        # Vocabulary size is typically ~30k for BERT-based models
        vocab_size = self._tokenizer.vocab_size
        dense_vec = [0.0] * vocab_size

        for idx, weight in sparse_dict.items():
            if idx < vocab_size:
                dense_vec[idx] = weight

        return dense_vec

    def _embed_batch_sync(self, texts: list[str], is_query: bool = True) -> list[list[float]]:
        """Synchronous batch embedding.

        Args:
                texts: List of texts to embed.
                is_query: Whether these are queries (unused for SPLADE).

        Returns:
                List of dense embedding vectors.
        """
        return [self._embed_sync(text, is_query) for text in texts]

    def embed_sparse(self, text: str) -> dict[int, float]:
        """Get true sparse representation (recommended for SPLADE).

        Args:
                text: Text to embed.

        Returns:
                Dictionary mapping token IDs to weights.
        """
        if not self._model_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")
        return self._compute_sparse_vector(text)

    def embed_sparse_batch(self, texts: list[str]) -> list[dict[int, float]]:
        """Batch sparse embedding.

        Args:
                texts: List of texts to embed.

        Returns:
                List of sparse dictionaries.
        """
        if not self._model_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")
        return [self._compute_sparse_vector(text) for text in texts]

    @property
    def dimensions(self) -> int:
        """Get embedding dimensions.

        For sparse embeddings, this is the vocabulary size.

        Returns:
                Vocabulary size of the tokenizer.
        """
        if self._tokenizer:
            vocab_size: int = self._tokenizer.vocab_size
            return vocab_size
        # Default BERT vocab size
        return 30522
