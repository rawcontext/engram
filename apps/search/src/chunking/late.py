"""Late chunking for context-aware embeddings.

Implements the late chunking technique from the Jina AI paper:
https://arxiv.org/abs/2409.04701

The key insight is that embeddings computed for chunks of a document
lose context from the full document. Late chunking solves this by:
1. Embedding the entire document through the transformer
2. Applying mean pooling to token embeddings within each chunk boundary
3. Each chunk embedding now contains full document context

This is particularly useful for references like "it", "the function", etc.
that require cross-chunk context to resolve.
"""

import logging
from dataclasses import dataclass

import numpy as np
import torch
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


@dataclass
class ChunkBoundary:
    """Token boundaries for a chunk.

    Attributes:
        start_token: Start token index (inclusive).
        end_token: End token index (exclusive).
        start_char: Start character index in original text.
        end_char: End character index in original text.
    """

    start_token: int
    end_token: int
    start_char: int = 0
    end_char: int = 0


@dataclass
class LateChunkResult:
    """Result of late chunking embedding.

    Attributes:
        text: The chunk text.
        embedding: Context-aware embedding for this chunk.
        boundary: Token boundaries for this chunk.
    """

    text: str
    embedding: np.ndarray
    boundary: ChunkBoundary


class LateChunker:
    """Apply late chunking for context-aware chunk embeddings.

    Late chunking embeds the entire document first, then applies mean pooling
    per chunk. Each chunk embedding retains the full document context.

    Based on Jina AI paper: https://arxiv.org/abs/2409.04701

    Example:
        >>> model = SentenceTransformer("BAAI/bge-small-en-v1.5")
        >>> chunker = LateChunker(model)
        >>> text = "The quick brown fox jumps. It was very fast."
        >>> chunks = ["The quick brown fox jumps.", "It was very fast."]
        >>> embeddings = chunker.embed_chunks(text, chunks)
        >>> # embeddings[1] for "It was very fast" now has context of the fox
    """

    def __init__(
        self,
        model: SentenceTransformer,
        normalize_embeddings: bool = True,
    ) -> None:
        """Initialize the late chunker.

        Args:
            model: SentenceTransformer model for tokenization and embedding.
            normalize_embeddings: Whether to L2-normalize output embeddings.
        """
        self.model = model
        self.normalize_embeddings = normalize_embeddings
        self._device = model.device

    def embed_chunks(
        self,
        full_text: str,
        chunk_texts: list[str],
    ) -> list[np.ndarray]:
        """Embed chunks with full document context using late chunking.

        Args:
            full_text: The complete document text.
            chunk_texts: List of chunk strings (must be substrings of full_text).

        Returns:
            List of numpy arrays, one embedding per chunk.

        Raises:
            ValueError: If a chunk text is not found in full_text.
        """
        if not full_text or not chunk_texts:
            return []

        # Find token boundaries for each chunk
        boundaries = self._find_chunk_boundaries(full_text, chunk_texts)

        if not boundaries:
            # Fall back to regular embedding if boundary detection fails
            logger.warning("Could not determine chunk boundaries, using fallback")
            return self._fallback_embed(chunk_texts)

        # Get token embeddings for full document
        token_embeddings = self._get_token_embeddings(full_text)

        if token_embeddings is None:
            return self._fallback_embed(chunk_texts)

        # Apply mean pooling per chunk
        chunk_embeddings = []
        for boundary in boundaries:
            chunk_emb = self._pool_tokens(
                token_embeddings,
                boundary.start_token,
                boundary.end_token,
            )
            chunk_embeddings.append(chunk_emb)

        return chunk_embeddings

    def embed_with_boundaries(
        self,
        full_text: str,
        boundaries: list[ChunkBoundary],
    ) -> list[np.ndarray]:
        """Embed using pre-computed token boundaries.

        Args:
            full_text: The complete document text.
            boundaries: Pre-computed token boundaries for each chunk.

        Returns:
            List of numpy arrays, one embedding per chunk.
        """
        if not boundaries:
            return []

        # Get token embeddings for full document
        token_embeddings = self._get_token_embeddings(full_text)

        if token_embeddings is None:
            return []

        # Apply mean pooling per chunk
        chunk_embeddings = []
        for boundary in boundaries:
            chunk_emb = self._pool_tokens(
                token_embeddings,
                boundary.start_token,
                boundary.end_token,
            )
            chunk_embeddings.append(chunk_emb)

        return chunk_embeddings

    def embed_and_chunk(
        self,
        full_text: str,
        chunk_texts: list[str],
    ) -> list[LateChunkResult]:
        """Embed chunks and return full results with text and boundaries.

        Args:
            full_text: The complete document text.
            chunk_texts: List of chunk strings.

        Returns:
            List of LateChunkResult with text, embedding, and boundaries.
        """
        if not full_text or not chunk_texts:
            return []

        boundaries = self._find_chunk_boundaries(full_text, chunk_texts)
        embeddings = self.embed_chunks(full_text, chunk_texts)

        results = []
        for i, (text, emb) in enumerate(zip(chunk_texts, embeddings, strict=False)):
            boundary = boundaries[i] if i < len(boundaries) else ChunkBoundary(0, 0)
            results.append(LateChunkResult(text=text, embedding=emb, boundary=boundary))

        return results

    def _get_token_embeddings(self, text: str) -> torch.Tensor | None:
        """Get per-token embeddings from the transformer.

        Args:
            text: Input text.

        Returns:
            Tensor of shape (seq_len, hidden_dim) or None on error.
        """
        try:
            # Tokenize the text
            encoded = self.model.tokenize([text])

            # Move to model device
            encoded = {k: v.to(self._device) for k, v in encoded.items()}

            # Get model outputs
            with torch.no_grad():
                outputs = self.model.forward(encoded)

            # Extract token embeddings
            # The output format depends on the model architecture
            if "token_embeddings" in outputs:
                token_embeddings = outputs["token_embeddings"][0]
            elif "last_hidden_state" in outputs:
                token_embeddings = outputs["last_hidden_state"][0]
            else:
                # Try to access as a dict or direct tensor
                token_embeddings = outputs[0] if isinstance(outputs, tuple) else outputs

            return token_embeddings

        except Exception as e:
            logger.warning(f"Error getting token embeddings: {e}")
            return None

    def _find_chunk_boundaries(
        self,
        full_text: str,
        chunk_texts: list[str],
    ) -> list[ChunkBoundary]:
        """Find token boundaries for each chunk in the full text.

        Args:
            full_text: The complete document text.
            chunk_texts: List of chunk strings.

        Returns:
            List of ChunkBoundary objects.
        """
        boundaries = []

        # Tokenize the full text
        try:
            encoded = self.model.tokenize([full_text])
            full_tokens = encoded["input_ids"][0].tolist()
        except Exception as e:
            logger.warning(f"Error tokenizing full text: {e}")
            return []

        # For each chunk, find its token span
        current_pos = 0
        for chunk_text in chunk_texts:
            # Find character position of chunk in full text
            char_start = full_text.find(chunk_text, current_pos)
            if char_start == -1:
                # Chunk not found, use fallback
                logger.debug(f"Chunk not found in text: {chunk_text[:50]}...")
                boundaries.append(ChunkBoundary(0, len(full_tokens)))
                continue

            char_end = char_start + len(chunk_text)
            current_pos = char_end

            # Tokenize the chunk to get token count
            try:
                chunk_encoded = self.model.tokenize([chunk_text])
                chunk_token_count = len(chunk_encoded["input_ids"][0])

                # Estimate token position based on character position ratio
                ratio = char_start / len(full_text) if len(full_text) > 0 else 0
                estimated_start = int(ratio * len(full_tokens))

                # Adjust for special tokens (usually 1 at start, 1 at end)
                start_token = max(1, estimated_start)  # Skip [CLS] token
                end_token = min(start_token + chunk_token_count, len(full_tokens) - 1)

                boundaries.append(
                    ChunkBoundary(
                        start_token=start_token,
                        end_token=end_token,
                        start_char=char_start,
                        end_char=char_end,
                    )
                )

            except Exception as e:
                logger.warning(f"Error finding boundaries for chunk: {e}")
                boundaries.append(ChunkBoundary(0, len(full_tokens)))

        return boundaries

    def _pool_tokens(
        self,
        token_embeddings: torch.Tensor,
        start: int,
        end: int,
    ) -> np.ndarray:
        """Apply mean pooling to tokens within a range.

        Args:
            token_embeddings: Full document token embeddings.
            start: Start token index (inclusive).
            end: End token index (exclusive).

        Returns:
            Pooled embedding as numpy array.
        """
        # Ensure valid range
        start = max(0, start)
        end = min(end, len(token_embeddings))

        if start >= end:
            # Invalid range, return mean of all tokens
            pooled = token_embeddings.mean(dim=0)
        else:
            # Mean pool the chunk tokens
            chunk_tokens = token_embeddings[start:end]
            pooled = chunk_tokens.mean(dim=0)

        # Convert to numpy
        embedding = pooled.cpu().numpy()

        # Normalize if requested
        if self.normalize_embeddings:
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

        return embedding

    def _fallback_embed(self, chunk_texts: list[str]) -> list[np.ndarray]:
        """Fallback to regular embedding when late chunking fails.

        Args:
            chunk_texts: List of chunk strings.

        Returns:
            List of embeddings using standard encoding.
        """
        try:
            embeddings = self.model.encode(
                chunk_texts,
                normalize_embeddings=self.normalize_embeddings,
                convert_to_numpy=True,
            )
            return list(embeddings)
        except Exception as e:
            logger.error(f"Fallback embedding failed: {e}")
            # Return zero embeddings
            dim = self.model.get_sentence_embedding_dimension()
            return [np.zeros(dim) for _ in chunk_texts]
