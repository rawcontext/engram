"""
Tests for LongMemEvalReader and ChainOfNoteReader.

Tests answer generation, abstention detection, and context formatting.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from engram_benchmark.longmemeval.reader import LongMemEvalReader, LongMemEvalReaderOutput
from engram_benchmark.longmemeval.types import (
    ParsedInstance,
    ParsedSession,
    ParsedTurn,
    QuestionType,
)
from engram_benchmark.providers.llm import LiteLLMProvider, LLMResponse
from engram_benchmark.providers.reader import (
    ChainOfNoteOutput,
    ChainOfNoteReader,
    ContextNote,
    ReaderOutput,
)


@pytest.fixture
def mock_llm_provider() -> MagicMock:
    """Mock LiteLLMProvider."""
    provider = MagicMock(spec=LiteLLMProvider)
    provider.generate = AsyncMock(
        return_value=LLMResponse(
            content="Paris",
            model="gpt-4o",
            total_tokens=50,
            prompt_tokens=30,
            completion_tokens=20,
        )
    )
    provider.generate_structured = AsyncMock(
        return_value=ChainOfNoteOutput(
            notes=[
                ContextNote(
                    context_index=0,
                    is_relevant=True,
                    note="This context mentions Paris as the capital.",
                )
            ],
            answer="Paris",
            reasoning="The context clearly states that Paris is the capital of France.",
        )
    )
    return provider


@pytest.fixture
def sample_parsed_instance() -> ParsedInstance:
    """Create a sample parsed instance."""
    return ParsedInstance(
        question_id="test_001",
        question_type=QuestionType.SINGLE_SESSION_USER,
        memory_ability="IE",
        question="What is the capital of France?",
        answer="Paris",
        question_date=datetime(2023, 4, 10, 23, 7),
        sessions=[
            ParsedSession(
                session_id="session_001",
                timestamp=datetime(2023, 4, 10, 17, 50),
                turns=[
                    ParsedTurn(
                        role="user",
                        content="I love Paris.",
                        has_answer=True,
                        sequence_index=0,
                    ),
                    ParsedTurn(
                        role="assistant",
                        content="Paris is the capital of France.",
                        has_answer=True,
                        sequence_index=1,
                    ),
                ],
            )
        ],
        answer_session_ids=["session_001"],
        is_abstention=False,
    )


class TestChainOfNoteReader:
    """Test ChainOfNoteReader implementation."""

    def test_initialization(self, mock_llm_provider: MagicMock) -> None:
        """Test reader initialization."""
        reader = ChainOfNoteReader(mock_llm_provider, use_chain_of_note=True)
        assert reader.llm == mock_llm_provider
        assert reader.use_chain_of_note is True

    def test_initialization_without_chain_of_note(
        self, mock_llm_provider: MagicMock
    ) -> None:
        """Test reader initialization without Chain-of-Note."""
        reader = ChainOfNoteReader(mock_llm_provider, use_chain_of_note=False)
        assert reader.use_chain_of_note is False

    @pytest.mark.asyncio
    async def test_generate_answer_with_chain_of_note(
        self, mock_llm_provider: MagicMock
    ) -> None:
        """Test answer generation with Chain-of-Note."""
        reader = ChainOfNoteReader(mock_llm_provider, use_chain_of_note=True)

        result = await reader.generate_answer(
            question="What is the capital of France?",
            contexts=["Paris is the capital of France."],
        )

        assert isinstance(result, ReaderOutput)
        assert result.answer == "Paris"
        assert result.reasoning is not None
        assert "capital" in result.reasoning.lower()

        # Verify generate_structured was called
        mock_llm_provider.generate_structured.assert_called_once()

    @pytest.mark.asyncio
    async def test_generate_answer_simple_mode(
        self, mock_llm_provider: MagicMock
    ) -> None:
        """Test answer generation without Chain-of-Note."""
        reader = ChainOfNoteReader(mock_llm_provider, use_chain_of_note=False)

        result = await reader.generate_answer(
            question="What is the capital of France?",
            contexts=["Paris is the capital of France."],
        )

        assert isinstance(result, ReaderOutput)
        assert result.answer == "Paris"
        assert result.reasoning is None

        # Verify generate was called (not generate_structured)
        mock_llm_provider.generate.assert_called_once()
        mock_llm_provider.generate_structured.assert_not_called()

    @pytest.mark.asyncio
    async def test_generate_answer_no_contexts(
        self, mock_llm_provider: MagicMock
    ) -> None:
        """Test answer generation with no contexts (fallback to simple)."""
        reader = ChainOfNoteReader(mock_llm_provider, use_chain_of_note=True)

        result = await reader.generate_answer(
            question="What is the capital of France?",
            contexts=[],
        )

        # Should use simple mode when no contexts
        assert isinstance(result, ReaderOutput)
        mock_llm_provider.generate.assert_called_once()

    def test_format_chain_of_note_prompt(
        self, mock_llm_provider: MagicMock
    ) -> None:
        """Test Chain-of-Note prompt formatting."""
        reader = ChainOfNoteReader(mock_llm_provider, use_chain_of_note=True)

        prompt = reader._format_chain_of_note_prompt(
            question="What is the capital of France?",
            contexts=["Paris is the capital.", "France is in Europe."],
        )

        assert "What is the capital of France?" in prompt
        assert "[Context 0]" in prompt
        assert "[Context 1]" in prompt
        assert "Paris is the capital." in prompt
        assert "France is in Europe." in prompt
        assert "notes" in prompt
        assert "answer" in prompt
        assert "reasoning" in prompt

    def test_format_simple_prompt_with_contexts(
        self, mock_llm_provider: MagicMock
    ) -> None:
        """Test simple prompt formatting with contexts."""
        reader = ChainOfNoteReader(mock_llm_provider, use_chain_of_note=False)

        prompt = reader._format_simple_prompt(
            question="What is the capital of France?",
            contexts=["Paris is the capital.", "France is in Europe."],
        )

        assert "What is the capital of France?" in prompt
        assert "Context 1:" in prompt
        assert "Context 2:" in prompt
        assert "Paris is the capital." in prompt
        assert "France is in Europe." in prompt

    def test_format_simple_prompt_no_contexts(
        self, mock_llm_provider: MagicMock
    ) -> None:
        """Test simple prompt formatting without contexts."""
        reader = ChainOfNoteReader(mock_llm_provider, use_chain_of_note=False)

        prompt = reader._format_simple_prompt(
            question="What is the capital of France?",
            contexts=[],
        )

        assert "What is the capital of France?" in prompt
        assert "No context was provided" in prompt


class TestLongMemEvalReader:
    """Test LongMemEvalReader implementation."""

    def test_initialization(self, mock_llm_provider: MagicMock) -> None:
        """Test reader initialization."""
        reader = LongMemEvalReader(
            mock_llm_provider, use_chain_of_note=True, detect_abstention=True
        )

        assert reader.llm == mock_llm_provider
        assert reader.reader is not None
        assert reader.abstention_detector is not None

    def test_initialization_without_abstention_detection(
        self, mock_llm_provider: MagicMock
    ) -> None:
        """Test reader initialization without abstention detection."""
        reader = LongMemEvalReader(
            mock_llm_provider, use_chain_of_note=True, detect_abstention=False
        )

        assert reader.abstention_detector is None

    @pytest.mark.asyncio
    async def test_generate_answer(
        self, mock_llm_provider: MagicMock, sample_parsed_instance: ParsedInstance
    ) -> None:
        """Test answer generation."""
        reader = LongMemEvalReader(
            mock_llm_provider, use_chain_of_note=True, detect_abstention=False
        )

        result = await reader.generate_answer(
            instance=sample_parsed_instance,
            contexts=["Paris is the capital of France."],
        )

        assert isinstance(result, LongMemEvalReaderOutput)
        assert result.question_id == "test_001"
        assert result.answer == "Paris"
        assert result.is_abstention is False
        assert result.abstention_confidence is None
        assert len(result.contexts_used) == 1

    @pytest.mark.asyncio
    async def test_generate_answer_with_abstention_detection(
        self, mock_llm_provider: MagicMock, sample_parsed_instance: ParsedInstance
    ) -> None:
        """Test answer generation with abstention detection."""
        # Mock abstention detector
        from engram_benchmark.longmemeval.abstention import AbstentionResult

        reader = LongMemEvalReader(
            mock_llm_provider, use_chain_of_note=True, detect_abstention=True
        )

        # Mock detect method
        reader.abstention_detector.detect = AsyncMock(
            return_value=AbstentionResult(
                is_abstention=True,
                confidence=0.95,
                method="ensemble",
                keyword_match=True,
                llm_classification=True,
            )
        )

        # Mock reader to return abstention answer
        mock_llm_provider.generate_structured.return_value = ChainOfNoteOutput(
            notes=[
                ContextNote(
                    context_index=0,
                    is_relevant=False,
                    note="Context doesn't contain the answer.",
                )
            ],
            answer="I don't know",
            reasoning="No relevant information found.",
        )

        result = await reader.generate_answer(
            instance=sample_parsed_instance,
            contexts=["Some irrelevant context."],
        )

        assert result.is_abstention is True
        assert result.abstention_confidence == 0.95
        assert "don't know" in result.answer.lower()

    def test_format_contexts_from_sessions(
        self, mock_llm_provider: MagicMock, sample_parsed_instance: ParsedInstance
    ) -> None:
        """Test context formatting from sessions."""
        reader = LongMemEvalReader(
            mock_llm_provider, use_chain_of_note=True, detect_abstention=False
        )

        contexts = reader.format_contexts_from_sessions(sample_parsed_instance)

        # Should have 2 contexts (both turns have has_answer=True)
        assert len(contexts) == 2

        # Check format of first context
        assert "Session session_001" in contexts[0]
        assert "2023-04-10" in contexts[0]
        assert "Turn 0" in contexts[0]
        assert "User: I love Paris." in contexts[0]

        # Check format of second context
        assert "Session session_001" in contexts[1]
        assert "Turn 1" in contexts[1]
        assert "Assistant: Paris is the capital of France." in contexts[1]

    def test_format_contexts_from_sessions_no_answer_turns(
        self, mock_llm_provider: MagicMock
    ) -> None:
        """Test context formatting when no turns have answers."""
        reader = LongMemEvalReader(
            mock_llm_provider, use_chain_of_note=True, detect_abstention=False
        )

        instance = ParsedInstance(
            question_id="test_002",
            question_type=QuestionType.SINGLE_SESSION_USER,
            memory_ability="IE",
            question="What did I tell you?",
            answer="Nothing",
            question_date=datetime(2023, 4, 10, 23, 7),
            sessions=[
                ParsedSession(
                    session_id="session_001",
                    timestamp=datetime(2023, 4, 10, 17, 50),
                    turns=[
                        ParsedTurn(
                            role="user",
                            content="Hello!",
                            has_answer=False,
                            sequence_index=0,
                        ),
                    ],
                )
            ],
            answer_session_ids=[],
            is_abstention=False,
        )

        contexts = reader.format_contexts_from_sessions(instance)

        # No contexts should be returned (no turns with has_answer=True)
        assert len(contexts) == 0

    @pytest.mark.asyncio
    async def test_generate_answer_with_empty_contexts(
        self, mock_llm_provider: MagicMock, sample_parsed_instance: ParsedInstance
    ) -> None:
        """Test answer generation with empty contexts."""
        reader = LongMemEvalReader(
            mock_llm_provider, use_chain_of_note=True, detect_abstention=False
        )

        # Mock simple generation (no contexts means no Chain-of-Note)
        mock_llm_provider.generate.return_value = LLMResponse(
            content="I don't know",
            model="gpt-4o",
            total_tokens=20,
            prompt_tokens=10,
            completion_tokens=10,
        )

        result = await reader.generate_answer(
            instance=sample_parsed_instance,
            contexts=[],
        )

        assert result.answer == "I don't know"
        assert result.contexts_used == []


class TestReaderOutput:
    """Test ReaderOutput model."""

    def test_valid_output(self) -> None:
        """Test valid reader output."""
        output = ReaderOutput(
            answer="Paris",
            reasoning="Based on the context.",
            confidence=0.95,
        )

        assert output.answer == "Paris"
        assert output.reasoning == "Based on the context."
        assert output.confidence == 0.95

    def test_output_with_defaults(self) -> None:
        """Test reader output with default values."""
        output = ReaderOutput(answer="Paris")

        assert output.answer == "Paris"
        assert output.reasoning is None
        assert output.confidence is None


class TestLongMemEvalReaderOutput:
    """Test LongMemEvalReaderOutput model."""

    def test_valid_output(self) -> None:
        """Test valid reader output."""
        output = LongMemEvalReaderOutput(
            question_id="test_001",
            answer="Paris",
            reasoning="Based on the context.",
            is_abstention=False,
            abstention_confidence=0.1,
            contexts_used=["Paris is the capital."],
        )

        assert output.question_id == "test_001"
        assert output.answer == "Paris"
        assert output.is_abstention is False
        assert output.abstention_confidence == 0.1
        assert len(output.contexts_used) == 1

    def test_output_with_defaults(self) -> None:
        """Test output with default values."""
        output = LongMemEvalReaderOutput(
            question_id="test_001",
            answer="Paris",
        )

        assert output.reasoning is None
        assert output.is_abstention is False
        assert output.abstention_confidence is None
        assert output.contexts_used == []


class TestContextNote:
    """Test ContextNote model."""

    def test_valid_note(self) -> None:
        """Test valid context note."""
        note = ContextNote(
            context_index=0,
            is_relevant=True,
            note="This context is relevant because it mentions Paris.",
        )

        assert note.context_index == 0
        assert note.is_relevant is True
        assert "Paris" in note.note


class TestChainOfNoteOutput:
    """Test ChainOfNoteOutput model."""

    def test_valid_output(self) -> None:
        """Test valid Chain-of-Note output."""
        output = ChainOfNoteOutput(
            notes=[
                ContextNote(
                    context_index=0,
                    is_relevant=True,
                    note="Relevant context.",
                ),
                ContextNote(
                    context_index=1,
                    is_relevant=False,
                    note="Not relevant.",
                ),
            ],
            answer="Paris",
            reasoning="Based on context 0.",
        )

        assert len(output.notes) == 2
        assert output.notes[0].is_relevant is True
        assert output.notes[1].is_relevant is False
        assert output.answer == "Paris"
        assert output.reasoning == "Based on context 0."
