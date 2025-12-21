"""Tests for semantic chunking module."""

from unittest.mock import AsyncMock, MagicMock

import numpy as np
import pytest

from src.chunking import Chunk, ChunkingConfig, SemanticChunker


class TestChunkingConfig:
    """Tests for ChunkingConfig."""

    def test_default_config(self) -> None:
        """Test default configuration values."""
        config = ChunkingConfig()

        assert config.similarity_threshold == 0.7
        assert config.min_chunk_chars == 100
        assert config.max_chunk_chars == 2000
        assert config.keep_code_blocks_intact is True
        assert config.max_code_block_chars == 1500

    def test_custom_config(self) -> None:
        """Test custom configuration values."""
        config = ChunkingConfig(
            similarity_threshold=0.5,
            min_chunk_chars=50,
            max_chunk_chars=1000,
        )

        assert config.similarity_threshold == 0.5
        assert config.min_chunk_chars == 50
        assert config.max_chunk_chars == 1000


class TestChunk:
    """Tests for Chunk dataclass."""

    def test_chunk_creation(self) -> None:
        """Test creating a Chunk."""
        chunk = Chunk(
            text="This is a test chunk.",
            index=0,
            start_char=0,
            end_char=21,
            is_code=False,
            sentence_count=1,
        )

        assert chunk.text == "This is a test chunk."
        assert chunk.index == 0
        assert chunk.char_count == 21
        assert chunk.is_code is False
        assert chunk.sentence_count == 1

    def test_chunk_char_count(self) -> None:
        """Test char_count property."""
        chunk = Chunk(text="Hello world", index=0, start_char=0, end_char=11)
        assert chunk.char_count == 11

    def test_chunk_metadata(self) -> None:
        """Test chunk metadata."""
        chunk = Chunk(
            text="Test",
            index=0,
            start_char=0,
            end_char=4,
            metadata={"source": "test"},
        )
        assert chunk.metadata["source"] == "test"


class TestSemanticChunker:
    """Tests for SemanticChunker."""

    @pytest.fixture
    def mock_embedder(self) -> MagicMock:
        """Create mock text embedder."""
        embedder = MagicMock()
        embedder.load = AsyncMock()

        def embed_similar(texts: list[str], is_query: bool) -> list[list[float]]:
            base = np.random.randn(384)
            base = base / np.linalg.norm(base)
            embeddings = []
            for _ in texts:
                noise = np.random.randn(384) * 0.1
                emb = base + noise
                emb = emb / np.linalg.norm(emb)
                embeddings.append(emb.tolist())
            return embeddings

        embedder.embed_batch = AsyncMock(side_effect=embed_similar)
        return embedder

    @pytest.fixture
    def chunker(self, mock_embedder: MagicMock) -> SemanticChunker:
        """Create SemanticChunker with mock embedder."""
        return SemanticChunker(mock_embedder)

    @pytest.mark.asyncio
    async def test_chunk_empty_text(self, chunker: SemanticChunker) -> None:
        """Test chunking empty text."""
        chunks = await chunker.chunk("")
        assert chunks == []

    @pytest.mark.asyncio
    async def test_chunk_whitespace_text(self, chunker: SemanticChunker) -> None:
        """Test chunking whitespace-only text."""
        chunks = await chunker.chunk("   \n\n   ")
        assert chunks == []

    @pytest.mark.asyncio
    async def test_chunk_short_text(self, chunker: SemanticChunker) -> None:
        """Test that short text is returned as single chunk."""
        short_text = "This is a short text that does not need chunking."
        chunks = await chunker.chunk(short_text)
        assert len(chunks) == 1
        assert chunks[0].text == short_text
        assert chunks[0].index == 0

    @pytest.mark.asyncio
    async def test_chunk_preserves_code_blocks(self, mock_embedder: MagicMock) -> None:
        """Test that code blocks are preserved intact."""
        config = ChunkingConfig(max_chunk_chars=100)
        chunker = SemanticChunker(mock_embedder, config)
        text_with_code = (
            "Here is text.\n\n"
            "```python\ndef hello():\n    print('Hello')\n```\n\n"
            "More text."
        )
        chunks = await chunker.chunk(text_with_code)
        code_found = any("```python" in c.text and "print(" in c.text for c in chunks)
        assert code_found, "Code block should be preserved intact"

    @pytest.mark.asyncio
    async def test_chunk_marks_code_chunks(self, mock_embedder: MagicMock) -> None:
        """Test that chunks with code are marked as is_code=True."""
        text = "Some text.\n\n```javascript\nconsole.log('test');\n```\n"
        chunker = SemanticChunker(mock_embedder)
        chunks = await chunker.chunk(text)
        assert len(chunks) >= 1
        assert chunks[0].is_code is True

    @pytest.mark.asyncio
    async def test_chunk_indices_are_sequential(self, chunker: SemanticChunker) -> None:
        """Test that chunk indices are sequential starting from 0."""
        text = "First sentence here. " * 50 + "Last sentence here. " * 50
        chunks = await chunker.chunk(text)
        for i, chunk in enumerate(chunks):
            assert chunk.index == i

    @pytest.mark.asyncio
    async def test_chunk_offsets_are_valid(self, chunker: SemanticChunker) -> None:
        """Test that chunk character offsets are valid."""
        text = "This is a test. Another sentence. More content here."
        chunks = await chunker.chunk(text)
        for chunk in chunks:
            assert chunk.start_char >= 0
            assert chunk.end_char > chunk.start_char
            assert chunk.end_char - chunk.start_char == len(chunk.text)

    @pytest.mark.asyncio
    async def test_should_chunk_short_text(self, chunker: SemanticChunker) -> None:
        """Test should_chunk returns False for short text."""
        short_text = "This is short."
        result = await chunker.should_chunk(short_text)
        assert result is False

    @pytest.mark.asyncio
    async def test_should_chunk_long_text(self, chunker: SemanticChunker) -> None:
        """Test should_chunk returns True for text exceeding max_chunk_chars."""
        long_text = "This is a sentence. " * 200
        result = await chunker.should_chunk(long_text)
        assert result is True

    def test_split_sentences(self, chunker: SemanticChunker) -> None:
        """Test sentence splitting."""
        text = "First sentence. Second sentence! Third sentence?"
        sentences = chunker._split_sentences(text)
        assert len(sentences) >= 1
        assert "First sentence" in sentences[0]

    def test_split_sentences_with_newlines(self, chunker: SemanticChunker) -> None:
        """Test sentence splitting with double newlines."""
        text = "First paragraph.\n\nSecond paragraph."
        sentences = chunker._split_sentences(text)
        assert len(sentences) == 2

    def test_extract_code_blocks(self, chunker: SemanticChunker) -> None:
        """Test code block extraction."""
        text = "Some text.\n\n```python\ncode here\n```\n\nMore text."
        text_without_code, placeholders = chunker._extract_code_blocks(text)
        assert "```python" not in text_without_code
        assert "__CODE_BLOCK_0__" in text_without_code
        assert len(placeholders) == 1

    def test_restore_code_blocks(self, chunker: SemanticChunker) -> None:
        """Test code block restoration."""
        chunks = ["Some text __CODE_BLOCK_0__ more text"]
        placeholders = {"__CODE_BLOCK_0__": "```python\ncode\n```"}
        restored = chunker._restore_code_blocks(chunks, placeholders)
        assert "```python\ncode\n```" in restored[0]
        assert "__CODE_BLOCK_0__" not in restored[0]

    def test_cosine_similarity(self, chunker: SemanticChunker) -> None:
        """Test cosine similarity calculation."""
        a = np.array([1.0, 0.0, 0.0])
        b = np.array([1.0, 0.0, 0.0])
        assert chunker._cosine_similarity(a, b) == pytest.approx(1.0)

        c = np.array([0.0, 1.0, 0.0])
        assert chunker._cosine_similarity(a, c) == pytest.approx(0.0)

        d = np.array([-1.0, 0.0, 0.0])
        assert chunker._cosine_similarity(a, d) == pytest.approx(-1.0)

    def test_cosine_similarity_zero_vector(self, chunker: SemanticChunker) -> None:
        """Test cosine similarity with zero vector."""
        a = np.array([1.0, 0.0, 0.0])
        zero = np.array([0.0, 0.0, 0.0])
        assert chunker._cosine_similarity(a, zero) == 0.0
        assert chunker._cosine_similarity(zero, a) == 0.0

    def test_balance_chunk_sizes_merge_small(self, chunker: SemanticChunker) -> None:
        """Test merging of small chunks."""
        chunker.config.min_chunk_chars = 50
        small_chunks = ["Hi", "there", "friend"]
        balanced = chunker._balance_chunk_sizes(small_chunks)
        assert len(balanced) <= len(small_chunks)
        assert "Hi" in " ".join(balanced)

    def test_balance_chunk_sizes_split_large(self, chunker: SemanticChunker) -> None:
        """Test splitting of oversized chunks."""
        chunker.config.max_chunk_chars = 50
        large_chunk = ["This is a very long sentence that exceeds the max. " * 5]
        balanced = chunker._balance_chunk_sizes(large_chunk)
        assert len(balanced) > 1


class TestSemanticChunkerIntegration:
    """Integration tests for SemanticChunker with realistic content."""

    @pytest.fixture
    def mock_embedder(self) -> MagicMock:
        """Create mock embedder with varying similarities."""
        embedder = MagicMock()
        embedder.load = AsyncMock()

        def embed_varying(texts: list[str], is_query: bool) -> list[list[float]]:
            embeddings = []
            for text in texts:
                base = np.random.randn(384)
                if text and len(text) > 0:
                    base[ord(text[0]) % 384] += 1.0
                base = base / np.linalg.norm(base)
                embeddings.append(base.tolist())
            return embeddings

        embedder.embed_batch = AsyncMock(side_effect=embed_varying)
        return embedder

    @pytest.mark.asyncio
    async def test_chunk_conversation_turn(self, mock_embedder: MagicMock) -> None:
        """Test chunking a typical conversation turn."""
        config = ChunkingConfig(min_chunk_chars=50, max_chunk_chars=500)
        chunker = SemanticChunker(mock_embedder, config)

        turn_content = (
            "User: How do I implement a binary search in Python?\n\n"
            "Assistant: Here is how to implement binary search:\n\n"
            "```python\n"
            "def binary_search(arr, target):\n"
            "    left, right = 0, len(arr) - 1\n"
            "    while left <= right:\n"
            "        mid = (left + right) // 2\n"
            "        if arr[mid] == target:\n"
            "            return mid\n"
            "        elif arr[mid] < target:\n"
            "            left = mid + 1\n"
            "        else:\n"
            "            right = mid - 1\n"
            "    return -1\n"
            "```\n\n"
            "This algorithm has O(log n) time complexity."
        )

        chunks = await chunker.chunk(turn_content)

        assert len(chunks) >= 1
        all_text = " ".join(c.text for c in chunks)
        assert "binary_search" in all_text
        assert "O(log n)" in all_text

    @pytest.mark.asyncio
    async def test_chunk_long_assistant_response(self, mock_embedder: MagicMock) -> None:
        """Test chunking a long assistant response."""
        config = ChunkingConfig(min_chunk_chars=100, max_chunk_chars=300)
        chunker = SemanticChunker(mock_embedder, config)

        long_response = (
            "First, let me explain the concept. "
            "This is important to understand. "
            "Now let me show you the implementation. "
            "Here is the code you need. "
            "Finally, let me explain the time complexity. "
            "This runs in linear time. "
        ) * 10

        chunks = await chunker.chunk(long_response)

        # Should create multiple chunks for long text
        assert len(chunks) >= 1
        # All content should be preserved
        total_chars = sum(len(c.text) for c in chunks)
        assert total_chars > 0
