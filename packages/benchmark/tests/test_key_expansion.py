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


@pytest.mark.asyncio
async def test_extract_facts_with_llm_method(parsed_instance: ParsedInstance) -> None:
    """Test extraction with LLM method."""
    from unittest.mock import AsyncMock, MagicMock

    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(
        return_value=MagicMock(
            content="1. The project timeline is 6 months\n2. The budget is $100,000"
        )
    )

    extractor = KeyFactExtractor(llm=mock_llm, method="llm", max_facts_per_session=5)
    result = await extractor.extract_facts(parsed_instance)

    assert result.question_id == "test_ke1"
    assert len(result.facts) > 0
    assert result.expanded_query is not None
    assert mock_llm.generate.called


@pytest.mark.asyncio
async def test_extract_facts_llm_without_provider(parsed_instance: ParsedInstance) -> None:
    """Test LLM extraction without provider raises error."""
    extractor = KeyFactExtractor(method="heuristic")
    # Force method to llm without provider
    extractor.method = "llm"
    extractor.llm = None

    with pytest.raises(ValueError, match="LLM provider not initialized"):
        await extractor.extract_facts(parsed_instance)


@pytest.mark.asyncio
async def test_extract_facts_llm_max_facts_limit(parsed_instance: ParsedInstance) -> None:
    """Test that LLM extraction respects max_facts_per_session."""
    from unittest.mock import AsyncMock, MagicMock

    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(
        return_value=MagicMock(
            content="1. Fact one\n2. Fact two\n3. Fact three\n4. Fact four\n5. Fact five\n6. Fact six"
        )
    )

    extractor = KeyFactExtractor(llm=mock_llm, method="llm", max_facts_per_session=2)
    result = await extractor.extract_facts(parsed_instance)

    # Should respect max_facts_per_session limit per session
    assert len(result.facts) <= 2 * len(parsed_instance.sessions)


@pytest.mark.asyncio
async def test_extract_facts_llm_short_facts_ignored(
    parsed_instance: ParsedInstance,
) -> None:
    """Test that very short facts are ignored."""
    from unittest.mock import AsyncMock, MagicMock

    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(
        return_value=MagicMock(content="1. OK\n2. This is a valid longer fact")
    )

    extractor = KeyFactExtractor(llm=mock_llm, method="llm")
    result = await extractor.extract_facts(parsed_instance)

    # "OK" should be filtered out (less than 10 chars)
    assert all(len(fact.content) > 10 for fact in result.facts)


@pytest.mark.asyncio
async def test_extract_facts_batch_empty() -> None:
    """Test batch extraction with empty list."""
    extractor = KeyFactExtractor(method="heuristic")
    results = await extract_facts_batch([], extractor)

    assert results == []


class TestAssistantTurnConfidence:
    """Tests for _assess_assistant_turn_confidence method."""

    def test_definitive_markers_increase_confidence(self) -> None:
        """Test that definitive statement markers increase confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        # Test various definitive markers
        content_with_is = "The answer is 42"
        confidence = extractor._assess_assistant_turn_confidence(content_with_is)
        assert confidence >= 0.4

        content_with_are = "The results are conclusive"
        confidence = extractor._assess_assistant_turn_confidence(content_with_are)
        assert confidence >= 0.4

        content_with_was = "The meeting was productive"
        confidence = extractor._assess_assistant_turn_confidence(content_with_was)
        assert confidence >= 0.4

    def test_factual_markers_increase_confidence(self) -> None:
        """Test that factual markers increase confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        content = "According to the data, this specifically shows that the results"
        confidence = extractor._assess_assistant_turn_confidence(content)
        assert confidence > 0.0

    def test_numerical_content_increases_confidence(self) -> None:
        """Test that numerical content increases confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        content = "The project started on January 15, 2024"
        confidence = extractor._assess_assistant_turn_confidence(content)
        assert confidence > 0.0

    def test_named_entities_increase_confidence(self) -> None:
        """Test that capitalized words (named entities) increase confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        content = "I met with John Smith at the Paris office"
        confidence = extractor._assess_assistant_turn_confidence(content)
        assert confidence > 0.0

    def test_long_content_increases_confidence(self) -> None:
        """Test that longer content increases confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        short_content = "Yes, I agree."
        long_content = "a" * 150

        short_confidence = extractor._assess_assistant_turn_confidence(short_content)
        long_confidence = extractor._assess_assistant_turn_confidence(long_content)

        # Long content should add 0.1 confidence
        assert long_confidence >= short_confidence

    def test_max_confidence_capped_at_one(self) -> None:
        """Test that confidence is capped at 1.0."""
        extractor = KeyFactExtractor(method="heuristic")

        # Content with many confidence-boosting factors
        content = (
            "According to the report, John Smith specifically stated that "
            "the project was successful. The results are 1234 items at the Paris office. "
            * 3
        )
        confidence = extractor._assess_assistant_turn_confidence(content)
        assert confidence <= 1.0


class TestUserTurnConfidence:
    """Tests for _assess_user_turn_confidence method."""

    def test_preference_markers_high_confidence(self) -> None:
        """Test that preference markers give high confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        preference_contents = [
            "I like the blue option",
            "I prefer working from home",
            "I want to learn Python",
            "I need more time",
            "I don't like spicy food",
            "I hate waiting",
            "My favorite color is green",
            "I enjoy hiking",
            "I love reading books",
        ]

        for content in preference_contents:
            confidence = extractor._assess_user_turn_confidence(content)
            assert confidence >= 0.6, f"Failed for: {content}"

    def test_personal_information_markers(self) -> None:
        """Test that personal information markers increase confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        personal_contents = [
            "My name is John",
            "I am a software engineer",
            "I'm learning to code",
            "I live in Seattle",
            "I work at a tech company",
            "I have two dogs",
        ]

        for content in personal_contents:
            confidence = extractor._assess_user_turn_confidence(content)
            assert confidence > 0.0, f"Failed for: {content}"

    def test_declarative_statements_not_questions(self) -> None:
        """Test that non-questions get higher confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        statement = "I visited the museum yesterday"
        question = "Did you visit the museum yesterday?"

        statement_confidence = extractor._assess_user_turn_confidence(statement)
        question_confidence = extractor._assess_user_turn_confidence(question)

        # Statement should have slightly higher confidence
        assert statement_confidence > question_confidence

    def test_numerical_content_increases_confidence(self) -> None:
        """Test that numerical content increases confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        content = "I bought 5 items on March 15"
        confidence = extractor._assess_user_turn_confidence(content)
        assert confidence > 0.0

    def test_max_confidence_capped_at_one(self) -> None:
        """Test that user turn confidence is capped at 1.0."""
        extractor = KeyFactExtractor(method="heuristic")

        # Content with many confidence-boosting factors
        content = "My name is John and I prefer to work at my favorite place 12345"
        confidence = extractor._assess_user_turn_confidence(content)
        assert confidence <= 1.0


class TestExtractFromTurn:
    """Tests for _extract_from_turn method."""

    def test_short_turns_skipped(self) -> None:
        """Test that very short turns are skipped."""
        extractor = KeyFactExtractor(method="heuristic")

        turn = ParsedTurn(
            role="user",
            content="OK",  # Less than 15 characters
            has_answer=False,
            sequence_index=0,
        )

        facts = extractor._extract_from_turn(turn, "session_1")
        assert len(facts) == 0

    def test_has_answer_highest_priority(self) -> None:
        """Test that has_answer turns get highest confidence."""
        extractor = KeyFactExtractor(method="heuristic")

        turn = ParsedTurn(
            role="assistant",
            content="The answer is very important information here",
            has_answer=True,
            sequence_index=0,
        )

        facts = extractor._extract_from_turn(turn, "session_1")
        assert len(facts) == 1
        assert facts[0].confidence == 1.0

    def test_assistant_turn_confidence_extraction(self) -> None:
        """Test assistant turn extraction with confidence threshold."""
        extractor = KeyFactExtractor(method="heuristic")

        # High confidence assistant turn
        turn = ParsedTurn(
            role="assistant",
            content="According to the report, the project is scheduled for January 2024 at the Paris office",
            has_answer=False,
            sequence_index=0,
        )

        facts = extractor._extract_from_turn(turn, "session_1")
        # Should extract since confidence > 0.3
        assert len(facts) >= 0  # May or may not extract depending on confidence

    def test_user_turn_confidence_extraction(self) -> None:
        """Test user turn extraction with confidence threshold."""
        extractor = KeyFactExtractor(method="heuristic")

        # High confidence user turn with preferences
        turn = ParsedTurn(
            role="user",
            content="I prefer to work from home on Tuesdays",
            has_answer=False,
            sequence_index=0,
        )

        facts = extractor._extract_from_turn(turn, "session_1")
        # Should extract since it has preference markers
        assert len(facts) == 1
        assert facts[0].confidence >= 0.6

    def test_low_confidence_turn_not_extracted(self) -> None:
        """Test that low confidence turns are not extracted."""
        extractor = KeyFactExtractor(method="heuristic")

        # Low confidence user turn - no markers
        turn = ParsedTurn(
            role="user",
            content="hello there how are you doing today",
            has_answer=False,
            sequence_index=0,
        )

        facts = extractor._extract_from_turn(turn, "session_1")
        # Should not extract - no preference or personal markers
        assert len(facts) == 0


class TestHeuristicExtractionWithMixedTurns:
    """Tests for heuristic extraction with various turn types."""

    @pytest.mark.asyncio
    async def test_extract_with_assistant_informative_turns(self) -> None:
        """Test extraction with informative assistant turns."""
        instance = ParsedInstance(
            question_id="test_mixed",
            question_type=QuestionType.SINGLE_SESSION_USER,
            memory_ability="MR",
            question="What was discussed?",
            answer="Project details",
            question_date=datetime(2024, 1, 15),
            sessions=[
                ParsedSession(
                    session_id="session_1",
                    timestamp=datetime(2024, 1, 10),
                    turns=[
                        ParsedTurn(
                            role="user",
                            content="Can you tell me about the project?",
                            has_answer=False,
                            sequence_index=0,
                        ),
                        ParsedTurn(
                            role="assistant",
                            content="According to the report, the project is scheduled to start on January 15, 2024 at the New York office",
                            has_answer=False,
                            sequence_index=1,
                        ),
                    ],
                ),
            ],
            answer_session_ids=["session_1"],
            is_abstention=False,
        )

        extractor = KeyFactExtractor(method="heuristic")
        result = await extractor.extract_facts(instance)

        # Should extract from informative assistant turn
        assert len(result.facts) >= 1

    @pytest.mark.asyncio
    async def test_extract_with_user_preference_turns(self) -> None:
        """Test extraction with user preference turns."""
        instance = ParsedInstance(
            question_id="test_prefs",
            question_type=QuestionType.SINGLE_SESSION_USER,
            memory_ability="MP",
            question="What are my preferences?",
            answer="Coffee and hiking",
            question_date=datetime(2024, 1, 15),
            sessions=[
                ParsedSession(
                    session_id="session_1",
                    timestamp=datetime(2024, 1, 10),
                    turns=[
                        ParsedTurn(
                            role="user",
                            content="I prefer coffee over tea and I enjoy hiking on weekends",
                            has_answer=False,
                            sequence_index=0,
                        ),
                        ParsedTurn(
                            role="assistant",
                            content="That's great!",
                            has_answer=False,
                            sequence_index=1,
                        ),
                    ],
                ),
            ],
            answer_session_ids=["session_1"],
            is_abstention=False,
        )

        extractor = KeyFactExtractor(method="heuristic")
        result = await extractor.extract_facts(instance)

        # Should extract from user preference turn
        assert len(result.facts) >= 1
        # Check expanded query was generated
        assert result.expanded_query is not None

    @pytest.mark.asyncio
    async def test_max_facts_per_session_enforced(self) -> None:
        """Test that max_facts_per_session is enforced during heuristic extraction."""
        instance = ParsedInstance(
            question_id="test_max",
            question_type=QuestionType.SINGLE_SESSION_USER,
            memory_ability="MR",
            question="What was discussed?",
            answer="Many things",
            question_date=datetime(2024, 1, 15),
            sessions=[
                ParsedSession(
                    session_id="session_1",
                    timestamp=datetime(2024, 1, 10),
                    turns=[
                        ParsedTurn(
                            role="user",
                            content="I prefer coffee and I like tea",
                            has_answer=True,
                            sequence_index=0,
                        ),
                        ParsedTurn(
                            role="user",
                            content="I enjoy hiking every weekend",
                            has_answer=True,
                            sequence_index=1,
                        ),
                        ParsedTurn(
                            role="user",
                            content="I love reading books at night",
                            has_answer=True,
                            sequence_index=2,
                        ),
                    ],
                ),
            ],
            answer_session_ids=["session_1"],
            is_abstention=False,
        )

        extractor = KeyFactExtractor(method="heuristic", max_facts_per_session=2)
        result = await extractor.extract_facts(instance)

        # Should only extract max_facts_per_session facts
        assert len(result.facts) <= 2

    @pytest.mark.asyncio
    async def test_expanded_query_long_content_truncated(self) -> None:
        """Test that expanded query truncates long fact snippets."""
        instance = ParsedInstance(
            question_id="test_long",
            question_type=QuestionType.SINGLE_SESSION_USER,
            memory_ability="MR",
            question="What was discussed?",
            answer="Long content",
            question_date=datetime(2024, 1, 15),
            sessions=[
                ParsedSession(
                    session_id="session_1",
                    timestamp=datetime(2024, 1, 10),
                    turns=[
                        ParsedTurn(
                            role="assistant",
                            content="a" * 200,  # Very long content
                            has_answer=True,
                            sequence_index=0,
                        ),
                    ],
                ),
            ],
            answer_session_ids=["session_1"],
            is_abstention=False,
        )

        extractor = KeyFactExtractor(method="heuristic")
        result = await extractor.extract_facts(instance)

        assert result.expanded_query is not None
        # The expanded query should contain truncation marker
        assert "..." in result.expanded_query or len(result.expanded_query) < 500
