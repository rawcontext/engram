"""Tests for key fact extraction."""

from datetime import datetime

import pytest

from engram_benchmark.longmemeval.key_expansion import (
    KeyFactExtractor,
    extract_facts_batch,
)
from engram_benchmark.longmemeval.types import (
    ParsedInstance,
    ParsedSession,
    ParsedTurn,
    QuestionType,
)


@pytest.fixture
def parsed_instance() -> ParsedInstance:
    """Create a parsed instance for testing."""
    return ParsedInstance(
        question_id="test_ke1",
        question_type=QuestionType.MULTI_SESSION,
        memory_ability="MR",
        question="What are the key points from our meetings?",
        answer="Project timeline and budget",
        question_date=datetime(2024, 1, 15),
        sessions=[
            ParsedSession(
                session_id="session_1",
                timestamp=datetime(2024, 1, 10),
                turns=[
                    ParsedTurn(
                        role="user",
                        content="Let's discuss the project timeline",
                        has_answer=True,
                        sequence_index=0,
                    ),
                    ParsedTurn(
                        role="assistant",
                        content="The project will take 6 months",
                        has_answer=True,
                        sequence_index=1,
                    ),
                ],
            ),
            ParsedSession(
                session_id="session_2",
                timestamp=datetime(2024, 1, 12),
                turns=[
                    ParsedTurn(
                        role="user",
                        content="What about the budget?",
                        has_answer=True,
                        sequence_index=0,
                    ),
                    ParsedTurn(
                        role="assistant",
                        content="The budget is $100,000",
                        has_answer=True,
                        sequence_index=1,
                    ),
                ],
            ),
        ],
        answer_session_ids=["session_1", "session_2"],
        is_abstention=False,
    )


def test_key_fact_extractor_initialization() -> None:
    """Test KeyFactExtractor initialization."""
    extractor = KeyFactExtractor(method="heuristic")
    assert extractor.method == "heuristic"
    assert extractor.max_facts_per_session == 5

    extractor = KeyFactExtractor(method="none")
    assert extractor.method == "none"


def test_key_fact_extractor_requires_llm() -> None:
    """Test that LLM method requires LLM provider."""
    with pytest.raises(ValueError, match="LLM provider required"):
        KeyFactExtractor(method="llm", llm=None)


@pytest.mark.asyncio
async def test_extract_facts_none_method(parsed_instance: ParsedInstance) -> None:
    """Test extraction with 'none' method."""
    extractor = KeyFactExtractor(method="none")
    result = await extractor.extract_facts(parsed_instance)

    assert result.question_id == "test_ke1"
    assert result.original_query == "What are the key points from our meetings?"
    assert result.facts == []
    assert result.expanded_query is None


@pytest.mark.asyncio
async def test_extract_facts_heuristic_method(parsed_instance: ParsedInstance) -> None:
    """Test extraction with heuristic method."""
    extractor = KeyFactExtractor(method="heuristic")
    result = await extractor.extract_facts(parsed_instance)

    assert result.question_id == "test_ke1"
    assert len(result.facts) > 0

    # Should extract turns with has_answer=True
    assert all(fact.confidence == 1.0 for fact in result.facts)
    assert all(fact.session_id in ["session_1", "session_2"] for fact in result.facts)


@pytest.mark.asyncio
async def test_extract_facts_batch(parsed_instance: ParsedInstance) -> None:
    """Test batch fact extraction."""
    extractor = KeyFactExtractor(method="heuristic")
    instances = [parsed_instance, parsed_instance]

    results = await extract_facts_batch(instances, extractor)

    assert len(results) == 2
    assert all(r.question_id == "test_ke1" for r in results)


@pytest.mark.asyncio
async def test_extract_facts_empty_sessions() -> None:
    """Test extraction with no sessions."""
    instance = ParsedInstance(
        question_id="test_empty",
        question_type=QuestionType.SINGLE_SESSION_USER,
        memory_ability="IE",
        question="What is the answer?",
        answer="42",
        question_date=datetime.now(),
        sessions=[],
        answer_session_ids=[],
        is_abstention=False,
    )

    extractor = KeyFactExtractor(method="heuristic")
    result = await extractor.extract_facts(instance)

    assert result.facts == []
