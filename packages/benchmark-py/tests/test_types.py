"""
Tests for LongMemEval type models.
"""

import pytest
from pydantic import ValidationError

from engram_benchmark.longmemeval.types import (
    LongMemEvalInstance,
    QuestionType,
    Turn,
    get_memory_ability,
)


class TestTurn:
    """Tests for Turn model."""

    def test_valid_turn(self) -> None:
        """Test creating a valid turn."""
        turn = Turn(
            role="user",
            content="What is the capital of France?",
            has_answer=True,
        )

        assert turn.role == "user"
        assert turn.content == "What is the capital of France?"
        assert turn.has_answer is True

    def test_turn_without_has_answer(self) -> None:
        """Test creating a turn without has_answer field."""
        turn = Turn(
            role="assistant",
            content="The capital of France is Paris.",
        )

        assert turn.role == "assistant"
        assert turn.has_answer is None

    def test_invalid_role(self) -> None:
        """Test that invalid role is rejected."""
        with pytest.raises(ValidationError):
            Turn(
                role="invalid",  # type: ignore
                content="Test",
            )

    def test_turn_is_frozen(self) -> None:
        """Test that Turn instances are immutable."""
        turn = Turn(role="user", content="Test")

        with pytest.raises(ValidationError):
            turn.role = "assistant"  # type: ignore


class TestLongMemEvalInstance:
    """Tests for LongMemEvalInstance model."""

    def test_valid_instance(self, sample_instance: dict) -> None:
        """Test creating a valid instance."""
        instance = LongMemEvalInstance(**sample_instance)

        assert instance.question_id == "test_001"
        assert instance.question_type == QuestionType.SINGLE_SESSION_USER
        assert instance.question == "What is the capital of France?"
        assert instance.answer == "Paris"

    def test_numeric_answer_coercion(self) -> None:
        """Test that numeric answers are coerced to strings."""
        instance_data = {
            "question_id": "test_001",
            "question_type": "single-session-user",
            "question": "How many?",
            "answer": 42,  # Numeric
            "question_date": "2023/04/10 (Mon) 23:07",
            "haystack_dates": ["2023/04/10 (Mon) 17:50"],
            "haystack_session_ids": ["session_001"],
            "haystack_sessions": [[{"role": "user", "content": "Test"}]],
            "answer_session_ids": ["session_001"],
        }

        instance = LongMemEvalInstance(**instance_data)

        assert instance.answer == "42"
        assert isinstance(instance.answer, str)

    def test_float_answer_coercion(self) -> None:
        """Test that float answers are coerced to strings."""
        instance_data = {
            "question_id": "test_001",
            "question_type": "single-session-user",
            "question": "What is pi?",
            "answer": 3.14159,  # Float
            "question_date": "2023/04/10 (Mon) 23:07",
            "haystack_dates": ["2023/04/10 (Mon) 17:50"],
            "haystack_session_ids": ["session_001"],
            "haystack_sessions": [[{"role": "user", "content": "Test"}]],
            "answer_session_ids": ["session_001"],
        }

        instance = LongMemEvalInstance(**instance_data)

        assert instance.answer == "3.14159"
        assert isinstance(instance.answer, str)

    def test_missing_required_field(self) -> None:
        """Test that missing required fields raise validation error."""
        with pytest.raises(ValidationError):
            LongMemEvalInstance(
                question_id="test_001",
                # Missing other required fields
            )

    def test_invalid_question_type(self, sample_instance: dict) -> None:
        """Test that invalid question_type is rejected."""
        sample_instance["question_type"] = "invalid-type"

        with pytest.raises(ValidationError):
            LongMemEvalInstance(**sample_instance)

    def test_extra_fields_rejected(self, sample_instance: dict) -> None:
        """Test that extra fields are rejected in strict mode."""
        sample_instance["extra_field"] = "not allowed"

        with pytest.raises(ValidationError):
            LongMemEvalInstance(**sample_instance)


class TestGetMemoryAbility:
    """Tests for get_memory_ability function."""

    def test_abstention_detection(self) -> None:
        """Test that _abs suffix triggers abstention."""
        ability = get_memory_ability(
            QuestionType.SINGLE_SESSION_USER,
            "test_001_abs",
        )

        assert ability == "ABS"

    def test_single_session_user_maps_to_ie(self) -> None:
        """Test single-session-user maps to IE."""
        ability = get_memory_ability(
            QuestionType.SINGLE_SESSION_USER,
            "test_001",
        )

        assert ability == "IE"

    def test_single_session_assistant_maps_to_ie(self) -> None:
        """Test single-session-assistant maps to IE."""
        ability = get_memory_ability(
            QuestionType.SINGLE_SESSION_ASSISTANT,
            "test_001",
        )

        assert ability == "IE"

    def test_single_session_preference_maps_to_ie(self) -> None:
        """Test single-session-preference maps to IE."""
        ability = get_memory_ability(
            QuestionType.SINGLE_SESSION_PREFERENCE,
            "test_001",
        )

        assert ability == "IE"

    def test_multi_session_maps_to_mr(self) -> None:
        """Test multi-session maps to MR."""
        ability = get_memory_ability(
            QuestionType.MULTI_SESSION,
            "test_001",
        )

        assert ability == "MR"

    def test_temporal_reasoning_maps_to_tr(self) -> None:
        """Test temporal-reasoning maps to TR."""
        ability = get_memory_ability(
            QuestionType.TEMPORAL_REASONING,
            "test_001",
        )

        assert ability == "TR"

    def test_knowledge_update_maps_to_ku(self) -> None:
        """Test knowledge-update maps to KU."""
        ability = get_memory_ability(
            QuestionType.KNOWLEDGE_UPDATE,
            "test_001",
        )

        assert ability == "KU"

    def test_abstention_overrides_question_type(self) -> None:
        """Test that _abs suffix overrides question type mapping."""
        # Even for multi-session, _abs should return ABS
        ability = get_memory_ability(
            QuestionType.MULTI_SESSION,
            "test_001_abs",
        )

        assert ability == "ABS"
