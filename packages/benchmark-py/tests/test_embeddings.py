"""
Tests for embedding provider.
"""

from unittest.mock import MagicMock, patch

import pytest

from engram_benchmark.providers.embeddings import EmbeddingProvider


@pytest.fixture
def mock_sentence_transformer() -> MagicMock:
    """Mock SentenceTransformer model."""
    model = MagicMock()
    model.get_sentence_embedding_dimension.return_value = 384

    # Mock encode for single text
    model.encode.return_value = MagicMock()
    model.encode.return_value.tolist.return_value = [0.1] * 384

    return model


@pytest.fixture
def mock_batch_embeddings() -> list[list[float]]:
    """Mock batch embeddings."""
    return [[0.1] * 384, [0.2] * 384, [0.3] * 384]


class TestEmbeddingProvider:
    """Tests for EmbeddingProvider."""

    @pytest.mark.asyncio
    async def test_initialization(self) -> None:
        """Test provider initialization."""
        provider = EmbeddingProvider(
            model_name="BAAI/bge-small-en-v1.5",
            device="cpu",
            batch_size=16,
        )

        assert provider.model_name == "BAAI/bge-small-en-v1.5"
        assert provider.device == "cpu"
        assert provider.batch_size == 16
        assert not provider._model_loaded

    @pytest.mark.asyncio
    async def test_load_model(self, mock_sentence_transformer: MagicMock) -> None:
        """Test model loading."""
        with patch(
            "engram_benchmark.providers.embeddings.SentenceTransformer",
            return_value=mock_sentence_transformer,
        ):
            provider = EmbeddingProvider(model_name="BAAI/bge-small-en-v1.5")
            await provider.load()

            assert provider._model_loaded
            assert provider._embedding_dim == 384
            assert provider.dimensions == 384

    @pytest.mark.asyncio
    async def test_load_model_only_once(self, mock_sentence_transformer: MagicMock) -> None:
        """Test that model is only loaded once."""
        with patch(
            "engram_benchmark.providers.embeddings.SentenceTransformer",
            return_value=mock_sentence_transformer,
        ) as mock_st:
            provider = EmbeddingProvider(model_name="BAAI/bge-small-en-v1.5")

            # Load twice
            await provider.load()
            await provider.load()

            # Should only instantiate SentenceTransformer once
            assert mock_st.call_count == 1

    @pytest.mark.asyncio
    async def test_embed_single_text(self, mock_sentence_transformer: MagicMock) -> None:
        """Test single text embedding."""
        with patch(
            "engram_benchmark.providers.embeddings.SentenceTransformer",
            return_value=mock_sentence_transformer,
        ):
            provider = EmbeddingProvider(model_name="BAAI/bge-small-en-v1.5")
            embedding = await provider.embed("Hello world")

            assert isinstance(embedding, list)
            assert len(embedding) == 384
            assert all(isinstance(x, float) for x in embedding)

            # Verify encode was called with correct parameters
            mock_sentence_transformer.encode.assert_called_once()
            call_args = mock_sentence_transformer.encode.call_args
            assert call_args[0][0] == "Hello world"
            assert call_args[1]["normalize_embeddings"] is True

    @pytest.mark.asyncio
    async def test_embed_batch(
        self, mock_sentence_transformer: MagicMock, mock_batch_embeddings: list[list[float]]
    ) -> None:
        """Test batch embedding."""
        # Configure mock for batch encoding
        mock_result = MagicMock()
        mock_result.tolist.return_value = mock_batch_embeddings
        mock_sentence_transformer.encode.return_value = mock_result

        with patch(
            "engram_benchmark.providers.embeddings.SentenceTransformer",
            return_value=mock_sentence_transformer,
        ):
            provider = EmbeddingProvider(model_name="BAAI/bge-small-en-v1.5", batch_size=16)
            texts = ["Text 1", "Text 2", "Text 3"]
            embeddings = await provider.embed_batch(texts)

            assert isinstance(embeddings, list)
            assert len(embeddings) == 3
            assert all(len(emb) == 384 for emb in embeddings)

            # Verify batch encoding parameters
            call_args = mock_sentence_transformer.encode.call_args
            assert call_args[0][0] == texts
            assert call_args[1]["batch_size"] == 16
            assert call_args[1]["show_progress_bar"] is False

    @pytest.mark.asyncio
    async def test_embed_without_normalization(self, mock_sentence_transformer: MagicMock) -> None:
        """Test embedding without normalization."""
        with patch(
            "engram_benchmark.providers.embeddings.SentenceTransformer",
            return_value=mock_sentence_transformer,
        ):
            provider = EmbeddingProvider(
                model_name="BAAI/bge-small-en-v1.5", normalize_embeddings=False
            )
            await provider.embed("Hello")

            call_args = mock_sentence_transformer.encode.call_args
            assert call_args[1]["normalize_embeddings"] is False

    @pytest.mark.asyncio
    async def test_embed_before_load_auto_loads(self, mock_sentence_transformer: MagicMock) -> None:
        """Test that embedding auto-loads the model if not loaded."""
        with patch(
            "engram_benchmark.providers.embeddings.SentenceTransformer",
            return_value=mock_sentence_transformer,
        ):
            provider = EmbeddingProvider(model_name="BAAI/bge-small-en-v1.5")

            assert not provider._model_loaded

            # Embed should trigger load
            await provider.embed("Test")

            assert provider._model_loaded

    @pytest.mark.asyncio
    async def test_unload_model(self, mock_sentence_transformer: MagicMock) -> None:
        """Test model unloading."""
        with patch(
            "engram_benchmark.providers.embeddings.SentenceTransformer",
            return_value=mock_sentence_transformer,
        ):
            provider = EmbeddingProvider(model_name="BAAI/bge-small-en-v1.5")
            await provider.load()

            assert provider._model_loaded

            await provider.unload()

            assert not provider._model_loaded
            assert provider._model is None

    @pytest.mark.asyncio
    async def test_device_auto_detection_cpu(self) -> None:
        """Test device auto-detection falls back to CPU."""
        with patch("engram_benchmark.providers.embeddings.torch") as mock_torch:
            mock_torch.cuda.is_available.return_value = False
            mock_torch.backends.mps.is_available.return_value = False

            provider = EmbeddingProvider(model_name="test", device="auto")

            assert provider.device == "cpu"

    @pytest.mark.asyncio
    async def test_device_auto_detection_cuda(self) -> None:
        """Test device auto-detection selects CUDA when available."""
        with patch("engram_benchmark.providers.embeddings.torch") as mock_torch:
            mock_torch.cuda.is_available.return_value = True

            provider = EmbeddingProvider(model_name="test", device="auto")

            assert provider.device == "cuda"

    @pytest.mark.asyncio
    async def test_device_fallback_cuda_unavailable(self) -> None:
        """Test device fallback when CUDA is requested but unavailable."""
        with patch("engram_benchmark.providers.embeddings.torch") as mock_torch:
            mock_torch.cuda.is_available.return_value = False

            provider = EmbeddingProvider(model_name="test", device="cuda")

            assert provider.device == "cpu"

    @pytest.mark.asyncio
    async def test_dimensions_before_load(self) -> None:
        """Test dimensions returns default before model is loaded."""
        provider = EmbeddingProvider(model_name="BAAI/bge-base-en-v1.5")

        # Should return default BGE-base dimension
        assert provider.dimensions == 768

    @pytest.mark.asyncio
    async def test_error_on_embed_without_model(self) -> None:
        """Test that embedding fails if model is not loaded properly."""
        provider = EmbeddingProvider(model_name="test")
        provider._model = None  # Force model to be None

        with pytest.raises(RuntimeError, match="Model not loaded"):
            provider._embed_sync("test")

    @pytest.mark.asyncio
    async def test_error_on_batch_embed_without_model(self) -> None:
        """Test that batch embedding fails if model is not loaded properly."""
        provider = EmbeddingProvider(model_name="test")
        provider._model = None  # Force model to be None

        with pytest.raises(RuntimeError, match="Model not loaded"):
            provider._embed_batch_sync(["test"])
