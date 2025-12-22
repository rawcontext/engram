"""Tests for late chunking module."""

from unittest.mock import MagicMock

import numpy as np
import pytest
import torch

from src.chunking import ChunkBoundary, LateChunker, LateChunkResult


class TestChunkBoundary:
    """Tests for ChunkBoundary dataclass."""

    def test_boundary_creation(self) -> None:
        """Test creating a chunk boundary."""
        boundary = ChunkBoundary(
            start_token=10,
            end_token=20,
            start_char=50,
            end_char=100,
        )

        assert boundary.start_token == 10
        assert boundary.end_token == 20
        assert boundary.start_char == 50
        assert boundary.end_char == 100

    def test_boundary_defaults(self) -> None:
        """Test default values for chunk boundary."""
        boundary = ChunkBoundary(start_token=5, end_token=10)

        assert boundary.start_char == 0
        assert boundary.end_char == 0


class TestLateChunkResult:
    """Tests for LateChunkResult dataclass."""

    def test_result_creation(self) -> None:
        """Test creating a late chunk result."""
        embedding = np.array([0.1, 0.2, 0.3])
        boundary = ChunkBoundary(0, 10)

        result = LateChunkResult(
            text="Test chunk",
            embedding=embedding,
            boundary=boundary,
        )

        assert result.text == "Test chunk"
        np.testing.assert_array_equal(result.embedding, embedding)
        assert result.boundary.start_token == 0


class TestLateChunker:
    """Tests for LateChunker."""

    @pytest.fixture
    def mock_model(self) -> MagicMock:
        """Create mock SentenceTransformer model."""
        model = MagicMock()
        model.device = "cpu"
        model.get_sentence_embedding_dimension.return_value = 384

        # Mock tokenize
        model.tokenize.return_value = {
            "input_ids": torch.tensor([[101, 1, 2, 3, 4, 5, 102]]),
            "attention_mask": torch.tensor([[1, 1, 1, 1, 1, 1, 1]]),
        }

        # Mock forward
        token_embeddings = torch.randn(1, 7, 384)
        model.forward.return_value = {"token_embeddings": token_embeddings}

        # Mock encode for fallback
        model.encode.return_value = np.random.randn(2, 384)

        return model

    @pytest.fixture
    def chunker(self, mock_model: MagicMock) -> LateChunker:
        """Create LateChunker with mock model."""
        return LateChunker(mock_model)

    def test_embed_chunks_empty_input(self, chunker: LateChunker) -> None:
        """Test embedding with empty input."""
        result = chunker.embed_chunks("", [])
        assert result == []

    def test_embed_chunks_empty_chunks(self, chunker: LateChunker) -> None:
        """Test embedding with empty chunk list."""
        result = chunker.embed_chunks("Some text", [])
        assert result == []

    def test_embed_chunks_single_chunk(self, chunker: LateChunker, mock_model: MagicMock) -> None:
        """Test embedding a single chunk."""
        full_text = "The quick brown fox"
        chunks = ["The quick brown fox"]

        result = chunker.embed_chunks(full_text, chunks)

        assert len(result) == 1
        assert result[0].shape == (384,)

    def test_embed_chunks_multiple_chunks(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test embedding multiple chunks."""
        full_text = "The quick brown fox. It was very fast."
        chunks = ["The quick brown fox.", "It was very fast."]

        # Need to setup different token counts per chunk
        mock_model.tokenize.side_effect = [
            {"input_ids": torch.tensor([[101, 1, 2, 3, 4, 5, 6, 7, 8, 102]])},
            {"input_ids": torch.tensor([[101, 1, 2, 3, 102]])},
            {"input_ids": torch.tensor([[101, 1, 2, 3, 4, 102]])},
        ]

        result = chunker.embed_chunks(full_text, chunks)

        assert len(result) == 2
        for emb in result:
            assert emb.shape == (384,)

    def test_embed_with_boundaries(self, chunker: LateChunker, mock_model: MagicMock) -> None:
        """Test embedding with pre-computed boundaries."""
        boundaries = [
            ChunkBoundary(start_token=1, end_token=3),
            ChunkBoundary(start_token=3, end_token=6),
        ]

        result = chunker.embed_with_boundaries("Test text", boundaries)

        assert len(result) == 2
        for emb in result:
            assert emb.shape == (384,)

    def test_embed_with_boundaries_empty(self, chunker: LateChunker) -> None:
        """Test embedding with empty boundaries."""
        result = chunker.embed_with_boundaries("Test text", [])
        assert result == []

    def test_embed_and_chunk(self, chunker: LateChunker, mock_model: MagicMock) -> None:
        """Test embed_and_chunk returns full results."""
        full_text = "Hello world"
        chunks = ["Hello world"]

        result = chunker.embed_and_chunk(full_text, chunks)

        assert len(result) == 1
        assert isinstance(result[0], LateChunkResult)
        assert result[0].text == "Hello world"
        assert result[0].embedding.shape == (384,)

    def test_embed_and_chunk_empty(self, chunker: LateChunker) -> None:
        """Test embed_and_chunk with empty input."""
        result = chunker.embed_and_chunk("", [])
        assert result == []

    def test_pool_tokens_valid_range(self, chunker: LateChunker) -> None:
        """Test pooling tokens within valid range."""
        token_embeddings = torch.randn(10, 384)

        result = chunker._pool_tokens(token_embeddings, 2, 5)

        assert result.shape == (384,)

    def test_pool_tokens_invalid_range(self, chunker: LateChunker) -> None:
        """Test pooling tokens with invalid range uses fallback."""
        token_embeddings = torch.randn(10, 384)

        # start >= end should use mean of all tokens
        result = chunker._pool_tokens(token_embeddings, 5, 2)

        assert result.shape == (384,)

    def test_pool_tokens_out_of_bounds(self, chunker: LateChunker) -> None:
        """Test pooling tokens with out of bounds indices."""
        token_embeddings = torch.randn(10, 384)

        # Should clamp to valid range
        result = chunker._pool_tokens(token_embeddings, -5, 15)

        assert result.shape == (384,)

    def test_normalize_embeddings(self, mock_model: MagicMock) -> None:
        """Test that embeddings are normalized by default."""
        chunker = LateChunker(mock_model, normalize_embeddings=True)
        token_embeddings = torch.randn(10, 384)

        result = chunker._pool_tokens(token_embeddings, 0, 5)

        # Check normalization (L2 norm should be 1)
        norm = np.linalg.norm(result)
        np.testing.assert_almost_equal(norm, 1.0, decimal=5)

    def test_no_normalize_embeddings(self, mock_model: MagicMock) -> None:
        """Test disabling embedding normalization."""
        chunker = LateChunker(mock_model, normalize_embeddings=False)
        token_embeddings = torch.randn(10, 384)

        result = chunker._pool_tokens(token_embeddings, 0, 5)

        # Verify the result shape matches expected dimensions
        assert result.shape == (384,)

    def test_fallback_embed(self, chunker: LateChunker) -> None:
        """Test fallback embedding when late chunking fails."""
        chunks = ["Hello", "World"]

        result = chunker._fallback_embed(chunks)

        assert len(result) == 2
        for emb in result:
            assert emb.shape == (384,)

    def test_find_chunk_boundaries(self, chunker: LateChunker, mock_model: MagicMock) -> None:
        """Test finding chunk boundaries in text."""
        full_text = "Hello world. Goodbye world."
        chunks = ["Hello world.", "Goodbye world."]

        # Mock tokenize for each call
        mock_model.tokenize.side_effect = [
            {"input_ids": torch.tensor([[101, 1, 2, 3, 4, 5, 6, 102]])},
            {"input_ids": torch.tensor([[101, 1, 2, 102]])},
            {"input_ids": torch.tensor([[101, 1, 2, 102]])},
        ]

        boundaries = chunker._find_chunk_boundaries(full_text, chunks)

        assert len(boundaries) == 2
        assert boundaries[0].start_char == 0
        assert boundaries[0].end_char == 12  # "Hello world."

    def test_chunk_not_found_uses_full_range(
        self, chunker: LateChunker, mock_model: MagicMock
    ) -> None:
        """Test that missing chunks use full token range."""
        full_text = "Hello world"
        chunks = ["Not in text"]

        mock_model.tokenize.return_value = {"input_ids": torch.tensor([[101, 1, 2, 3, 102]])}

        boundaries = chunker._find_chunk_boundaries(full_text, chunks)

        assert len(boundaries) == 1
        # Should use full range as fallback
        assert boundaries[0].start_token == 0
        assert boundaries[0].end_token == 5


class TestLateChunkerIntegration:
    """Integration tests for LateChunker with more realistic scenarios."""

    @pytest.fixture
    def mock_model(self) -> MagicMock:
        """Create mock model with realistic behavior."""
        model = MagicMock()
        model.device = "cpu"
        model.get_sentence_embedding_dimension.return_value = 384

        # Different token counts per text
        tokenize_calls = []

        def tokenize_side_effect(texts: list[str]) -> dict:
            text = texts[0]
            # Roughly 4 tokens per word
            word_count = len(text.split())
            token_count = min(word_count * 4 + 2, 512)
            tokenize_calls.append(token_count)
            return {
                "input_ids": torch.tensor([[101] + list(range(1, token_count - 1)) + [102]]),
                "attention_mask": torch.ones(1, token_count),
            }

        model.tokenize.side_effect = tokenize_side_effect

        # Create token embeddings based on sequence length
        def forward_side_effect(inputs: dict) -> dict:
            seq_len = inputs["input_ids"].shape[1]
            return {"token_embeddings": torch.randn(1, seq_len, 384)}

        model.forward.side_effect = forward_side_effect
        model.encode.return_value = np.random.randn(1, 384)

        return model

    def test_conversation_turn_chunking(self, mock_model: MagicMock) -> None:
        """Test chunking a conversation turn."""
        chunker = LateChunker(mock_model)

        full_text = (
            "User: How do I implement authentication?\n\n"
            "Assistant: Here are the steps to implement authentication. "
            "First, you need to set up a user model. "
            "Then configure JWT tokens for session management."
        )

        chunks = [
            "User: How do I implement authentication?",
            "Assistant: Here are the steps to implement authentication.",
            "First, you need to set up a user model.",
            "Then configure JWT tokens for session management.",
        ]

        results = chunker.embed_and_chunk(full_text, chunks)

        assert len(results) == 4
        for result in results:
            assert result.embedding.shape == (384,)
            # Embeddings should be normalized
            norm = np.linalg.norm(result.embedding)
            np.testing.assert_almost_equal(norm, 1.0, decimal=5)
