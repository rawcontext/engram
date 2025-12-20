"""
Tests for the LongMemEval dataset loader.
"""

from pathlib import Path

import pytest

from engram_benchmark.longmemeval.loader import (
    DatasetValidationError,
    load_dataset,
    validate_dataset,
)
from engram_benchmark.longmemeval.types import LongMemEvalInstance, QuestionType


class TestLoadDataset:
    """Tests for load_dataset function."""

    def test_load_valid_dataset(self, sample_dataset_file: Path) -> None:
        """Test loading a valid dataset."""
        dataset = load_dataset(sample_dataset_file)

        assert len(dataset) == 2
        assert all(isinstance(instance, LongMemEvalInstance) for instance in dataset)

    def test_load_with_limit(self, sample_dataset_file: Path) -> None:
        """Test loading dataset with limit."""
        dataset = load_dataset(sample_dataset_file, limit=1)

        assert len(dataset) == 1

    def test_load_nonexistent_file(self, tmp_path: Path) -> None:
        """Test loading a file that doesn't exist."""
        nonexistent = tmp_path / "nonexistent.json"

        with pytest.raises(FileNotFoundError):
            load_dataset(nonexistent)

    def test_load_malformed_json(self, malformed_json_file: Path) -> None:
        """Test loading a malformed JSON file."""
        with pytest.raises(DatasetValidationError, match="Invalid JSON"):
            load_dataset(malformed_json_file)

    def test_load_invalid_dataset(self, invalid_dataset_file: Path) -> None:
        """Test loading an invalid dataset (missing required fields)."""
        with pytest.raises(DatasetValidationError, match="validation failed"):
            load_dataset(invalid_dataset_file)

    def test_load_without_validation(self, sample_dataset_file: Path) -> None:
        """Test loading without validation (should still parse)."""
        dataset = load_dataset(sample_dataset_file, validate=False)

        assert len(dataset) == 2

    def test_numeric_answer_coercion(self, tmp_path: Path, numeric_answer_instance: dict) -> None:
        """Test that numeric answers are coerced to strings."""
        dataset_file = tmp_path / "numeric_answer.json"
        import json

        with open(dataset_file, "w", encoding="utf-8") as f:
            json.dump([numeric_answer_instance], f)

        dataset = load_dataset(dataset_file)

        assert len(dataset) == 1
        assert dataset[0].answer == "42"  # Should be string
        assert isinstance(dataset[0].answer, str)


class TestValidateDataset:
    """Tests for validate_dataset function."""

    def test_validate_valid_dataset(self, sample_dataset_file: Path) -> None:
        """Test validating a valid dataset."""
        is_valid, stats = validate_dataset(sample_dataset_file)

        assert is_valid is True
        assert stats["total"] == 2
        assert "qt_single-session-user" in stats
        assert "ability_IE" in stats

    def test_validate_invalid_dataset(self, invalid_dataset_file: Path) -> None:
        """Test validating an invalid dataset."""
        is_valid, stats = validate_dataset(invalid_dataset_file)

        assert is_valid is False
        assert stats == {}

    def test_validate_nonexistent_file(self, tmp_path: Path) -> None:
        """Test validating a file that doesn't exist."""
        nonexistent = tmp_path / "nonexistent.json"

        is_valid, stats = validate_dataset(nonexistent)

        assert is_valid is False
        assert stats == {}


class TestDatasetStatistics:
    """Tests for dataset statistics computation."""

    def test_question_type_counts(self, sample_dataset_file: Path) -> None:
        """Test that question types are counted correctly."""
        _, stats = validate_dataset(sample_dataset_file)

        assert stats["qt_single-session-user"] == 2
        assert stats["qt_multi-session"] == 0

    def test_memory_ability_counts(self, sample_dataset_file: Path) -> None:
        """Test that memory abilities are counted correctly."""
        _, stats = validate_dataset(sample_dataset_file)

        # One regular IE, one abstention
        assert stats["ability_IE"] == 1
        assert stats["ability_ABS"] == 1
        assert stats["ability_MR"] == 0

    def test_all_question_types_present(self, tmp_path: Path) -> None:
        """Test statistics with all question types."""
        import json

        instances = []
        for i, qt in enumerate(QuestionType):
            instances.append(
                {
                    "question_id": f"test_{i}",
                    "question_type": qt.value,
                    "question": "Test question",
                    "answer": "Test answer",
                    "question_date": "2023/04/10 (Mon) 23:07",
                    "haystack_dates": ["2023/04/10 (Mon) 17:50"],
                    "haystack_session_ids": ["session_001"],
                    "haystack_sessions": [
                        [
                            {
                                "role": "user",
                                "content": "Test",
                                "has_answer": True,
                            }
                        ]
                    ],
                    "answer_session_ids": ["session_001"],
                }
            )

        dataset_file = tmp_path / "all_types.json"
        with open(dataset_file, "w", encoding="utf-8") as f:
            json.dump(instances, f)

        _, stats = validate_dataset(dataset_file)

        # Should have all question types
        assert stats["total"] == len(QuestionType)
        for qt in QuestionType:
            assert stats[f"qt_{qt.value}"] == 1
