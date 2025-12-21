"""Semantic chunker for splitting text at semantic boundaries.

Uses embedding similarity between consecutive sentences to identify
natural breakpoints in the text. Preserves code blocks intact.
"""

import logging
import re
from dataclasses import dataclass, field

import numpy as np
from pydantic import BaseModel, Field

from src.embedders.text import TextEmbedder

logger = logging.getLogger(__name__)


class ChunkingConfig(BaseModel):
    """Configuration for semantic chunking."""

    similarity_threshold: float = Field(
        default=0.7,
        description="Minimum cosine similarity to keep sentences in same chunk. "
        "Lower values create larger chunks, higher values create more splits.",
    )
    min_chunk_chars: int = Field(
        default=100, description="Minimum characters per chunk. Smaller chunks are merged."
    )
    max_chunk_chars: int = Field(
        default=2000,
        description="Maximum characters per chunk. Larger chunks are force-split.",
    )
    keep_code_blocks_intact: bool = Field(
        default=True, description="Preserve code blocks as single units."
    )
    max_code_block_chars: int = Field(
        default=1500, description="Maximum code block size before splitting."
    )


@dataclass
class Chunk:
    """A single chunk of text with metadata."""

    text: str
    """The chunk text content."""

    index: int
    """Zero-based index of this chunk in the document."""

    start_char: int
    """Character offset where this chunk starts in the original document."""

    end_char: int
    """Character offset where this chunk ends in the original document."""

    is_code: bool = False
    """Whether this chunk is primarily a code block."""

    sentence_count: int = 0
    """Number of sentences in this chunk."""

    metadata: dict = field(default_factory=dict)
    """Additional metadata for this chunk."""

    @property
    def char_count(self) -> int:
        """Number of characters in this chunk."""
        return len(self.text)


class SemanticChunker:
    """Splits text at semantic boundaries using embedding similarity.

    The chunker works by:
    1. Extracting and temporarily replacing code blocks
    2. Splitting remaining text into sentences
    3. Computing embeddings for each sentence
    4. Finding breakpoints where consecutive sentence similarity drops below threshold
    5. Grouping sentences into chunks based on breakpoints
    6. Reinserting code blocks at appropriate positions
    7. Merging small chunks and splitting oversized ones

    Example:
        >>> embedder = TextEmbedder()
        >>> await embedder.load()
        >>> chunker = SemanticChunker(embedder)
        >>> chunks = await chunker.chunk(long_document)
        >>> for chunk in chunks:
        ...     print(f"Chunk {chunk.index}: {len(chunk.text)} chars")
    """

    # Regex for code blocks (```language\n...\n```)
    CODE_BLOCK_PATTERN = re.compile(r"```[\w]*\n[\s\S]*?\n```", re.MULTILINE)

    # Regex for sentence splitting - handles common abbreviations
    SENTENCE_PATTERN = re.compile(
        r"(?<=[.!?])\s+(?=[A-Z])|"  # Standard sentence end
        r"(?<=\n)\n+|"  # Double newlines
        r"(?<=:)\n(?=[A-Z\d-])"  # After colon + newline
    )

    def __init__(
        self,
        embedder: TextEmbedder,
        config: ChunkingConfig | None = None,
    ) -> None:
        """Initialize the semantic chunker.

        Args:
            embedder: Text embedder for computing sentence embeddings.
            config: Chunking configuration.
        """
        self.embedder = embedder
        self.config = config or ChunkingConfig()
        self._code_blocks: list[tuple[str, str]] = []

    async def chunk(self, text: str) -> list[Chunk]:
        """Split text into semantically coherent chunks.

        Args:
            text: Input text to chunk.

        Returns:
            List of Chunk objects with text and metadata.
        """
        if not text or not text.strip():
            return []

        text = text.strip()

        # Short text doesn't need chunking
        if len(text) <= self.config.max_chunk_chars:
            return [
                Chunk(
                    text=text,
                    index=0,
                    start_char=0,
                    end_char=len(text),
                    is_code="```" in text,
                    sentence_count=len(self._split_sentences(text)),
                )
            ]

        # Extract code blocks first
        text_without_code, code_placeholders = self._extract_code_blocks(text)

        # Split into sentences
        sentences = self._split_sentences(text_without_code)

        if len(sentences) <= 1:
            # Only one sentence, just return the whole text
            return self._finalize_chunks([text], 0)

        # Find semantic breakpoints
        breakpoints = await self._find_breakpoints(sentences)

        # Create chunks from breakpoints
        raw_chunks = self._create_chunks_from_breakpoints(sentences, breakpoints)

        # Restore code blocks
        chunks_with_code = self._restore_code_blocks(raw_chunks, code_placeholders)

        # Merge small chunks and split large ones
        final_chunks = self._balance_chunk_sizes(chunks_with_code)

        # Create Chunk objects
        return self._finalize_chunks(final_chunks, 0)

    def _extract_code_blocks(self, text: str) -> tuple[str, dict[str, str]]:
        """Extract code blocks and replace with placeholders.

        Args:
            text: Input text with code blocks.

        Returns:
            Tuple of (text with placeholders, placeholder->code mapping).
        """
        placeholders: dict[str, str] = {}
        self._code_blocks = []

        def replace_code_block(match: re.Match) -> str:
            code = match.group(0)
            placeholder = f"__CODE_BLOCK_{len(placeholders)}__"
            placeholders[placeholder] = code
            self._code_blocks.append((placeholder, code))
            return placeholder

        text_without_code = self.CODE_BLOCK_PATTERN.sub(replace_code_block, text)
        return text_without_code, placeholders

    def _restore_code_blocks(self, chunks: list[str], placeholders: dict[str, str]) -> list[str]:
        """Restore code blocks from placeholders.

        Args:
            chunks: List of chunk strings with placeholders.
            placeholders: Mapping of placeholder to original code.

        Returns:
            Chunks with code blocks restored.
        """
        restored = []
        for chunk in chunks:
            for placeholder, code in placeholders.items():
                chunk = chunk.replace(placeholder, code)
            restored.append(chunk)
        return restored

    def _split_sentences(self, text: str) -> list[str]:
        """Split text into sentences.

        Args:
            text: Input text.

        Returns:
            List of sentence strings.
        """
        # First try splitting by the pattern
        parts = self.SENTENCE_PATTERN.split(text)

        # Filter empty parts and strip whitespace
        sentences = [s.strip() for s in parts if s and s.strip()]

        # If we got too few sentences, fall back to simple newline split
        if len(sentences) <= 1 and "\n" in text:
            sentences = [s.strip() for s in text.split("\n") if s.strip()]

        return sentences

    async def _find_breakpoints(self, sentences: list[str]) -> list[int]:
        """Find semantic breakpoints using embedding similarity.

        Args:
            sentences: List of sentences to analyze.

        Returns:
            List of indices where breaks should occur (inclusive start of new chunk).
        """
        if len(sentences) <= 1:
            return [0, len(sentences)]

        # Filter out placeholder sentences for embedding
        embeddable_sentences = []
        sentence_indices = []
        for i, s in enumerate(sentences):
            if not s.startswith("__CODE_BLOCK_"):
                embeddable_sentences.append(s)
                sentence_indices.append(i)

        if len(embeddable_sentences) <= 1:
            # Not enough real sentences to analyze
            return [0, len(sentences)]

        # Get embeddings for all sentences
        embeddings = await self.embedder.embed_batch(embeddable_sentences, is_query=False)
        embeddings_array = np.array(embeddings)

        # Compute cosine similarity between consecutive sentences
        breakpoints = [0]

        prev_embedding_idx = 0
        for i in range(1, len(embeddable_sentences)):
            # Compute cosine similarity
            sim = self._cosine_similarity(embeddings_array[prev_embedding_idx], embeddings_array[i])

            if sim < self.config.similarity_threshold:
                # Similarity dropped - this is a breakpoint
                original_idx = sentence_indices[i]
                breakpoints.append(original_idx)

            prev_embedding_idx = i

        breakpoints.append(len(sentences))
        return breakpoints

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two vectors.

        Args:
            a: First vector.
            b: Second vector.

        Returns:
            Cosine similarity in range [-1, 1].
        """
        dot = np.dot(a, b)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(dot / (norm_a * norm_b))

    def _create_chunks_from_breakpoints(
        self, sentences: list[str], breakpoints: list[int]
    ) -> list[str]:
        """Create chunk strings from sentences and breakpoints.

        Args:
            sentences: All sentences.
            breakpoints: Indices where chunks start (including 0 and len(sentences)).

        Returns:
            List of chunk strings.
        """
        chunks = []
        for i in range(len(breakpoints) - 1):
            start = breakpoints[i]
            end = breakpoints[i + 1]
            chunk_sentences = sentences[start:end]
            chunk_text = " ".join(chunk_sentences)
            if chunk_text.strip():
                chunks.append(chunk_text.strip())
        return chunks

    def _balance_chunk_sizes(self, chunks: list[str]) -> list[str]:
        """Merge small chunks and split oversized ones.

        Args:
            chunks: Initial chunk list.

        Returns:
            Balanced chunk list.
        """
        if not chunks:
            return []

        # First pass: merge small chunks
        merged = []
        current = ""

        for chunk in chunks:
            if not current:
                current = chunk
            elif len(current) + len(chunk) + 1 < self.config.min_chunk_chars:
                # Merge with current
                current = f"{current} {chunk}"
            elif len(current) < self.config.min_chunk_chars:
                # Current is small, merge if combined isn't too big
                if len(current) + len(chunk) + 1 <= self.config.max_chunk_chars:
                    current = f"{current} {chunk}"
                else:
                    merged.append(current)
                    current = chunk
            else:
                merged.append(current)
                current = chunk

        if current:
            merged.append(current)

        # Second pass: split oversized chunks
        final = []
        for chunk in merged:
            if len(chunk) <= self.config.max_chunk_chars:
                final.append(chunk)
            else:
                # Force split at sentence boundaries
                split_chunks = self._force_split_chunk(chunk)
                final.extend(split_chunks)

        return final

    def _force_split_chunk(self, chunk: str) -> list[str]:
        """Force split an oversized chunk at sentence boundaries.

        Args:
            chunk: Oversized chunk text.

        Returns:
            List of smaller chunks.
        """
        sentences = self._split_sentences(chunk)
        result = []
        current = ""

        for sentence in sentences:
            if not current:
                current = sentence
            elif len(current) + len(sentence) + 1 <= self.config.max_chunk_chars:
                current = f"{current} {sentence}"
            else:
                if current:
                    result.append(current)
                current = sentence

        if current:
            result.append(current)

        return result if result else [chunk]

    def _finalize_chunks(self, chunk_texts: list[str], start_offset: int) -> list[Chunk]:
        """Create Chunk objects from text strings.

        Args:
            chunk_texts: List of chunk text strings.
            start_offset: Starting character offset.

        Returns:
            List of Chunk objects.
        """
        chunks = []
        current_offset = start_offset

        for i, text in enumerate(chunk_texts):
            chunk = Chunk(
                text=text,
                index=i,
                start_char=current_offset,
                end_char=current_offset + len(text),
                is_code="```" in text,
                sentence_count=len(self._split_sentences(text)),
            )
            chunks.append(chunk)
            current_offset += len(text) + 1  # +1 for space between chunks

        return chunks

    async def should_chunk(self, text: str) -> bool:
        """Check if text exceeds chunking threshold.

        Args:
            text: Text to check.

        Returns:
            True if text should be chunked.
        """
        return len(text) > self.config.max_chunk_chars
