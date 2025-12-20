"""Tests for temporal query enhancement."""

from datetime import datetime

import pytest

from engram_benchmark.longmemeval.temporal import TemporalQueryEnhancer, enhance_queries_batch
from engram_benchmark.longmemeval.types import (
    ParsedInstance,
    ParsedSession,
    ParsedTurn,
    QuestionType,
)


@pytest.fixture
def parsed_instance_with_temporal() -> ParsedInstance:
    """Create a parsed instance with temporal references."""
    return ParsedInstance(
        question_id="test_temp1",
        question_type=QuestionType.TEMPORAL_REASONING,
        memory_ability="TR",
        question="What did I discuss last week?",
        answer="Project planning",
        question_date=datetime(2024, 1, 15),
        sessions=[
            ParsedSession(
                session_id="session_1",
                timestamp=datetime(2024, 1, 8),
                turns=[
                    ParsedTurn(
                        role="user",
                        content="Let's discuss the project",
                        has_answer=True,
                        sequence_index=0,
                    )
                ],
            )
        ],
        answer_session_ids=["session_1"],
        is_abstention=False,
    )


def test_temporal_query_enhancer_initialization() -> None:
    """Test TemporalQueryEnhancer initialization."""
    enhancer = TemporalQueryEnhancer()
    assert enhancer.reference_date is None

    ref_date = datetime(2024, 1, 15)
    enhancer = TemporalQueryEnhancer(reference_date=ref_date)
    assert enhancer.reference_date == ref_date


def test_enhance_query_with_relative_date(parsed_instance_with_temporal: ParsedInstance) -> None:
    """Test enhancing query with relative date."""
    enhancer = TemporalQueryEnhancer()
    result = enhancer.enhance_query(parsed_instance_with_temporal)

    assert result.question_id == "test_temp1"
    assert result.original_query == "What did I discuss last week?"
    assert len(result.temporal_refs) > 0

    # Should detect "last week"
    ref = result.temporal_refs[0]
    assert "last week" in ref.text.lower()
    assert ref.type == "relative"


def test_enhance_query_no_temporal_refs() -> None:
    """Test enhancing query without temporal references."""
    instance = ParsedInstance(
        question_id="test_no_temp",
        question_type=QuestionType.SINGLE_SESSION_USER,
        memory_ability="IE",
        question="What is the capital of France?",
        answer="Paris",
        question_date=datetime(2024, 1, 15),
        sessions=[],
        answer_session_ids=[],
        is_abstention=False,
    )

    enhancer = TemporalQueryEnhancer()
    result = enhancer.enhance_query(instance)

    assert result.temporal_refs == []
    assert result.time_filter is None
    assert result.enhanced_query is None


def test_enhance_queries_batch(parsed_instance_with_temporal: ParsedInstance) -> None:
    """Test batch query enhancement."""
    instances = [parsed_instance_with_temporal, parsed_instance_with_temporal]
    results = enhance_queries_batch(instances)

    assert len(results) == 2
    assert all(r.question_id == "test_temp1" for r in results)


def test_temporal_patterns() -> None:
    """Test detection of various temporal patterns."""
    test_cases = [
        ("What happened yesterday?", "relative"),
        ("Show me data from 2024-01-15", "absolute"),
        ("What did I do in the last 7 days?", "duration"),
        ("Tell me about next week", "relative"),
        ("Information from January 15, 2024", "absolute"),
    ]

    enhancer = TemporalQueryEnhancer(reference_date=datetime(2024, 1, 20))

    for query_text, _expected_type in test_cases:
        instance = ParsedInstance(
            question_id="test",
            question_type=QuestionType.TEMPORAL_REASONING,
            memory_ability="TR",
            question=query_text,
            answer="test",
            question_date=datetime(2024, 1, 20),
            sessions=[],
            answer_session_ids=[],
            is_abstention=False,
        )

        result = enhancer.enhance_query(instance)

        # At least one temporal reference should be detected
        assert len(result.temporal_refs) > 0, f"No temporal ref detected in: {query_text}"
