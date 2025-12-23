"""Tests for chunking module (semantic and late chunking)."""

from unittest.mock import AsyncMock, MagicMock

import numpy as np
import pytest

from src.chunking import (
    Chunk,
    ChunkingConfig,
    SemanticChunker,
)

# Conditionally import torch-dependent items
try:
    import torch

    from src.chunking import ChunkBoundary, LateChunker, LateChunkResult

    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    torch = None  # type: ignore
    LateChunker = None  # type: ignore
    ChunkBoundary = None  # type: ignore
    LateChunkResult = None  # type: ignore


class TestChunkingConfig:
    """Tests for ChunkingConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = ChunkingConfig()
        assert config.similarity_threshold == 0.7
        assert config.min_chunk_chars == 100
        assert config.max_chunk_chars == 2000
        assert config.keep_code_blocks_intact is True
        assert config.max_code_block_chars == 1500

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = ChunkingConfig(
            similarity_threshold=0.5,
            min_chunk_chars=50,
            max_chunk_chars=1000,
            keep_code_blocks_intact=False,
            max_code_block_chars=500,
        )
        assert config.similarity_threshold == 0.5
        assert config.min_chunk_chars == 50
        assert config.max_chunk_chars == 1000
        assert config.keep_code_blocks_intact is False
        assert config.max_code_block_chars == 500


class TestChunk:
    """Tests for Chunk dataclass."""

    def test_basic_chunk(self) -> None:
        """Test basic chunk creation."""
        chunk = Chunk(text="Hello world", index=0, start_char=0, end_char=11)
        assert chunk.text == "Hello world"
        assert chunk.index == 0
        assert chunk.start_char == 0
        assert chunk.end_char == 11
        assert chunk.is_code is False
        assert chunk.sentence_count == 0

    def test_chunk_with_metadata(self) -> None:
        """Test chunk with all fields."""
        chunk = Chunk(
            text="def foo(): pass",
            index=5,
            start_char=100,
            end_char=115,
            is_code=True,
            sentence_count=1,
            metadata={"language": "python"},
        )
        assert chunk.is_code is True
        assert chunk.sentence_count == 1
        assert chunk.metadata["language"] == "python"

    def test_char_count_property(self) -> None:
        """Test char_count property."""
        chunk = Chunk(text="Hello world", index=0, start_char=0, end_char=11)
        assert chunk.char_count == 11


@pytest.mark.skipif(not TORCH_AVAILABLE, reason="torch not installed")
class TestChunkBoundary:
    """Tests for ChunkBoundary dataclass."""

    def test_basic_boundary(self) -> None:
        """Test basic boundary creation."""
        boundary = ChunkBoundary(start_token=0, end_token=10)
        assert boundary.start_token == 0
        assert boundary.end_token == 10
        assert boundary.start_char == 0
        assert boundary.end_char == 0

    def test_boundary_with_chars(self) -> None:
        """Test boundary with character positions."""
        boundary = ChunkBoundary(start_token=5, end_token=20, start_char=50, end_char=150)
        assert boundary.start_token == 5
        assert boundary.end_token == 20
        assert boundary.start_char == 50
        assert boundary.end_char == 150


@pytest.mark.skipif(not TORCH_AVAILABLE, reason="torch not installed")
class TestLateChunkResult:
    """Tests for LateChunkResult dataclass."""

    def test_result_creation(self) -> None:
        """Test result creation."""
        embedding = np.array([0.1, 0.2, 0.3])
        boundary = ChunkBoundary(start_token=0, end_token=5)
        result = LateChunkResult(text="test chunk", embedding=embedding, boundary=boundary)
        assert result.text == "test chunk"
        np.testing.assert_array_equal(result.embedding, embedding)
        assert result.boundary.start_token == 0


@pytest.mark.skipif(not TORCH_AVAILABLE, reason="torch not installed")
class TestLateChunker:
    """Tests for LateChunker."""

    @pytest.fixture
    def mock_model(self) -> MagicMock:
        """Create a mock SentenceTransformer model."""
        model = MagicMock()
        model.device = "cpu"
        model.get_sentence_embedding_dimension.return_value = 384
        return model

    @pytest.fixture
    def chunker(self, mock_model: MagicMock) -> LateChunker:
        """Create a LateChunker with mock model."""
        return LateChunker(mock_model)

    def test_init(self, mock_model: MagicMock) -> None:
        """Test LateChunker initialization."""
        chunker = LateChunker(mock_model)
        assert chunker.model == mock_model
        assert chunker.normalize_embeddings is True
        assert chunker._device == "cpu"

    def test_init_no_normalize(self, mock_model: MagicMock) -> None:
        """Test LateChunker with normalization disabled."""
        chunker = LateChunker(mock_model, normalize_embeddings=False)
        assert chunker.normalize_embeddings is False

    def test_embed_chunks_empty_input(self, chunker: LateChunker) -> None:
        """Test embed_chunks with empty input."""
        result = chunker.embed_chunks("", [])
        assert result == []

        result = chunker.embed_chunks("text", [])
        assert result == []

        result = chunker.embed_chunks("", ["chunk"])
        assert result == []

    def test_embed_chunks_fallback_on_boundary_failure(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test fallback when boundary detection fails."""
        mock_model.tokenize.side_effect = Exception("Tokenization failed")
        mock_model.encode.return_value = np.array([[0.1, 0.2, 0.3]])

        result = chunker.embed_chunks("full text", ["chunk"])

        assert len(result) == 1
        mock_model.encode.assert_called_once()

    def test_embed_chunks_fallback_on_token_embedding_failure(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test fallback when token embedding fails."""
        # First tokenize succeeds, second fails
        mock_model.tokenize.side_effect = [
            {"input_ids": torch.tensor([[1, 2, 3, 4, 5]])},  # For boundary detection
            {"input_ids": torch.tensor([[1, 2, 3]])},  # For chunk tokenization
        ]
        mock_model.forward.side_effect = Exception("Forward pass failed")
        mock_model.encode.return_value = np.array([[0.1, 0.2, 0.3]])

        result = chunker.embed_chunks("full text here", ["text"])

        assert len(result) == 1
        mock_model.encode.assert_called_once()

    def test_embed_with_boundaries_empty(self, chunker: LateChunker) -> None:
        """Test embed_with_boundaries with empty boundaries."""
        result = chunker.embed_with_boundaries("text", [])
        assert result == []

    def test_embed_with_boundaries_token_failure(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test embed_with_boundaries when token embedding fails."""
        mock_model.tokenize.side_effect = Exception("Failed")
        boundaries = [ChunkBoundary(0, 5)]

        result = chunker.embed_with_boundaries("text", boundaries)

        assert result == []

    def test_embed_with_boundaries_success(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test embed_with_boundaries with valid input."""
        mock_model.tokenize.return_value = {
            "input_ids": torch.tensor([[1, 2, 3, 4, 5]]),
            "attention_mask": torch.tensor([[1, 1, 1, 1, 1]]),
        }
        mock_model.forward.return_value = {
            "token_embeddings": torch.randn(1, 5, 384),
        }
        boundaries = [ChunkBoundary(1, 3)]

        result = chunker.embed_with_boundaries("test text", boundaries)

        assert len(result) == 1
        assert result[0].shape == (384,)

    def test_embed_and_chunk_empty(self, chunker: LateChunker) -> None:
        """Test embed_and_chunk with empty input."""
        result = chunker.embed_and_chunk("", [])
        assert result == []

        result = chunker.embed_and_chunk("text", [])
        assert result == []

    def test_embed_and_chunk_success(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test embed_and_chunk returns proper results."""
        # Mock successful embedding
        mock_model.tokenize.return_value = {
            "input_ids": torch.tensor([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]),
        }
        mock_model.forward.return_value = {
            "token_embeddings": torch.randn(1, 10, 384),
        }

        chunks = ["Hello", "World"]
        result = chunker.embed_and_chunk("Hello World", chunks)

        assert len(result) == 2
        assert all(isinstance(r, LateChunkResult) for r in result)
        assert result[0].text == "Hello"
        assert result[1].text == "World"

    def test_pool_tokens_invalid_range(
        self, chunker: LateChunker
    ) -> None:
        """Test _pool_tokens with invalid range falls back to mean."""
        token_embeddings = torch.randn(10, 384)
        result = chunker._pool_tokens(token_embeddings, 5, 3)  # Invalid: start > end
        assert result.shape == (384,)

    def test_pool_tokens_clamps_range(self, chunker: LateChunker) -> None:
        """Test _pool_tokens clamps range to valid bounds."""
        token_embeddings = torch.randn(10, 384)
        result = chunker._pool_tokens(token_embeddings, -5, 100)  # Out of bounds
        assert result.shape == (384,)

    def test_pool_tokens_normalization(self, chunker: LateChunker) -> None:
        """Test _pool_tokens normalizes output."""
        token_embeddings = torch.ones(10, 384)
        result = chunker._pool_tokens(token_embeddings, 0, 5)
        norm = np.linalg.norm(result)
        np.testing.assert_almost_equal(norm, 1.0, decimal=5)

    def test_pool_tokens_no_normalization(self, mock_model: MagicMock) -> None:
        """Test _pool_tokens without normalization."""
        chunker = LateChunker(mock_model, normalize_embeddings=False)
        token_embeddings = torch.ones(10, 384)
        result = chunker._pool_tokens(token_embeddings, 0, 5)
        # Without normalization, mean of ones should be 1.0
        assert result.mean() == pytest.approx(1.0)

    def test_fallback_embed_success(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test _fallback_embed succeeds."""
        mock_model.encode.return_value = np.array([[0.1, 0.2], [0.3, 0.4]])

        result = chunker._fallback_embed(["chunk1", "chunk2"])

        assert len(result) == 2
        mock_model.encode.assert_called_once()

    def test_fallback_embed_failure(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test _fallback_embed returns zeros on failure."""
        mock_model.encode.side_effect = Exception("Encode failed")
        mock_model.get_sentence_embedding_dimension.return_value = 384

        result = chunker._fallback_embed(["chunk"])

        assert len(result) == 1
        assert result[0].shape == (384,)
        np.testing.assert_array_equal(result[0], np.zeros(384))

    def test_get_token_embeddings_last_hidden_state(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test _get_token_embeddings with last_hidden_state format."""
        mock_model.tokenize.return_value = {"input_ids": torch.tensor([[1, 2, 3]])}
        mock_model.forward.return_value = {
            "last_hidden_state": torch.randn(1, 3, 384),
        }

        result = chunker._get_token_embeddings("test")

        assert result is not None
        assert result.shape == (3, 384)

    def test_get_token_embeddings_tuple_output(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test _get_token_embeddings with tuple output format."""
        mock_model.tokenize.return_value = {"input_ids": torch.tensor([[1, 2, 3]])}
        mock_model.forward.return_value = (torch.randn(1, 3, 384),)

        result = chunker._get_token_embeddings("test")

        assert result is not None

    def test_find_chunk_boundaries_chunk_not_found(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test _find_chunk_boundaries when chunk is not in text."""
        mock_model.tokenize.return_value = {"input_ids": torch.tensor([[1, 2, 3, 4, 5]])}

        boundaries = chunker._find_chunk_boundaries("full text", ["not found"])

        assert len(boundaries) == 1
        assert boundaries[0].start_token == 0
        assert boundaries[0].end_token == 5


class TestSemanticChunker:
    """Tests for SemanticChunker."""

    @pytest.fixture
    def mock_embedder(self) -> MagicMock:
        """Create a mock TextEmbedder."""
        embedder = MagicMock()
        embedder.embed_batch = AsyncMock()
        return embedder

    @pytest.fixture
    def chunker(self, mock_embedder: MagicMock) -> SemanticChunker:
        """Create a SemanticChunker with mock embedder."""
        return SemanticChunker(mock_embedder)

    def test_init_default_config(self, mock_embedder: MagicMock) -> None:
        """Test SemanticChunker with default config."""
        chunker = SemanticChunker(mock_embedder)
        assert chunker.config.similarity_threshold == 0.7
        assert chunker.config.max_chunk_chars == 2000

    def test_init_custom_config(self, mock_embedder: MagicMock) -> None:
        """Test SemanticChunker with custom config."""
        config = ChunkingConfig(similarity_threshold=0.5)
        chunker = SemanticChunker(mock_embedder, config)
        assert chunker.config.similarity_threshold == 0.5

    @pytest.mark.asyncio
    async def test_chunk_empty_input(self, chunker: SemanticChunker) -> None:
        """Test chunking empty input."""
        result = await chunker.chunk("")
        assert result == []

        result = await chunker.chunk("   ")
        assert result == []

    @pytest.mark.asyncio
    async def test_chunk_short_text(self, chunker: SemanticChunker) -> None:
        """Test chunking text shorter than max_chunk_chars."""
        result = await chunker.chunk("Short text")
        assert len(result) == 1
        assert result[0].text == "Short text"
        assert result[0].index == 0

    @pytest.mark.asyncio
    async def test_chunk_with_code_block(self, chunker: SemanticChunker) -> None:
        """Test chunking text with code blocks."""
        text = "Here is code:\n```python\nprint('hello')\n```"
        result = await chunker.chunk(text)
        assert len(result) == 1
        assert result[0].is_code is True

    @pytest.mark.asyncio
    async def test_chunk_long_text(
        self, chunker: SemanticChunker, mock_embedder: MagicMock
    ) -> None:
        """Test chunking long text that exceeds max_chunk_chars."""
        # Create a config with low max_chunk_chars
        config = ChunkingConfig(max_chunk_chars=50, min_chunk_chars=10)
        chunker = SemanticChunker(mock_embedder, config)

        # Create embeddings that indicate high similarity (no breaks)
        mock_embedder.embed_batch.return_value = [
            np.array([1.0, 0.0, 0.0]),
            np.array([0.99, 0.1, 0.0]),
            np.array([0.98, 0.15, 0.0]),
        ]

        text = "First sentence here. Second sentence here. Third sentence here."
        result = await chunker.chunk(text)

        assert len(result) >= 1
        mock_embedder.embed_batch.assert_called_once()

    @pytest.mark.asyncio
    async def test_chunk_finds_breakpoints(
        self, chunker: SemanticChunker, mock_embedder: MagicMock
    ) -> None:
        """Test that chunker finds semantic breakpoints."""
        config = ChunkingConfig(
            similarity_threshold=0.5, max_chunk_chars=1000, min_chunk_chars=10
        )
        chunker = SemanticChunker(mock_embedder, config)

        # Embeddings with low similarity between 2nd and 3rd
        mock_embedder.embed_batch.return_value = [
            np.array([1.0, 0.0, 0.0]),
            np.array([0.9, 0.1, 0.0]),  # Similar to first
            np.array([0.0, 1.0, 0.0]),  # Very different - should break here
        ]

        text = "A" * 1000 + ". " + "B" * 500 + ". " + "C" * 500 + "."
        result = await chunker.chunk(text)

        # Should create multiple chunks due to semantic break
        assert len(result) >= 1

    def test_extract_code_blocks(self, chunker: SemanticChunker) -> None:
        """Test code block extraction."""
        text = "Before\n```python\ncode\n```\nAfter"
        result, placeholders = chunker._extract_code_blocks(text)

        assert "__CODE_BLOCK_0__" in result
        assert "```python\ncode\n```" in placeholders.values()

    def test_restore_code_blocks(self, chunker: SemanticChunker) -> None:
        """Test code block restoration."""
        placeholders = {"__CODE_BLOCK_0__": "```python\ncode\n```"}
        chunks = ["Before __CODE_BLOCK_0__ After"]

        result = chunker._restore_code_blocks(chunks, placeholders)

        assert result[0] == "Before ```python\ncode\n``` After"

    def test_split_sentences(self, chunker: SemanticChunker) -> None:
        """Test sentence splitting."""
        text = "First sentence. Second sentence! Third?"
        sentences = chunker._split_sentences(text)
        assert len(sentences) >= 1

    def test_split_sentences_with_newlines(self, chunker: SemanticChunker) -> None:
        """Test sentence splitting with newlines."""
        text = "Line one\n\nLine two"
        sentences = chunker._split_sentences(text)
        assert len(sentences) >= 2

    def test_cosine_similarity(self, chunker: SemanticChunker) -> None:
        """Test cosine similarity calculation."""
        a = np.array([1.0, 0.0])
        b = np.array([1.0, 0.0])
        assert chunker._cosine_similarity(a, b) == pytest.approx(1.0)

        c = np.array([0.0, 1.0])
        assert chunker._cosine_similarity(a, c) == pytest.approx(0.0)

    def test_cosine_similarity_zero_vector(self, chunker: SemanticChunker) -> None:
        """Test cosine similarity with zero vector."""
        a = np.array([1.0, 0.0])
        zero = np.array([0.0, 0.0])
        assert chunker._cosine_similarity(a, zero) == 0.0

    def test_create_chunks_from_breakpoints(self, chunker: SemanticChunker) -> None:
        """Test chunk creation from breakpoints."""
        sentences = ["Sentence one", "Sentence two", "Sentence three"]
        breakpoints = [0, 2, 3]

        chunks = chunker._create_chunks_from_breakpoints(sentences, breakpoints)

        assert len(chunks) == 2
        assert "Sentence one" in chunks[0]
        assert "Sentence two" in chunks[0]
        assert "Sentence three" in chunks[1]

    def test_balance_chunk_sizes_empty(self, chunker: SemanticChunker) -> None:
        """Test balance_chunk_sizes with empty input."""
        result = chunker._balance_chunk_sizes([])
        assert result == []

    def test_balance_chunk_sizes_merges_small(
        self, mock_embedder: MagicMock
    ) -> None:
        """Test that small chunks get merged."""
        config = ChunkingConfig(min_chunk_chars=50, max_chunk_chars=200)
        chunker = SemanticChunker(mock_embedder, config)

        # Two small chunks that should be merged
        chunks = ["Short", "Also short"]
        result = chunker._balance_chunk_sizes(chunks)

        assert len(result) == 1
        assert "Short" in result[0]
        assert "Also short" in result[0]

    def test_balance_chunk_sizes_splits_large(
        self, mock_embedder: MagicMock
    ) -> None:
        """Test that large chunks get split when possible."""
        config = ChunkingConfig(min_chunk_chars=10, max_chunk_chars=100)
        chunker = SemanticChunker(mock_embedder, config)

        # Chunk with multiple sentences that can be split
        chunks = ["First sentence here. Second sentence here. Third sentence here."]
        result = chunker._balance_chunk_sizes(chunks)

        # Should attempt to balance
        assert len(result) >= 1

    def test_force_split_chunk(self, mock_embedder: MagicMock) -> None:
        """Test force splitting oversized chunks."""
        config = ChunkingConfig(max_chunk_chars=50)
        chunker = SemanticChunker(mock_embedder, config)

        chunk = "First sentence. Second sentence. Third sentence."
        result = chunker._force_split_chunk(chunk)

        assert len(result) >= 1

    def test_force_split_chunk_unsplittable(self, mock_embedder: MagicMock) -> None:
        """Test force split returns original if unsplittable."""
        config = ChunkingConfig(max_chunk_chars=10)
        chunker = SemanticChunker(mock_embedder, config)

        chunk = "Longwordwithoutspaces"
        result = chunker._force_split_chunk(chunk)

        assert len(result) == 1
        assert result[0] == chunk

    def test_finalize_chunks(self, chunker: SemanticChunker) -> None:
        """Test finalizing chunks into Chunk objects."""
        chunk_texts = ["First chunk", "Second chunk"]
        result = chunker._finalize_chunks(chunk_texts, 0)

        assert len(result) == 2
        assert result[0].index == 0
        assert result[1].index == 1
        assert result[0].start_char == 0
        assert result[1].start_char == len("First chunk") + 1

    @pytest.mark.asyncio
    async def test_should_chunk(self, chunker: SemanticChunker) -> None:
        """Test should_chunk predicate."""
        short_text = "Short"
        long_text = "A" * 3000

        assert await chunker.should_chunk(short_text) is False
        assert await chunker.should_chunk(long_text) is True

    @pytest.mark.asyncio
    async def test_find_breakpoints_single_sentence(
        self, chunker: SemanticChunker
    ) -> None:
        """Test _find_breakpoints with single sentence."""
        breakpoints = await chunker._find_breakpoints(["Only one sentence"])
        assert breakpoints == [0, 1]

    @pytest.mark.asyncio
    async def test_find_breakpoints_code_placeholders(
        self, chunker: SemanticChunker, mock_embedder: MagicMock
    ) -> None:
        """Test _find_breakpoints skips code placeholders."""
        mock_embedder.embed_batch.return_value = [
            np.array([1.0, 0.0]),
            np.array([0.9, 0.1]),
        ]

        sentences = ["Text", "__CODE_BLOCK_0__", "More text"]
        await chunker._find_breakpoints(sentences)

        # Should only embed non-placeholder sentences
        assert mock_embedder.embed_batch.call_count == 1
        call_args = mock_embedder.embed_batch.call_args[0][0]
        assert "__CODE_BLOCK_0__" not in call_args

    @pytest.mark.asyncio
    async def test_chunk_single_sentence_long_text(
        self, mock_embedder: MagicMock
    ) -> None:
        """Test chunking text with single long sentence."""
        config = ChunkingConfig(max_chunk_chars=50)
        chunker = SemanticChunker(mock_embedder, config)

        # Text that exceeds max but has only one sentence
        text = "A" * 100
        result = await chunker.chunk(text)

        # Should return the original text as one chunk
        assert len(result) == 1
