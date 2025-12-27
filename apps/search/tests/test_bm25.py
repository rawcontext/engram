"""Tests for BM25 sparse embedder."""

from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

from src.embedders.bm25 import BM25Embedder, get_bm25_embedder


class TestBM25Embedder:
    """Tests for BM25Embedder class."""

    def test_init_default_params(self) -> None:
        """Test initialization with default parameters."""
        embedder = BM25Embedder()

        assert embedder.model_name == "Qdrant/bm25"
        assert embedder.batch_size == 32
        assert embedder.parallel is None
        assert embedder._model is None

    def test_init_custom_params(self) -> None:
        """Test initialization with custom parameters."""
        embedder = BM25Embedder(
            model_name="custom/bm25",
            batch_size=16,
            parallel=4,
        )

        assert embedder.model_name == "custom/bm25"
        assert embedder.batch_size == 16
        assert embedder.parallel == 4

    async def test_load_initializes_model(self) -> None:
        """Test that load() initializes the model."""
        embedder = BM25Embedder()

        with patch("src.embedders.bm25.SparseTextEmbedding") as mock_sparse:
            mock_model = Mock()
            mock_sparse.return_value = mock_model

            await embedder.load()

            assert embedder._model is mock_model
            mock_sparse.assert_called_once_with(
                model_name="Qdrant/bm25",
                parallel=None,
            )

    async def test_load_with_custom_params(self) -> None:
        """Test that load() respects custom parameters."""
        embedder = BM25Embedder(model_name="custom/model", parallel=2)

        with patch("src.embedders.bm25.SparseTextEmbedding") as mock_sparse:
            await embedder.load()

            mock_sparse.assert_called_once_with(
                model_name="custom/model",
                parallel=2,
            )

    async def test_load_only_loads_once(self) -> None:
        """Test that load() only loads the model once."""
        embedder = BM25Embedder()

        with patch("src.embedders.bm25.SparseTextEmbedding") as mock_sparse:
            mock_model = Mock()
            mock_sparse.return_value = mock_model

            await embedder.load()
            await embedder.load()

            # Should only be called once
            mock_sparse.assert_called_once()

    async def test_load_is_thread_safe(self) -> None:
        """Test that concurrent load() calls are thread-safe."""
        embedder = BM25Embedder()

        with patch("src.embedders.bm25.SparseTextEmbedding") as mock_sparse:
            mock_model = Mock()
            mock_sparse.return_value = mock_model

            # Simulate concurrent loads
            import asyncio

            await asyncio.gather(
                embedder.load(),
                embedder.load(),
                embedder.load(),
            )

            # Should only be called once due to lock
            assert mock_sparse.call_count == 1

    async def test_unload_clears_model(self) -> None:
        """Test that unload() clears the model."""
        embedder = BM25Embedder()

        with patch("src.embedders.bm25.SparseTextEmbedding"):
            await embedder.load()
            assert embedder._model is not None

            await embedder.unload()
            assert embedder._model is None

    async def test_unload_when_not_loaded(self) -> None:
        """Test that unload() handles already-unloaded state."""
        embedder = BM25Embedder()

        # Should not raise
        await embedder.unload()
        assert embedder._model is None

    def test_get_model_raises_when_not_loaded(self) -> None:
        """Test that _get_model raises RuntimeError when model not loaded."""
        embedder = BM25Embedder()

        with pytest.raises(RuntimeError, match="BM25 model not loaded"):
            embedder._get_model()

    def test_get_model_returns_loaded_model(self) -> None:
        """Test that _get_model returns the loaded model."""
        embedder = BM25Embedder()
        mock_model = Mock()
        embedder._model = mock_model

        result = embedder._get_model()

        assert result is mock_model

    def test_embed_sparse_lazy_loads_model(self) -> None:
        """Test that embed_sparse lazy loads model if not loaded."""
        embedder = BM25Embedder()

        with patch("src.embedders.bm25.SparseTextEmbedding") as mock_sparse:
            mock_model = Mock()
            mock_embedding = Mock()
            mock_embedding.indices.tolist.return_value = [0, 5, 10]
            mock_embedding.values.tolist.return_value = [0.5, 0.3, 0.2]
            mock_model.embed.return_value = [mock_embedding]
            mock_sparse.return_value = mock_model

            result = embedder.embed_sparse("test text")

            assert embedder._model is mock_model
            assert result == {0: 0.5, 5: 0.3, 10: 0.2}

    def test_embed_sparse_returns_sparse_dict(self) -> None:
        """Test that embed_sparse returns a sparse dictionary."""
        embedder = BM25Embedder()

        mock_model = Mock()
        mock_embedding = Mock()
        mock_embedding.indices.tolist.return_value = [1, 2, 3]
        mock_embedding.values.tolist.return_value = [0.8, 0.6, 0.4]
        mock_model.embed.return_value = [mock_embedding]
        embedder._model = mock_model

        result = embedder.embed_sparse("machine learning")

        assert isinstance(result, dict)
        assert result == {1: 0.8, 2: 0.6, 3: 0.4}
        mock_model.embed.assert_called_once_with(["machine learning"])

    def test_embed_sparse_handles_empty_result(self) -> None:
        """Test that embed_sparse handles empty embedding result."""
        embedder = BM25Embedder()

        mock_model = Mock()
        mock_model.embed.return_value = []
        embedder._model = mock_model

        result = embedder.embed_sparse("test")

        assert result == {}

    def test_embed_sparse_uses_existing_model(self) -> None:
        """Test that embed_sparse uses existing model if loaded."""
        embedder = BM25Embedder()

        mock_model = Mock()
        mock_embedding = Mock()
        mock_embedding.indices.tolist.return_value = [0]
        mock_embedding.values.tolist.return_value = [1.0]
        mock_model.embed.return_value = [mock_embedding]
        embedder._model = mock_model

        with patch("src.embedders.bm25.SparseTextEmbedding") as mock_sparse:
            result = embedder.embed_sparse("test")

            # Should not call SparseTextEmbedding constructor
            mock_sparse.assert_not_called()
            assert result == {0: 1.0}

    async def test_embed_sparse_async_loads_and_embeds(self) -> None:
        """Test that embed_sparse_async loads model and embeds."""
        embedder = BM25Embedder()

        with patch("src.embedders.bm25.SparseTextEmbedding") as mock_sparse:
            mock_model = Mock()
            mock_embedding = Mock()
            mock_embedding.indices.tolist.return_value = [2, 4]
            mock_embedding.values.tolist.return_value = [0.7, 0.3]
            mock_model.embed.return_value = [mock_embedding]
            mock_sparse.return_value = mock_model

            result = await embedder.embed_sparse_async("async test")

            assert result == {2: 0.7, 4: 0.3}

    async def test_embed_sparse_async_runs_in_executor(self) -> None:
        """Test that embed_sparse_async runs in executor."""
        embedder = BM25Embedder()

        mock_model = Mock()
        mock_embedding = Mock()
        mock_embedding.indices.tolist.return_value = [0]
        mock_embedding.values.tolist.return_value = [1.0]
        mock_model.embed.return_value = [mock_embedding]
        embedder._model = mock_model

        with patch("asyncio.get_event_loop") as mock_get_loop:
            mock_loop = Mock()
            mock_future = AsyncMock()
            mock_future.return_value = {0: 1.0}
            mock_loop.run_in_executor = mock_future
            mock_get_loop.return_value = mock_loop

            result = await embedder.embed_sparse_async("test")

            mock_loop.run_in_executor.assert_called_once()
            # First arg is None (default executor), second is the sync function
            assert mock_loop.run_in_executor.call_args[0][0] is None
            assert callable(mock_loop.run_in_executor.call_args[0][1])

    def test_embed_sparse_batch_lazy_loads(self) -> None:
        """Test that embed_sparse_batch lazy loads model."""
        embedder = BM25Embedder(batch_size=2)

        with patch("src.embedders.bm25.SparseTextEmbedding") as mock_sparse:
            mock_model = Mock()
            mock_emb1 = Mock()
            mock_emb1.indices.tolist.return_value = [0, 1]
            mock_emb1.values.tolist.return_value = [0.5, 0.5]
            mock_emb2 = Mock()
            mock_emb2.indices.tolist.return_value = [2, 3]
            mock_emb2.values.tolist.return_value = [0.3, 0.7]
            mock_model.embed.return_value = [mock_emb1, mock_emb2]
            mock_sparse.return_value = mock_model

            result = embedder.embed_sparse_batch(["text1", "text2"])

            assert len(result) == 2
            assert result[0] == {0: 0.5, 1: 0.5}
            assert result[1] == {2: 0.3, 3: 0.7}
            mock_model.embed.assert_called_once_with(["text1", "text2"], batch_size=2)

    def test_embed_sparse_batch_returns_list_of_dicts(self) -> None:
        """Test that embed_sparse_batch returns list of dictionaries."""
        embedder = BM25Embedder()

        mock_model = Mock()
        embeddings = []
        for i in range(3):
            mock_emb = Mock()
            mock_emb.indices.tolist.return_value = [i, i + 1]
            mock_emb.values.tolist.return_value = [0.6, 0.4]
            embeddings.append(mock_emb)
        mock_model.embed.return_value = embeddings
        embedder._model = mock_model

        texts = ["text1", "text2", "text3"]
        result = embedder.embed_sparse_batch(texts)

        assert isinstance(result, list)
        assert len(result) == 3
        assert all(isinstance(r, dict) for r in result)

    def test_embed_sparse_batch_uses_batch_size(self) -> None:
        """Test that embed_sparse_batch uses configured batch_size."""
        embedder = BM25Embedder(batch_size=16)

        mock_model = Mock()
        mock_emb = Mock()
        mock_emb.indices.tolist.return_value = [0]
        mock_emb.values.tolist.return_value = [1.0]
        mock_model.embed.return_value = [mock_emb]
        embedder._model = mock_model

        embedder.embed_sparse_batch(["test"])

        mock_model.embed.assert_called_once()
        # Check batch_size parameter
        call_kwargs = mock_model.embed.call_args[1]
        assert call_kwargs["batch_size"] == 16

    def test_embed_sparse_batch_handles_empty_list(self) -> None:
        """Test that embed_sparse_batch handles empty list."""
        embedder = BM25Embedder()

        mock_model = Mock()
        mock_model.embed.return_value = []
        embedder._model = mock_model

        result = embedder.embed_sparse_batch([])

        assert result == []

    async def test_embed_sparse_batch_async_loads_and_embeds(self) -> None:
        """Test that embed_sparse_batch_async loads model and embeds."""
        embedder = BM25Embedder()

        with patch("src.embedders.bm25.SparseTextEmbedding") as mock_sparse:
            mock_model = Mock()
            mock_emb = Mock()
            mock_emb.indices.tolist.return_value = [0]
            mock_emb.values.tolist.return_value = [1.0]
            mock_model.embed.return_value = [mock_emb]
            mock_sparse.return_value = mock_model

            result = await embedder.embed_sparse_batch_async(["test"])

            assert result == [{0: 1.0}]

    async def test_embed_sparse_batch_async_runs_in_executor(self) -> None:
        """Test that embed_sparse_batch_async runs in executor."""
        embedder = BM25Embedder()

        mock_model = Mock()
        mock_emb = Mock()
        mock_emb.indices.tolist.return_value = [0]
        mock_emb.values.tolist.return_value = [1.0]
        mock_model.embed.return_value = [mock_emb]
        embedder._model = mock_model

        with patch("asyncio.get_event_loop") as mock_get_loop:
            mock_loop = Mock()
            mock_future = AsyncMock()
            mock_future.return_value = [{0: 1.0}]
            mock_loop.run_in_executor = mock_future
            mock_get_loop.return_value = mock_loop

            result = await embedder.embed_sparse_batch_async(["test"])

            mock_loop.run_in_executor.assert_called_once()
            assert mock_loop.run_in_executor.call_args[0][0] is None


class TestGetBM25Embedder:
    """Tests for get_bm25_embedder singleton function."""

    def test_returns_bm25_embedder_instance(self) -> None:
        """Test that get_bm25_embedder returns BM25Embedder instance."""
        with patch("src.embedders.bm25.get_bm25_embedder.cache_clear"):
            # Clear cache before test
            get_bm25_embedder.cache_clear()

            embedder = get_bm25_embedder()

            assert isinstance(embedder, BM25Embedder)

    def test_returns_same_instance(self) -> None:
        """Test that get_bm25_embedder returns cached instance."""
        with patch("src.embedders.bm25.get_bm25_embedder.cache_clear"):
            get_bm25_embedder.cache_clear()

            embedder1 = get_bm25_embedder()
            embedder2 = get_bm25_embedder()

            assert embedder1 is embedder2

    def test_singleton_with_default_config(self) -> None:
        """Test that singleton has default configuration."""
        with patch("src.embedders.bm25.get_bm25_embedder.cache_clear"):
            get_bm25_embedder.cache_clear()

            embedder = get_bm25_embedder()

            assert embedder.model_name == "Qdrant/bm25"
            assert embedder.batch_size == 32
            assert embedder.parallel is None


class TestBM25EmbedderIntegration:
    """Integration tests using real FastEmbed (if available)."""

    @pytest.fixture
    def real_embedder(self) -> BM25Embedder:
        """Create a real BM25 embedder for integration tests."""
        return BM25Embedder()

    @pytest.mark.skipif(
        not pytest.importorskip("fastembed", reason="fastembed not installed"),
        reason="Requires fastembed",
    )
    async def test_real_embed_sparse(self, real_embedder: BM25Embedder) -> None:
        """Integration test with real FastEmbed model."""
        result = real_embedder.embed_sparse("machine learning")

        assert isinstance(result, dict)
        assert len(result) > 0
        assert all(isinstance(k, int) for k in result.keys())
        assert all(isinstance(v, float) for v in result.values())
        assert all(v > 0 for v in result.values())

    @pytest.mark.skipif(
        not pytest.importorskip("fastembed", reason="fastembed not installed"),
        reason="Requires fastembed",
    )
    async def test_real_embed_sparse_batch(self, real_embedder: BM25Embedder) -> None:
        """Integration test for batch embedding."""
        texts = ["machine learning", "deep learning", "neural networks"]
        results = real_embedder.embed_sparse_batch(texts)

        assert len(results) == 3
        assert all(isinstance(r, dict) for r in results)
        assert all(len(r) > 0 for r in results)

    @pytest.mark.skipif(
        not pytest.importorskip("fastembed", reason="fastembed not installed"),
        reason="Requires fastembed",
    )
    async def test_real_load_unload_cycle(self, real_embedder: BM25Embedder) -> None:
        """Integration test for load/unload cycle."""
        await real_embedder.load()
        assert real_embedder._model is not None

        result = real_embedder.embed_sparse("test")
        assert len(result) > 0

        await real_embedder.unload()
        assert real_embedder._model is None

    @pytest.mark.skipif(
        not pytest.importorskip("fastembed", reason="fastembed not installed"),
        reason="Requires fastembed",
    )
    async def test_real_embed_sparse_async(self, real_embedder: BM25Embedder) -> None:
        """Integration test for async embedding."""
        result = await real_embedder.embed_sparse_async("asynchronous test")

        assert isinstance(result, dict)
        assert len(result) > 0

    @pytest.mark.skipif(
        not pytest.importorskip("fastembed", reason="fastembed not installed"),
        reason="Requires fastembed",
    )
    async def test_real_sparse_vectors_differ(self, real_embedder: BM25Embedder) -> None:
        """Integration test that different texts produce different embeddings."""
        emb1 = real_embedder.embed_sparse("machine learning")
        emb2 = real_embedder.embed_sparse("banana")

        # Embeddings should be different
        assert emb1 != emb2
        # Should have different token indices
        assert set(emb1.keys()) != set(emb2.keys())
