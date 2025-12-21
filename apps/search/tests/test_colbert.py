"""Tests for ColBERT embedder and reranker.

Note: Full integration tests require loading PyLate models which is slow.
These tests focus on the interface and edge cases that can be tested without model loading.
"""

import numpy as np
import pytest

from src.embedders.colbert import ColBERTEmbedder


class TestColBERTEmbedder:
    """Tests for ColBERTEmbedder that don't require model loading."""

    def test_initialization(self) -> None:
        """Test ColBERT embedder initialization without loading."""
        embedder = ColBERTEmbedder(
            model_name="test-model",
            device="cpu",
            batch_size=16,
            cache_size=1000,
        )
        assert embedder.model_name == "test-model"
        assert embedder.device == "cpu"
        assert embedder.batch_size == 16
        assert embedder._embedding_dim == 128  # Default

    def test_embed_sync_not_loaded(self) -> None:
        """Test embedding raises when model not loaded."""
        embedder = ColBERTEmbedder(model_name="test-model")
        embedder._model = None

        with pytest.raises(RuntimeError, match="not loaded"):
            embedder._embed_sync("test", is_query=True)

    def test_embed_batch_sync_not_loaded(self) -> None:
        """Test batch embedding raises when not loaded."""
        embedder = ColBERTEmbedder(model_name="test-model")
        embedder._model = None

        with pytest.raises(RuntimeError, match="not loaded"):
            embedder._embed_batch_sync(["text"], is_query=True)

    def test_embed_query_not_loaded(self) -> None:
        """Test embed_query raises when not loaded."""
        embedder = ColBERTEmbedder(model_name="test-model")

        with pytest.raises(RuntimeError, match="not loaded"):
            embedder.embed_query("test")

    def test_embed_document_not_loaded(self) -> None:
        """Test embed_document raises when not loaded."""
        embedder = ColBERTEmbedder(model_name="test-model")

        with pytest.raises(RuntimeError, match="not loaded"):
            embedder.embed_document("test")

    def test_embed_query_batch_not_loaded(self) -> None:
        """Test batch query embedding raises when not loaded."""
        embedder = ColBERTEmbedder(model_name="test-model")

        with pytest.raises(RuntimeError, match="not loaded"):
            embedder.embed_query_batch(["test"])

    def test_embed_document_batch_not_loaded(self) -> None:
        """Test batch document embedding raises when not loaded."""
        embedder = ColBERTEmbedder(model_name="test-model")

        with pytest.raises(RuntimeError, match="not loaded"):
            embedder.embed_document_batch(["test"])

    def test_dimensions_property(self) -> None:
        """Test dimensions property."""
        embedder = ColBERTEmbedder(model_name="test-model")
        embedder._embedding_dim = 256

        assert embedder.dimensions == 256

    def test_embed_sync_with_mock_model(self) -> None:
        """Test synchronous embedding with mock model."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_embeddings = np.array([[0.1, 0.2], [0.3, 0.4]])
        mock_model.encode.return_value = [mock_embeddings]
        embedder._model = mock_model
        embedder._embedding_dim = 2

        result = embedder._embed_sync("test query", is_query=True)

        assert isinstance(result, list)
        assert len(result) == 2
        mock_model.encode.assert_called_with(["test query"], is_query=True)

    def test_embed_sync_empty_result(self) -> None:
        """Test embedding returns zero vector on empty result."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_model.encode.return_value = []
        embedder._model = mock_model
        embedder._embedding_dim = 4

        result = embedder._embed_sync("test", is_query=True)

        assert result == [0.0, 0.0, 0.0, 0.0]

    def test_embed_sync_none_result(self) -> None:
        """Test embedding handles None result."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_model.encode.return_value = None
        embedder._model = mock_model
        embedder._embedding_dim = 4

        result = embedder._embed_sync("test", is_query=True)

        assert result == [0.0, 0.0, 0.0, 0.0]

    def test_embed_batch_sync_with_mock_model(self) -> None:
        """Test batch embedding with mock model."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_embeddings = [
            np.array([[0.1, 0.2], [0.3, 0.4]]),
            np.array([[0.5, 0.6]]),
        ]
        mock_model.encode.return_value = mock_embeddings
        embedder._model = mock_model

        results = embedder._embed_batch_sync(["text1", "text2"], is_query=False)

        assert len(results) == 2
        assert all(isinstance(r, list) for r in results)

    def test_embed_batch_sync_empty_embedding(self) -> None:
        """Test batch embedding handles empty embeddings."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_model.encode.return_value = [np.array([]), np.array([[0.1, 0.2]])]
        embedder._model = mock_model
        embedder._embedding_dim = 2

        results = embedder._embed_batch_sync(["text1", "text2"], is_query=False)

        assert len(results) == 2
        assert results[0] == [0.0, 0.0]

    def test_embed_query_with_mock_model(self) -> None:
        """Test embed_query with mock model."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_embeddings = [np.array([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]])]
        mock_model.encode.return_value = mock_embeddings
        embedder._model = mock_model
        embedder._model_loaded = True

        result = embedder.embed_query("test query")

        assert isinstance(result, list)
        assert len(result) == 3

    def test_embed_query_empty_result(self) -> None:
        """Test embed_query handles empty result."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_model.encode.return_value = []
        embedder._model = mock_model
        embedder._model_loaded = True

        result = embedder.embed_query("test")
        assert result == []

    def test_embed_document_with_mock_model(self) -> None:
        """Test embed_document with mock model."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_embeddings = [np.array([[0.1, 0.2], [0.3, 0.4]])]
        mock_model.encode.return_value = mock_embeddings
        embedder._model = mock_model
        embedder._model_loaded = True

        result = embedder.embed_document("test document")

        assert isinstance(result, list)
        assert len(result) == 2

    def test_embed_document_empty_result(self) -> None:
        """Test embed_document handles empty result."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_model.encode.return_value = []
        embedder._model = mock_model
        embedder._model_loaded = True

        result = embedder.embed_document("test")
        assert result == []

    def test_embed_query_batch_with_mock_model(self) -> None:
        """Test batch query embedding with mock model."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_embeddings = [
            np.array([[0.1, 0.2]]),
            np.array([[0.3, 0.4], [0.5, 0.6]]),
        ]
        mock_model.encode.return_value = mock_embeddings
        embedder._model = mock_model
        embedder._model_loaded = True

        results = embedder.embed_query_batch(["query1", "query2"])

        assert len(results) == 2

    def test_embed_document_batch_with_mock_model(self) -> None:
        """Test batch document embedding with mock model."""
        from unittest.mock import MagicMock

        embedder = ColBERTEmbedder(model_name="test-model")
        mock_model = MagicMock()
        mock_embeddings = [np.array([[0.1, 0.2]]), np.array([[0.3, 0.4]])]
        mock_model.encode.return_value = mock_embeddings
        embedder._model = mock_model
        embedder._model_loaded = True

        results = embedder.embed_document_batch(["doc1", "doc2"])

        assert len(results) == 2
