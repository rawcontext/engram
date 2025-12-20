"""Code-specific embedder with chunking support."""

import logging
import re
from typing import Any

from sentence_transformers import SentenceTransformer  # type: ignore

from src.embedders.base import BaseEmbedder

logger = logging.getLogger(__name__)


class CodeEmbedder(BaseEmbedder):
    """Code-specific embedder using nomic-embed-text-v1.5.

    Supports:
    - 8192 token context window
    - Task-specific prefixes
    - Smart code chunking for large files
    """

    def __init__(
        self,
        model_name: str = "nomic-ai/nomic-embed-text-v1.5",
        device: str = "cpu",
        batch_size: int = 32,
        cache_size: int = 10000,
        max_seq_length: int = 8192,
        chunk_size: int = 4096,
        chunk_overlap: int = 512,
        **kwargs: Any,
    ) -> None:
        """Initialize code embedder.

        Args:
                model_name: HuggingFace model identifier.
                device: Device for inference (cpu, cuda, mps).
                batch_size: Batch size for batch operations.
                cache_size: LRU cache size.
                max_seq_length: Maximum sequence length for model.
                chunk_size: Size of code chunks for large files.
                chunk_overlap: Overlap between chunks to preserve context.
                **kwargs: Additional sentence-transformers arguments.
        """
        super().__init__(model_name, device, batch_size, cache_size)
        self.max_seq_length = max_seq_length
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self._model_kwargs = kwargs

        # Nomic models use task-specific prefixes
        self._search_query_prefix = "search_query: "
        self._search_document_prefix = "search_document: "

    def _load_model(self) -> None:
        """Load sentence-transformers model."""
        logger.info(f"Loading code embedder model: {self.model_name}")

        self._model = SentenceTransformer(
            self.model_name,
            device=self.device,
            trust_remote_code=True,  # Nomic models require this
            **self._model_kwargs,
        )

        # Set max sequence length
        if hasattr(self._model, "max_seq_length"):
            self._model.max_seq_length = self.max_seq_length

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
        if is_query:
            return f"{self._search_query_prefix}{text}"
        return f"{self._search_document_prefix}{text}"

    def _chunk_code(self, code: str) -> list[str]:
        """Chunk large code files intelligently.

        Tries to split on function/class boundaries when possible.

        Args:
                code: Code text to chunk.

        Returns:
                List of code chunks.
        """
        # If code is small enough, return as-is
        if len(code) <= self.chunk_size:
            return [code]

        chunks: list[str] = []

        # Try to split on function/class definitions
        # Matches common patterns: def, class, function, const, let, var
        split_pattern = (
            r"(?=(?:def|class|function|const|let|var|async\s+def|async\s+function)\s+\w+)"
        )
        segments = re.split(split_pattern, code)

        current_chunk = ""
        for segment in segments:
            if not segment.strip():
                continue

            # If adding this segment exceeds chunk size
            if len(current_chunk) + len(segment) > self.chunk_size:
                if current_chunk:
                    chunks.append(current_chunk)
                current_chunk = segment
            else:
                current_chunk += segment

        # Add final chunk
        if current_chunk:
            chunks.append(current_chunk)

        # If we couldn't split intelligently, fall back to character-based chunking
        if len(chunks) == 1 and len(chunks[0]) > self.chunk_size:
            chunks = self._chunk_by_chars(code)

        logger.debug(f"Chunked code into {len(chunks)} chunks")
        return chunks

    def _chunk_by_chars(self, text: str) -> list[str]:
        """Chunk text by character count with overlap.

        Args:
                text: Text to chunk.

        Returns:
                List of text chunks.
        """
        chunks: list[str] = []
        start = 0

        while start < len(text):
            end = start + self.chunk_size
            chunk = text[start:end]
            chunks.append(chunk)
            start = end - self.chunk_overlap

        return chunks

    def _embed_sync(self, text: str, is_query: bool = True) -> list[float]:
        """Synchronous single text embedding.

        For long code files, embeds chunks and averages them.

        Args:
                text: Text to embed.
                is_query: Whether this is a query.

        Returns:
                Embedding vector.
        """
        if not self._model:
            raise RuntimeError("Model not loaded. Call load() first.")

        text_with_prefix = self._add_prefix(text, is_query)

        # Check if we need to chunk
        import numpy as np

        if not is_query and len(text_with_prefix) > self.chunk_size:
            chunks = self._chunk_code(text)
            chunks_with_prefix = [self._add_prefix(chunk, is_query) for chunk in chunks]

            embeddings = self._model.encode(
                chunks_with_prefix,
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )

            # Average chunk embeddings
            avg_embedding = np.mean(embeddings, axis=0)
            # Re-normalize
            avg_embedding = avg_embedding / np.linalg.norm(avg_embedding)
            chunked_result: list[float] = avg_embedding.tolist()
            return chunked_result

        embedding = self._model.encode(
            text_with_prefix,
            normalize_embeddings=True,
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

        # For batch, we don't chunk individual documents
        # Client should handle chunking if needed
        texts_with_prefix = [self._add_prefix(text, is_query) for text in texts]

        embeddings = self._model.encode(
            texts_with_prefix,
            batch_size=self.batch_size,
            normalize_embeddings=True,
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
        # Default for nomic-embed-text-v1.5
        return 768
