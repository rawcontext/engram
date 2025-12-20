"""
Pytest configuration and fixtures for benchmark tests.
"""

import json
from pathlib import Path
from typing import Any

import pytest


@pytest.fixture
def sample_turn() -> dict[str, Any]:
    """Sample turn data."""
    return {
        "role": "user",
        "content": "What is the capital of France?",
        "has_answer": True,
    }


@pytest.fixture
def sample_session(sample_turn: dict[str, Any]) -> list[dict[str, Any]]:
    """Sample session with multiple turns."""
    return [
        sample_turn,
        {
            "role": "assistant",
            "content": "The capital of France is Paris.",
            "has_answer": False,
        },
    ]


@pytest.fixture
def sample_instance(sample_session: list[dict[str, Any]]) -> dict[str, Any]:
    """Sample LongMemEval instance."""
    return {
        "question_id": "test_001",
        "question_type": "single-session-user",
        "question": "What is the capital of France?",
        "answer": "Paris",
        "question_date": "2023/04/10 (Mon) 23:07",
        "haystack_dates": ["2023/04/10 (Mon) 17:50"],
        "haystack_session_ids": ["session_001"],
        "haystack_sessions": [sample_session],
        "answer_session_ids": ["session_001"],
    }


@pytest.fixture
def sample_abstention_instance(sample_session: list[dict[str, Any]]) -> dict[str, Any]:
    """Sample abstention instance (question_id ends with _abs)."""
    return {
        "question_id": "test_002_abs",
        "question_type": "single-session-user",
        "question": "What did I never tell you?",
        "answer": "ABSTAIN",
        "question_date": "2023/04/10 (Mon) 23:07",
        "haystack_dates": ["2023/04/10 (Mon) 17:50"],
        "haystack_session_ids": ["session_001"],
        "haystack_sessions": [sample_session],
        "answer_session_ids": [],
    }


@pytest.fixture
def sample_dataset(
    sample_instance: dict[str, Any],
    sample_abstention_instance: dict[str, Any],
) -> list[dict[str, Any]]:
    """Sample dataset with multiple instances."""
    return [sample_instance, sample_abstention_instance]


@pytest.fixture
def sample_dataset_file(tmp_path: Path, sample_dataset: list[dict[str, Any]]) -> Path:
    """Create a temporary dataset file."""
    dataset_file = tmp_path / "test_dataset.json"
    with open(dataset_file, "w", encoding="utf-8") as f:
        json.dump(sample_dataset, f)
    return dataset_file


@pytest.fixture
def invalid_dataset_file(tmp_path: Path) -> Path:
    """Create an invalid dataset file (missing required fields)."""
    dataset_file = tmp_path / "invalid_dataset.json"
    invalid_data = [
        {
            "question_id": "test_001",
            # Missing required fields
            "question": "What is the answer?",
        }
    ]
    with open(dataset_file, "w", encoding="utf-8") as f:
        json.dump(invalid_data, f)
    return dataset_file


@pytest.fixture
def malformed_json_file(tmp_path: Path) -> Path:
    """Create a malformed JSON file."""
    dataset_file = tmp_path / "malformed.json"
    with open(dataset_file, "w", encoding="utf-8") as f:
        f.write("{ this is not valid json }")
    return dataset_file


@pytest.fixture
def numeric_answer_instance(sample_session: list[dict[str, Any]]) -> dict[str, Any]:
    """Sample instance with numeric answer (tests coercion)."""
    return {
        "question_id": "test_003",
        "question_type": "single-session-user",
        "question": "How many items?",
        "answer": 42,  # Numeric answer, should be coerced to string
        "question_date": "2023/04/10 (Mon) 23:07",
        "haystack_dates": ["2023/04/10 (Mon) 17:50"],
        "haystack_session_ids": ["session_001"],
        "haystack_sessions": [sample_session],
        "answer_session_ids": ["session_001"],
    }
