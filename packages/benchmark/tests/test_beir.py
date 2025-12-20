"""
Tests for BEIR benchmark wrapper.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from engram_benchmark.benchmarks.beir import BEIRBenchmark, BEIRConfig, BEIRResults


class TestBEIRConfig:
    """Tests for BEIRConfig."""

    def test_config_defaults(self) -> None:
        """Test default configuration values."""
        config = BEIRConfig(model_name="test-model")

        assert config.model_name == "test-model"
        assert config.datasets == ["nfcorpus"]
        assert config.split == "test"
        assert config.batch_size == 128
        assert config.score_function == "cos_sim"
        assert config.top_k == 100
        assert config.device == "cpu"
        assert config.corpus_chunk_size == 50000

    def test_config_custom_values(self) -> None:
        """Test custom configuration values."""
        config = BEIRConfig(
            model_name="custom-model",
            datasets=["nfcorpus", "scifact"],
            split="dev",
            output_folder=Path("/tmp/results"),
            batch_size=256,
            score_function="dot",
            top_k=50,
            device="cuda",
            corpus_chunk_size=10000,
        )

        assert config.model_name == "custom-model"
        assert config.datasets == ["nfcorpus", "scifact"]
        assert config.split == "dev"
        assert config.output_folder == Path("/tmp/results")
        assert config.batch_size == 256
        assert config.score_function == "dot"
        assert config.top_k == 50
        assert config.device == "cuda"
        assert config.corpus_chunk_size == 10000

    def test_config_validation_batch_size(self) -> None:
        """Test batch size validation."""
        # Valid batch size
        config = BEIRConfig(model_name="test", batch_size=256)
        assert config.batch_size == 256

        # Invalid batch sizes should raise ValidationError
        with pytest.raises(Exception):  # Pydantic ValidationError  # noqa: B017
            BEIRConfig(model_name="test", batch_size=0)

        with pytest.raises(Exception):  # Pydantic ValidationError  # noqa: B017
            BEIRConfig(model_name="test", batch_size=1000)

    def test_config_validation_top_k(self) -> None:
        """Test top_k validation."""
        # Valid top_k
        config = BEIRConfig(model_name="test", top_k=500)
        assert config.top_k == 500

        # Invalid top_k should raise ValidationError
        with pytest.raises(Exception):  # Pydantic ValidationError  # noqa: B017
            BEIRConfig(model_name="test", top_k=0)

        with pytest.raises(Exception):  # Pydantic ValidationError  # noqa: B017
            BEIRConfig(model_name="test", top_k=2000)


class TestBEIRResults:
    """Tests for BEIRResults."""

    def test_results_initialization(self) -> None:
        """Test results initialization."""
        scores = {
            "nfcorpus": {"NDCG@10": 0.35, "Recall@100": 0.60},
            "scifact": {"NDCG@10": 0.68, "Recall@100": 0.85},
        }
        results = BEIRResults(
            model_name="test-model",
            datasets=["nfcorpus", "scifact"],
            scores=scores,
            metadata={"device": "cpu"},
        )

        assert results.model_name == "test-model"
        assert results.datasets == ["nfcorpus", "scifact"]
        assert results.scores == scores
        assert results.metadata == {"device": "cpu"}

    def test_get_average_ndcg(self) -> None:
        """Test average NDCG@10 calculation."""
        scores = {
            "dataset1": {"NDCG@10": 0.40},
            "dataset2": {"NDCG@10": 0.60},
            "dataset3": {"NDCG@10": 0.50},
        }
        results = BEIRResults(
            model_name="test", datasets=["dataset1", "dataset2", "dataset3"], scores=scores
        )

        avg = results.get_average_ndcg(10)
        assert avg == pytest.approx(0.50, rel=1e-2)

    def test_get_average_recall(self) -> None:
        """Test average Recall@100 calculation."""
        scores = {
            "dataset1": {"Recall@100": 0.70},
            "dataset2": {"Recall@100": 0.80},
            "dataset3": {"Recall@100": 0.90},
        }
        results = BEIRResults(
            model_name="test", datasets=["dataset1", "dataset2", "dataset3"], scores=scores
        )

        avg = results.get_average_recall(100)
        assert avg == pytest.approx(0.80, rel=1e-2)

    def test_get_average_ndcg_empty(self) -> None:
        """Test average NDCG with no scores."""
        results = BEIRResults(model_name="test", datasets=[], scores={})

        assert results.get_average_ndcg(10) == 0.0

    def test_get_average_recall_empty(self) -> None:
        """Test average Recall with no scores."""
        results = BEIRResults(model_name="test", datasets=[], scores={})

        assert results.get_average_recall(100) == 0.0

    def test_to_dict(self) -> None:
        """Test dictionary conversion."""
        scores = {"nfcorpus": {"NDCG@10": 0.35, "Recall@100": 0.60}}
        results = BEIRResults(
            model_name="test",
            datasets=["nfcorpus"],
            scores=scores,
            metadata={"key": "value"},
        )

        result_dict = results.to_dict()

        assert result_dict["model_name"] == "test"
        assert result_dict["datasets"] == ["nfcorpus"]
        assert result_dict["scores"] == scores
        assert result_dict["metadata"] == {"key": "value"}
        assert "average_ndcg@10" in result_dict
        assert "average_recall@100" in result_dict


class TestBEIRBenchmark:
    """Tests for BEIRBenchmark."""

    def test_initialization(self, tmp_path: Path) -> None:
        """Test benchmark initialization."""
        config = BEIRConfig(model_name="test-model", output_folder=tmp_path)
        benchmark = BEIRBenchmark(config)

        assert benchmark.config == config
        assert benchmark._model is None
        assert tmp_path.exists()

    def test_load_model_missing_beir(self, tmp_path: Path) -> None:
        """Test error when beir is not installed."""
        config = BEIRConfig(model_name="test-model", output_folder=tmp_path)
        benchmark = BEIRBenchmark(config)

        with (
            patch.dict("sys.modules", {"sentence_transformers": None}),
            pytest.raises(ImportError, match="beir is not installed"),
        ):
            benchmark._load_model()

    def test_load_model(self, tmp_path: Path) -> None:
        """Test model loading."""
        mock_beir_module = MagicMock()
        mock_st_module = MagicMock()

        mock_model = MagicMock()
        mock_st_class = MagicMock(return_value=mock_model)
        mock_st_module.SentenceTransformer = mock_st_class

        with patch.dict(
            "sys.modules",
            {
                "beir": mock_beir_module,
                "beir.retrieval": mock_beir_module,
                "beir.retrieval.evaluation": mock_beir_module,
                "sentence_transformers": mock_st_module,
            },
        ):
            config = BEIRConfig(
                model_name="test-model", output_folder=tmp_path, device="cuda", batch_size=64
            )
            benchmark = BEIRBenchmark(config)
            wrapper = benchmark._load_model()

            # Should return BEIRModelWrapper
            assert hasattr(wrapper, "encode_queries")
            assert hasattr(wrapper, "encode_corpus")

            # Verify SentenceTransformer was called
            mock_st_class.assert_called_once_with("test-model", device="cuda")

    def test_model_wrapper_encode_queries(self, tmp_path: Path) -> None:
        """Test BEIRModelWrapper encode_queries method."""
        mock_beir_module = MagicMock()
        mock_st_module = MagicMock()

        mock_model = MagicMock()
        mock_model.encode.return_value = [[0.1, 0.2], [0.3, 0.4]]
        mock_st_class = MagicMock(return_value=mock_model)
        mock_st_module.SentenceTransformer = mock_st_class

        with patch.dict(
            "sys.modules",
            {
                "beir": mock_beir_module,
                "beir.retrieval": mock_beir_module,
                "beir.retrieval.evaluation": mock_beir_module,
                "sentence_transformers": mock_st_module,
            },
        ):
            config = BEIRConfig(model_name="test-model", output_folder=tmp_path, batch_size=32)
            benchmark = BEIRBenchmark(config)
            wrapper = benchmark._load_model()

            queries = ["query1", "query2"]
            wrapper.encode_queries(queries, batch_size=32)

            mock_model.encode.assert_called_once_with(
                queries, batch_size=32, show_progress_bar=True, convert_to_numpy=True
            )

    def test_model_wrapper_encode_corpus(self, tmp_path: Path) -> None:
        """Test BEIRModelWrapper encode_corpus method."""
        mock_beir_module = MagicMock()
        mock_st_module = MagicMock()

        mock_model = MagicMock()
        mock_model.encode.return_value = [[0.1, 0.2], [0.3, 0.4]]
        mock_st_class = MagicMock(return_value=mock_model)
        mock_st_module.SentenceTransformer = mock_st_class

        with patch.dict(
            "sys.modules",
            {
                "beir": mock_beir_module,
                "beir.retrieval": mock_beir_module,
                "beir.retrieval.evaluation": mock_beir_module,
                "sentence_transformers": mock_st_module,
            },
        ):
            config = BEIRConfig(model_name="test-model", output_folder=tmp_path, batch_size=32)
            benchmark = BEIRBenchmark(config)
            wrapper = benchmark._load_model()

            corpus = [
                {"title": "Title 1", "text": "Text 1"},
                {"title": "Title 2", "text": "Text 2"},
            ]
            wrapper.encode_corpus(corpus, batch_size=32)

            # Should combine title and text
            expected_sentences = ["Title 1 Text 1", "Title 2 Text 2"]
            mock_model.encode.assert_called_once_with(
                expected_sentences, batch_size=32, show_progress_bar=True, convert_to_numpy=True
            )

    def test_get_available_datasets(self) -> None:
        """Test getting available BEIR datasets."""
        datasets = BEIRBenchmark.get_available_datasets()

        # Should include common datasets
        assert "nfcorpus" in datasets
        assert "scifact" in datasets
        assert "scidocs" in datasets
        assert "fiqa" in datasets
        assert isinstance(datasets, list)
        assert len(datasets) > 0

    def test_run(self, tmp_path: Path) -> None:
        """Test running BEIR evaluation."""
        # Create comprehensive mocks for all beir modules
        mock_beir = MagicMock()
        mock_beir_util = MagicMock()
        mock_beir_datasets = MagicMock()
        mock_beir_datasets_loader = MagicMock()
        mock_beir_retrieval = MagicMock()
        mock_beir_retrieval_models = MagicMock()
        mock_beir_retrieval_evaluation = MagicMock()
        mock_beir_retrieval_search = MagicMock()
        mock_beir_retrieval_search_dense = MagicMock()
        mock_st_module = MagicMock()

        # Mock model
        mock_model = MagicMock()
        mock_st_class = MagicMock(return_value=mock_model)
        mock_st_module.SentenceTransformer = mock_st_class

        # Mock dataset download
        mock_beir_util.download_and_unzip.return_value = str(tmp_path / "datasets" / "nfcorpus")

        # Mock data loader
        mock_corpus = {"doc1": {"title": "Title 1", "text": "Text 1"}}
        mock_queries = {"q1": "Query 1"}
        mock_qrels = {"q1": {"doc1": 1}}
        mock_loader_instance = MagicMock()
        mock_loader_instance.load.return_value = (mock_corpus, mock_queries, mock_qrels)
        mock_beir_datasets_loader.GenericDataLoader.return_value = mock_loader_instance

        # Mock retrieval
        mock_results = {"q1": {"doc1": 0.95}}
        mock_retriever = MagicMock()
        mock_retriever.search.return_value = mock_results
        mock_beir_retrieval_search_dense.DenseRetrievalExactSearch.return_value = mock_retriever

        # Mock evaluation
        mock_ndcg = {10: 0.35}
        mock_map = {10: 0.30}
        mock_recall = {100: 0.60}
        mock_precision = {10: 0.40}
        mock_beir_retrieval_evaluation.EvaluateRetrieval.evaluate.return_value = (
            mock_ndcg,
            mock_map,
            mock_recall,
            mock_precision,
        )

        # Set up module hierarchy
        mock_beir.util = mock_beir_util
        mock_beir.datasets = mock_beir_datasets
        mock_beir.datasets.data_loader = mock_beir_datasets_loader
        mock_beir.retrieval = mock_beir_retrieval
        mock_beir.retrieval.models = mock_beir_retrieval_models
        mock_beir.retrieval.evaluation = mock_beir_retrieval_evaluation
        mock_beir.retrieval.search = mock_beir_retrieval_search
        mock_beir.retrieval.search.dense = mock_beir_retrieval_search_dense

        with patch.dict(
            "sys.modules",
            {
                "beir": mock_beir,
                "beir.util": mock_beir_util,
                "beir.datasets": mock_beir_datasets,
                "beir.datasets.data_loader": mock_beir_datasets_loader,
                "beir.retrieval": mock_beir_retrieval,
                "beir.retrieval.models": mock_beir_retrieval_models,
                "beir.retrieval.evaluation": mock_beir_retrieval_evaluation,
                "beir.retrieval.search": mock_beir_retrieval_search,
                "beir.retrieval.search.dense": mock_beir_retrieval_search_dense,
                "sentence_transformers": mock_st_module,
            },
        ):
            config = BEIRConfig(
                model_name="test-model",
                datasets=["nfcorpus"],
                output_folder=tmp_path,
                batch_size=128,
                top_k=100,
            )
            benchmark = BEIRBenchmark(config)
            results = benchmark.run()

            # Verify results
            assert results.model_name == "test-model"
            assert results.datasets == ["nfcorpus"]
            assert "nfcorpus" in results.scores
            assert results.scores["nfcorpus"]["NDCG@10"] == 0.35
            assert results.scores["nfcorpus"]["Recall@100"] == 0.60
            assert results.metadata["batch_size"] == 128
            assert results.metadata["top_k"] == 100

            # Verify methods were called
            mock_beir_util.download_and_unzip.assert_called_once()
            mock_loader_instance.load.assert_called_once_with(split="test")
            mock_retriever.search.assert_called_once()
            mock_beir_retrieval_evaluation.EvaluateRetrieval.evaluate.assert_called_once()
