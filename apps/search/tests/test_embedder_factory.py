"""Tests for EmbedderFactory."""

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.config import Settings
from src.embedders.factory import EmbedderFactory


# Create mock modules for embedders that may not be installed
def _create_mock_module(class_name: str) -> MagicMock:
    """Create a mock module with a mock class."""
    mock_module = MagicMock()
    mock_class = MagicMock()
    setattr(mock_module, class_name, mock_class)
    return mock_module


class TestEmbedderFactory:
    """Tests for EmbedderFactory."""

    @pytest.fixture
    def mock_settings(self) -> MagicMock:
        """Create mock settings."""
        settings = MagicMock(spec=Settings)
        settings.embedder_backend = "local"
        settings.embedder_text_model = "BAAI/bge-small-en-v1.5"
        settings.embedder_code_model = "jinaai/jina-embeddings-v2-base-code"
        settings.embedder_sparse_model = "prithvida/Splade_PP_en_v1"
        settings.embedder_colbert_model = "answerdotai/ModernBERT-base"
        settings.embedder_device = "cpu"
        settings.embedder_batch_size = 32
        settings.embedder_cache_size = 1000
        settings.hf_api_token = "test-token"
        return settings

    @pytest.fixture
    def factory(self, mock_settings: MagicMock) -> EmbedderFactory:
        """Create a factory with mock settings."""
        return EmbedderFactory(mock_settings)

    def test_init(self, factory: EmbedderFactory, mock_settings: MagicMock) -> None:
        """Test factory initialization."""
        assert factory.settings == mock_settings
        assert factory._embedders == {}
        assert "text" in factory._locks
        assert "code" in factory._locks
        assert "sparse" in factory._locks
        assert "colbert" in factory._locks

    def test_len_empty(self, factory: EmbedderFactory) -> None:
        """Test __len__ with no embedders."""
        assert len(factory) == 0

    def test_len_with_embedders(self, factory: EmbedderFactory) -> None:
        """Test __len__ with embedders loaded."""
        factory._embedders["text"] = MagicMock()
        factory._embedders["code"] = MagicMock()
        assert len(factory) == 2

    @pytest.mark.asyncio
    async def test_get_text_embedder_local(
        self, factory: EmbedderFactory, mock_settings: MagicMock
    ) -> None:
        """Test get_text_embedder with local backend."""
        mock_settings.embedder_backend = "local"

        # Create mock module and class
        mock_module = MagicMock()
        mock_embedder = MagicMock()
        mock_module.TextEmbedder = MagicMock(return_value=mock_embedder)

        with patch.dict(sys.modules, {"src.embedders.text": mock_module}):
            result = await factory.get_text_embedder()

            assert result == mock_embedder
            mock_module.TextEmbedder.assert_called_once_with(
                model_name=mock_settings.embedder_text_model,
                device=mock_settings.embedder_device,
                batch_size=mock_settings.embedder_batch_size,
                cache_size=mock_settings.embedder_cache_size,
            )

    @pytest.mark.asyncio
    async def test_get_text_embedder_huggingface(
        self, factory: EmbedderFactory, mock_settings: MagicMock
    ) -> None:
        """Test get_text_embedder with huggingface backend."""
        mock_settings.embedder_backend = "huggingface"

        with patch("src.clients.huggingface.HuggingFaceEmbedder") as MockHFEmbedder:
            mock_embedder = MagicMock()
            MockHFEmbedder.return_value = mock_embedder

            result = await factory.get_text_embedder()

            assert result == mock_embedder
            MockHFEmbedder.assert_called_once_with(
                model_id=mock_settings.embedder_text_model,
                api_token=mock_settings.hf_api_token,
            )

    @pytest.mark.asyncio
    async def test_get_text_embedder_cached(self, factory: EmbedderFactory) -> None:
        """Test get_text_embedder returns cached embedder."""
        mock_embedder = MagicMock()
        factory._embedders["text"] = mock_embedder

        result = await factory.get_text_embedder()

        assert result == mock_embedder

    @pytest.mark.asyncio
    async def test_get_code_embedder_local(
        self, factory: EmbedderFactory, mock_settings: MagicMock
    ) -> None:
        """Test get_code_embedder with local backend."""
        mock_settings.embedder_backend = "local"

        mock_module = MagicMock()
        mock_embedder = MagicMock()
        mock_module.CodeEmbedder = MagicMock(return_value=mock_embedder)

        with patch.dict(sys.modules, {"src.embedders.code": mock_module}):
            result = await factory.get_code_embedder()

            assert result == mock_embedder
            mock_module.CodeEmbedder.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_code_embedder_huggingface(
        self, factory: EmbedderFactory, mock_settings: MagicMock
    ) -> None:
        """Test get_code_embedder with huggingface backend."""
        mock_settings.embedder_backend = "huggingface"

        with patch("src.clients.huggingface.HuggingFaceEmbedder") as MockHFEmbedder:
            mock_embedder = MagicMock()
            MockHFEmbedder.return_value = mock_embedder

            result = await factory.get_code_embedder()

            assert result == mock_embedder
            MockHFEmbedder.assert_called_once_with(
                model_id=mock_settings.embedder_code_model,
                api_token=mock_settings.hf_api_token,
            )

    @pytest.mark.asyncio
    async def test_get_code_embedder_cached(self, factory: EmbedderFactory) -> None:
        """Test get_code_embedder returns cached embedder."""
        mock_embedder = MagicMock()
        factory._embedders["code"] = mock_embedder

        result = await factory.get_code_embedder()

        assert result == mock_embedder

    @pytest.mark.asyncio
    async def test_get_sparse_embedder(self, factory: EmbedderFactory) -> None:
        """Test get_sparse_embedder."""
        mock_module = MagicMock()
        mock_embedder = MagicMock()
        mock_module.SparseEmbedder = MagicMock(return_value=mock_embedder)

        with patch.dict(sys.modules, {"src.embedders.sparse": mock_module}):
            result = await factory.get_sparse_embedder()

            assert result == mock_embedder
            mock_module.SparseEmbedder.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_sparse_embedder_cached(self, factory: EmbedderFactory) -> None:
        """Test get_sparse_embedder returns cached embedder."""
        mock_embedder = MagicMock()
        factory._embedders["sparse"] = mock_embedder

        result = await factory.get_sparse_embedder()

        assert result == mock_embedder

    @pytest.mark.asyncio
    async def test_get_colbert_embedder(self, factory: EmbedderFactory) -> None:
        """Test get_colbert_embedder."""
        with patch("src.embedders.colbert.ColBERTEmbedder") as MockColBERTEmbedder:
            mock_embedder = MagicMock()
            MockColBERTEmbedder.return_value = mock_embedder

            result = await factory.get_colbert_embedder()

            assert result == mock_embedder
            MockColBERTEmbedder.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_colbert_embedder_cached(self, factory: EmbedderFactory) -> None:
        """Test get_colbert_embedder returns cached embedder."""
        mock_embedder = MagicMock()
        factory._embedders["colbert"] = mock_embedder

        result = await factory.get_colbert_embedder()

        assert result == mock_embedder

    @pytest.mark.asyncio
    async def test_get_embedder_text(self, factory: EmbedderFactory) -> None:
        """Test get_embedder with text type."""
        mock_embedder = MagicMock()
        factory._embedders["text"] = mock_embedder

        result = await factory.get_embedder("text")

        assert result == mock_embedder

    @pytest.mark.asyncio
    async def test_get_embedder_code(self, factory: EmbedderFactory) -> None:
        """Test get_embedder with code type."""
        mock_embedder = MagicMock()
        factory._embedders["code"] = mock_embedder

        result = await factory.get_embedder("code")

        assert result == mock_embedder

    @pytest.mark.asyncio
    async def test_get_embedder_sparse(self, factory: EmbedderFactory) -> None:
        """Test get_embedder with sparse type."""
        mock_embedder = MagicMock()
        factory._embedders["sparse"] = mock_embedder

        result = await factory.get_embedder("sparse")

        assert result == mock_embedder

    @pytest.mark.asyncio
    async def test_get_embedder_colbert(self, factory: EmbedderFactory) -> None:
        """Test get_embedder with colbert type."""
        mock_embedder = MagicMock()
        factory._embedders["colbert"] = mock_embedder

        result = await factory.get_embedder("colbert")

        assert result == mock_embedder

    @pytest.mark.asyncio
    async def test_get_embedder_invalid_type(self, factory: EmbedderFactory) -> None:
        """Test get_embedder with invalid type."""
        with pytest.raises(ValueError, match="Invalid embedder type"):
            await factory.get_embedder("invalid")  # type: ignore

    @pytest.mark.asyncio
    async def test_preload_all_success(self, factory: EmbedderFactory) -> None:
        """Test preload_all with successful loads."""
        # Create mock embedders
        mock_text = MagicMock()
        mock_text.load = AsyncMock()
        mock_text.model_name = "text"

        mock_code = MagicMock()
        mock_code.load = AsyncMock()
        mock_code.model_name = "code"

        mock_sparse = MagicMock()
        mock_sparse.load = AsyncMock()
        mock_sparse.model_name = "sparse"

        mock_colbert = MagicMock()
        mock_colbert.load = AsyncMock()
        mock_colbert.model_name = "colbert"

        with (
            patch.object(factory, "get_text_embedder", return_value=mock_text),
            patch.object(factory, "get_code_embedder", return_value=mock_code),
            patch.object(factory, "get_sparse_embedder", return_value=mock_sparse),
            patch.object(factory, "get_colbert_embedder", return_value=mock_colbert),
        ):
            await factory.preload_all()

            mock_text.load.assert_called_once()
            mock_code.load.assert_called_once()
            mock_sparse.load.assert_called_once()
            mock_colbert.load.assert_called_once()

    @pytest.mark.asyncio
    async def test_preload_all_with_get_failure(self, factory: EmbedderFactory) -> None:
        """Test preload_all handles failures when getting embedders."""
        mock_text = MagicMock()
        mock_text.load = AsyncMock()
        mock_text.model_name = "text"

        # Code embedder will fail to be created
        with (
            patch.object(factory, "get_text_embedder", return_value=mock_text),
            patch.object(factory, "get_code_embedder", side_effect=ImportError("No local deps")),
            patch.object(factory, "get_sparse_embedder", side_effect=ImportError("No local deps")),
            patch.object(factory, "get_colbert_embedder", side_effect=ImportError("No local deps")),
        ):
            await factory.preload_all()

            # Should still load the text embedder
            mock_text.load.assert_called_once()

    @pytest.mark.asyncio
    async def test_preload_all_with_load_failure(self, factory: EmbedderFactory) -> None:
        """Test preload_all handles failures when loading embedders."""
        mock_text = MagicMock()
        mock_text.load = AsyncMock()
        mock_text.model_name = "text"

        mock_code = MagicMock()
        mock_code.load = AsyncMock(side_effect=RuntimeError("Load failed"))
        mock_code.model_name = "code"

        factory._embedders["text"] = mock_text
        factory._embedders["code"] = mock_code

        with (
            patch.object(factory, "get_text_embedder", return_value=mock_text),
            patch.object(factory, "get_code_embedder", return_value=mock_code),
            patch.object(factory, "get_sparse_embedder", side_effect=ImportError("No local deps")),
            patch.object(factory, "get_colbert_embedder", side_effect=ImportError("No local deps")),
        ):
            await factory.preload_all()

            # Code embedder should be removed from factory after failure
            assert "code" not in factory._embedders

    @pytest.mark.asyncio
    async def test_unload_all(self, factory: EmbedderFactory) -> None:
        """Test unload_all unloads all embedders."""
        mock_text = MagicMock()
        mock_text.unload = AsyncMock()

        mock_code = MagicMock()
        mock_code.unload = AsyncMock()

        factory._embedders["text"] = mock_text
        factory._embedders["code"] = mock_code

        await factory.unload_all()

        mock_text.unload.assert_called_once()
        mock_code.unload.assert_called_once()
        assert len(factory._embedders) == 0

    @pytest.mark.asyncio
    async def test_unload_all_empty(self, factory: EmbedderFactory) -> None:
        """Test unload_all with no embedders."""
        await factory.unload_all()
        assert len(factory._embedders) == 0

    @pytest.mark.asyncio
    async def test_concurrent_get_text_embedder(self, factory: EmbedderFactory) -> None:
        """Test concurrent calls to get_text_embedder return same instance."""
        import asyncio

        mock_module = MagicMock()
        mock_embedder = MagicMock()
        mock_module.TextEmbedder = MagicMock(return_value=mock_embedder)

        with patch.dict(sys.modules, {"src.embedders.text": mock_module}):
            # Call concurrently
            results = await asyncio.gather(
                factory.get_text_embedder(),
                factory.get_text_embedder(),
                factory.get_text_embedder(),
            )

            # All should return the same instance
            assert all(r == mock_embedder for r in results)
            # Factory should only create one instance due to lock
            assert mock_module.TextEmbedder.call_count == 1
