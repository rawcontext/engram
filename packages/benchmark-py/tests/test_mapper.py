"""Tests for document mapper."""

import pytest

from engram_benchmark.longmemeval.mapper import DocumentMapper, map_batch, parse_batch
from engram_benchmark.longmemeval.types import (
    LongMemEvalInstance,
    QuestionType,
    Turn,
)


@pytest.fixture
def sample_instance() -> LongMemEvalInstance:
    """Create a sample LongMemEval instance."""
    return LongMemEvalInstance(
        question_id="test_q1",
        question_type=QuestionType.SINGLE_SESSION_USER,
        question="What is the capital of France?",
        answer="Paris",
        question_date="2024-01-15",
        haystack_session_ids=["session_1", "session_2"],
        haystack_dates=["2024-01-10", "2024-01-12"],
        haystack_sessions=[
            [
                Turn(role="user", content="Tell me about Paris", has_answer=True),
                Turn(role="assistant", content="Paris is the capital of France", has_answer=True),
            ],
            [
                Turn(role="user", content="What about London?", has_answer=False),
                Turn(role="assistant", content="London is the capital of UK", has_answer=False),
            ],
        ],
        answer_session_ids=["session_1"],
    )


def test_parse_instance(sample_instance: LongMemEvalInstance) -> None:
    """Test parsing a LongMemEval instance."""
    mapper = DocumentMapper()
    parsed = mapper.parse_instance(sample_instance)

    assert parsed.question_id == "test_q1"
    assert parsed.question == "What is the capital of France?"
    assert parsed.answer == "Paris"
    assert parsed.memory_ability == "IE"
    assert not parsed.is_abstention
    assert len(parsed.sessions) == 2

    # Check first session
    session1 = parsed.sessions[0]
    assert session1.session_id == "session_1"
    assert len(session1.turns) == 2
    assert session1.turns[0].role == "user"
    assert session1.turns[0].content == "Tell me about Paris"
    assert session1.turns[0].has_answer is True
    assert session1.turns[0].sequence_index == 0


def test_parse_abstention_instance(sample_instance: LongMemEvalInstance) -> None:
    """Test parsing an abstention instance."""
    sample_instance.question_id = "test_q1_abs"
    mapper = DocumentMapper()
    parsed = mapper.parse_instance(sample_instance)

    assert parsed.is_abstention is True
    assert parsed.memory_ability == "ABS"


def test_map_turn_level(sample_instance: LongMemEvalInstance) -> None:
    """Test mapping at turn-level granularity."""
    mapper = DocumentMapper(granularity="turn")
    parsed = mapper.parse_instance(sample_instance)
    documents = mapper.map_to_documents(parsed)

    # Should have 4 documents (2 sessions x 2 turns)
    assert len(documents) == 4

    # Check first document
    doc = documents[0]
    assert doc.doc_id == "test_q1_session_1_0"
    assert doc.content == "User: Tell me about Paris"
    assert doc.metadata["session_id"] == "session_1"
    assert doc.metadata["turn_index"] == 0
    assert doc.metadata["role"] == "user"
    assert doc.metadata["has_answer"] is True
    assert doc.metadata["question_type"] == "single-session-user"
    assert doc.metadata["memory_ability"] == "IE"


def test_map_session_level(sample_instance: LongMemEvalInstance) -> None:
    """Test mapping at session-level granularity."""
    mapper = DocumentMapper(granularity="session")
    parsed = mapper.parse_instance(sample_instance)
    documents = mapper.map_to_documents(parsed)

    # Should have 2 documents (one per session)
    assert len(documents) == 2

    # Check first document
    doc = documents[0]
    assert doc.doc_id == "test_q1_session_1"
    assert "User: Tell me about Paris" in doc.content
    assert "Assistant: Paris is the capital of France" in doc.content
    assert doc.metadata["session_id"] == "session_1"
    assert doc.metadata["turn_count"] == 2
    assert doc.metadata["has_answer"] is True

    # Check second document
    doc2 = documents[1]
    assert doc2.doc_id == "test_q1_session_2"
    assert doc2.metadata["has_answer"] is False


def test_parse_batch(sample_instance: LongMemEvalInstance) -> None:
    """Test batch parsing."""
    instances = [sample_instance, sample_instance]
    parsed = parse_batch(instances)

    assert len(parsed) == 2
    assert all(p.question_id == "test_q1" for p in parsed)


def test_map_batch(sample_instance: LongMemEvalInstance) -> None:
    """Test batch mapping."""
    mapper = DocumentMapper(granularity="turn")
    parsed = parse_batch([sample_instance, sample_instance], mapper)
    documents = map_batch(parsed, mapper)

    # 2 instances x 4 turns = 8 documents
    assert len(documents) == 8
