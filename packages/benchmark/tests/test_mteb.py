"""
Tests for MTEB benchmark wrapper.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from engram_benchmark.benchmarks.mteb import MTEBBenchmark, MTEBConfig, MTEBResults


class TestMTEBConfig:
    """Tests for MTEBConfig."""

    def test_config_defaults(self) -> None:
        """Test default configuration values."""
        config = MTEBConfig(model_name="test-model")

        assert config.model_name == "test-model"
        assert config.tasks == ["Banking77Classification"]
        assert config.languages == ["en"]
        assert config.batch_size == 32
        assert not config.overwrite_results
        assert config.device == "cpu"
        assert config.verbosity == 2

    def test_config_custom_values(self) -> None:
        """Test custom configuration values."""
        config = MTEBConfig(
            model_name="custom-model",
            tasks=["Task1", "Task2"],
            languages=["en", "es"],
            output_folder=Path("/tmp/results"),
            batch_size=64,
            device="cuda",
            verbosity=3,
        )

        assert config.model_name == "custom-model"
        assert config.tasks == ["Task1", "Task2"]
        assert config.languages == ["en", "es"]
        assert config.output_folder == Path("/tmp/results")
        assert config.batch_size == 64
        assert config.device == "cuda"
        assert config.verbosity == 3

    def test_config_validation_batch_size(self) -> None:
        """Test batch size validation."""
        # Valid batch size
        config = MTEBConfig(model_name="test", batch_size=256)
        assert config.batch_size == 256

        # Invalid batch sizes should raise ValidationError
        with pytest.raises(ValueError):
            MTEBConfig(model_name="test", batch_size=0)

        with pytest.raises(ValueError):
            MTEBConfig(model_name="test", batch_size=1000)


class TestMTEBResults:
    """Tests for MTEBResults."""

    def test_results_initialization(self) -> None:
        """Test results initialization."""
        scores = {
            "Task1": {"main_score": 0.85, "accuracy": 0.87},
            "Task2": {"main_score": 0.90, "f1": 0.92},
        }
        results = MTEBResults(
            model_name="test-model",
            tasks=["Task1", "Task2"],
            scores=scores,
            metadata={"device": "cpu"},
        )

        assert results.model_name == "test-model"
        assert results.tasks == ["Task1", "Task2"]
        assert results.scores == scores
        assert results.metadata == {"device": "cpu"}

    def test_get_average_score(self) -> None:
        """Test average score calculation."""
        scores = {
            "Task1": {"main_score": 0.80},
            "Task2": {"main_score": 0.90},
            "Task3": {"main_score": 0.70},
        }
        results = MTEBResults(model_name="test", tasks=["Task1", "Task2", "Task3"], scores=scores)

        avg = results.get_average_score()
        assert avg == pytest.approx(0.80, rel=1e-2)

    def test_get_average_score_empty(self) -> None:
        """Test average score with no scores."""
        results = MTEBResults(model_name="test", tasks=[], scores={})

        assert results.get_average_score() == 0.0

    def test_to_dict(self) -> None:
        """Test dictionary conversion."""
        scores = {"Task1": {"main_score": 0.85}}
        results = MTEBResults(
            model_name="test", tasks=["Task1"], scores=scores, metadata={"key": "value"}
        )

        result_dict = results.to_dict()

        assert result_dict["model_name"] == "test"
        assert result_dict["tasks"] == ["Task1"]
        assert result_dict["scores"] == scores
        assert result_dict["metadata"] == {"key": "value"}
        assert "average_score" in result_dict


class TestMTEBBenchmark:
    """Tests for MTEBBenchmark."""

    def test_initialization(self, tmp_path: Path) -> None:
        """Test benchmark initialization."""
        config = MTEBConfig(model_name="test-model", output_folder=tmp_path)
        benchmark = MTEBBenchmark(config)

        assert benchmark.config == config
        assert benchmark._model is None
        assert benchmark._tasks == []
        assert tmp_path.exists()

    def test_load_model_missing_mteb(self, tmp_path: Path) -> None:
        """Test error when mteb is not installed."""
        config = MTEBConfig(model_name="test-model", output_folder=tmp_path)
        benchmark = MTEBBenchmark(config)

        with (
            patch.dict("sys.modules", {"mteb": None}),
            pytest.raises(ImportError, match="mteb is not installed"),
        ):
            benchmark._load_model()

    def test_load_tasks_missing_mteb(self, tmp_path: Path) -> None:
        """Test error when mteb is not installed."""
        config = MTEBConfig(model_name="test-model", output_folder=tmp_path)
        benchmark = MTEBBenchmark(config)

        with (
            patch.dict("sys.modules", {"mteb": None}),
            pytest.raises(ImportError, match="mteb is not installed"),
        ):
            benchmark._load_tasks()

    def test_load_model(self, tmp_path: Path) -> None:
        """Test model loading."""
        mock_mteb_module = MagicMock()
        mock_model = MagicMock()
        mock_mteb_module.get_model.return_value = mock_model

        with patch.dict("sys.modules", {"mteb": mock_mteb_module}):
            config = MTEBConfig(model_name="test-model", output_folder=tmp_path, device="cuda")
            benchmark = MTEBBenchmark(config)
            model = benchmark._load_model()

            assert model == mock_model
            mock_mteb_module.get_model.assert_called_once_with("test-model", device="cuda")

    def test_load_tasks(self, tmp_path: Path) -> None:
        """Test task loading."""
        mock_mteb_module = MagicMock()
        mock_tasks = [MagicMock(), MagicMock()]
        mock_mteb_module.get_tasks.return_value = mock_tasks

        with patch.dict("sys.modules", {"mteb": mock_mteb_module}):
            config = MTEBConfig(
                model_name="test-model",
                tasks=["Task1", "Task2"],
                languages=["en", "es"],
                output_folder=tmp_path,
            )
            benchmark = MTEBBenchmark(config)
            tasks = benchmark._load_tasks()

            assert tasks == mock_tasks
            mock_mteb_module.get_tasks.assert_called_once_with(
                tasks=["Task1", "Task2"], languages=["en", "es"]
            )

    def test_run(self, tmp_path: Path) -> None:
        """Test running MTEB evaluation."""
        mock_mteb_module = MagicMock()

        # Mock model
        mock_model = MagicMock()
        mock_mteb_module.get_model.return_value = mock_model

        # Mock tasks
        mock_task1 = MagicMock()
        mock_task1.task_name = "Task1"
        mock_task1.get_main_score.return_value = 0.85
        mock_task1.scores = {"accuracy": 0.87}

        mock_task2 = MagicMock()
        mock_task2.task_name = "Task2"
        mock_task2.get_main_score.return_value = 0.90
        mock_task2.scores = {"f1": 0.92}

        mock_mteb_module.get_tasks.return_value = [mock_task1, mock_task2]

        # Mock MTEB evaluation
        mock_evaluation = MagicMock()
        mock_evaluation.run.return_value = [mock_task1, mock_task2]
        mock_mteb_module.MTEB.return_value = mock_evaluation

        with patch.dict("sys.modules", {"mteb": mock_mteb_module}):
            config = MTEBConfig(
                model_name="test-model",
                tasks=["Task1", "Task2"],
                output_folder=tmp_path,
                batch_size=64,
            )
            benchmark = MTEBBenchmark(config)
            results = benchmark.run()

            # Verify results
            assert results.model_name == "test-model"
            assert results.tasks == ["Task1", "Task2"]
            assert "Task1" in results.scores
            assert "Task2" in results.scores
            assert results.scores["Task1"]["main_score"] == 0.85
            assert results.scores["Task2"]["main_score"] == 0.90
            assert results.metadata["batch_size"] == 64

            # Verify MTEB was called correctly
            mock_mteb_module.MTEB.assert_called_once_with(
                tasks=[mock_task1, mock_task2], task_langs=["en"]
            )
            mock_evaluation.run.assert_called_once()

    def test_get_available_tasks(self) -> None:
        """Test getting available tasks."""
        mock_mteb_module = MagicMock()
        mock_task1 = MagicMock()
        mock_task1.metadata.name = "Task1"
        mock_task1.metadata.type = "Classification"

        mock_task2 = MagicMock()
        mock_task2.metadata.name = "Task2"
        mock_task2.metadata.type = "Retrieval"

        mock_mteb_module.get_tasks.return_value = [mock_task1, mock_task2]

        with patch.dict("sys.modules", {"mteb": mock_mteb_module}):
            tasks = MTEBBenchmark.get_available_tasks()
            assert tasks == ["Task1", "Task2"]

    def test_get_available_tasks_filtered(self) -> None:
        """Test getting available tasks with type filter."""
        mock_mteb_module = MagicMock()
        mock_task1 = MagicMock()
        mock_task1.metadata.name = "Task1"
        mock_task1.metadata.type = "Classification"

        mock_task2 = MagicMock()
        mock_task2.metadata.name = "Task2"
        mock_task2.metadata.type = "Retrieval"

        mock_mteb_module.get_tasks.return_value = [mock_task1, mock_task2]

        with patch.dict("sys.modules", {"mteb": mock_mteb_module}):
            tasks = MTEBBenchmark.get_available_tasks(task_type="Classification")
            assert tasks == ["Task1"]

    def test_get_task_types(self) -> None:
        """Test getting task types."""
        mock_mteb_module = MagicMock()
        mock_task1 = MagicMock()
        mock_task1.metadata.type = "Classification"

        mock_task2 = MagicMock()
        mock_task2.metadata.type = "Retrieval"

        mock_task3 = MagicMock()
        mock_task3.metadata.type = "Classification"  # Duplicate

        mock_mteb_module.get_tasks.return_value = [mock_task1, mock_task2, mock_task3]

        with patch.dict("sys.modules", {"mteb": mock_mteb_module}):
            task_types = MTEBBenchmark.get_task_types()
            assert sorted(task_types) == ["Classification", "Retrieval"]
