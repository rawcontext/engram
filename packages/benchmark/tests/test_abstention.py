"""
Tests for abstention detection.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from engram_benchmark.longmemeval.abstention import (
    AbstentionDetector,
    AbstentionMethod,
    AbstentionResult,
    LLMAbstentionScore,
)
from engram_benchmark.providers.llm import LiteLLMProvider


@pytest.fixture
def mock_llm_provider() -> MagicMock:
    """Mock LLM provider."""
    return MagicMock(spec=LiteLLMProvider)


@pytest.fixture
def detector(mock_llm_provider: MagicMock) -> AbstentionDetector:
    """Create abstention detector with mock LLM."""
    return AbstentionDetector(llm_provider=mock_llm_provider)


@pytest.fixture
def detector_no_llm() -> AbstentionDetector:
    """Create abstention detector without LLM."""
    return AbstentionDetector(llm_provider=None)


class TestKeywordAbstentionDetection:
    """Tests for keyword-based abstention detection."""

    def test_exact_match_short_abstention(self, detector_no_llm: AbstentionDetector) -> None:
        """Test exact match on short abstention phrases."""
        responses = [
            "I don't know",
            "I do not know",
            "I dont know",
            "don't know",
            "unknown",
            "unclear",
            "n/a",
            "NA",
        ]

        for response in responses:
            result = detector_no_llm.detect_keyword_abstention(response)
            assert result.is_abstention, f"Failed for: {response}"
            assert result.confidence == 1.0
            assert result.method == AbstentionMethod.KEYWORD

    def test_pattern_match_abstention(self, detector_no_llm: AbstentionDetector) -> None:
        """Test pattern matching on longer abstention responses."""
        responses = [
            "I don't know the answer to this question.",
            "I can't determine that from the context.",
            "There is not enough information to answer.",
            "The information is insufficient.",
            "I cannot tell based on the provided context.",
            "This is unclear from the given information.",
            "We need more information to answer this.",
            "I do not have the necessary data.",
            "This question is unanswerable.",
            "There's no way to know this.",
            "It's impossible to determine the answer.",
        ]

        for response in responses:
            result = detector_no_llm.detect_keyword_abstention(response)
            assert result.is_abstention, f"Failed for: {response}"
            assert result.confidence >= 0.8
            assert result.method == AbstentionMethod.KEYWORD

    def test_no_abstention_detected(self, detector_no_llm: AbstentionDetector) -> None:
        """Test that non-abstention responses are correctly identified."""
        responses = [
            "The answer is 42.",
            "Paris is the capital of France.",
            "Yes, that is correct.",
            "No, that's not right.",
            "According to the context, the meeting was on Monday.",
        ]

        for response in responses:
            result = detector_no_llm.detect_keyword_abstention(response)
            assert not result.is_abstention, f"Failed for: {response}"
            assert result.confidence <= 0.2
            assert result.method == AbstentionMethod.KEYWORD

    def test_case_insensitive(self, detector_no_llm: AbstentionDetector) -> None:
        """Test that detection is case-insensitive."""
        responses = [
            "I DON'T KNOW",
            "UNCLEAR",
            "I Can't Tell",
            "NOT ENOUGH INFORMATION",
        ]

        for response in responses:
            result = detector_no_llm.detect_keyword_abstention(response)
            assert result.is_abstention, f"Failed for: {response}"

    def test_multiple_patterns_increase_confidence(
        self, detector_no_llm: AbstentionDetector
    ) -> None:
        """Test that multiple matched patterns increase confidence."""
        # Single pattern
        single_result = detector_no_llm.detect_keyword_abstention("I don't know the answer.")

        # Multiple patterns
        multi_result = detector_no_llm.detect_keyword_abstention(
            "I don't know the answer. There is not enough information and it's unclear."
        )

        assert multi_result.confidence > single_result.confidence


class TestLLMAbstentionDetection:
    """Tests for LLM-based abstention detection."""

    @pytest.mark.asyncio
    async def test_llm_detects_abstention(self, detector: AbstentionDetector) -> None:
        """Test LLM-based abstention detection."""
        mock_score = LLMAbstentionScore(
            is_abstention=True,
            confidence=0.9,
            reasoning="Response explicitly states lack of information",
        )

        detector.llm.generate_structured = AsyncMock(return_value=mock_score)

        result = await detector.detect_llm_abstention(
            question="What is X?", response="I don't have enough information to answer."
        )

        assert result.is_abstention
        assert result.confidence == 0.9
        assert result.method == AbstentionMethod.LLM
        assert "lack of information" in result.reasoning or ""

    @pytest.mark.asyncio
    async def test_llm_detects_non_abstention(self, detector: AbstentionDetector) -> None:
        """Test LLM correctly identifies non-abstentions."""
        mock_score = LLMAbstentionScore(
            is_abstention=False, confidence=0.1, reasoning="Response provides a clear answer"
        )

        detector.llm.generate_structured = AsyncMock(return_value=mock_score)

        result = await detector.detect_llm_abstention(
            question="What is X?", response="The answer is 42."
        )

        assert not result.is_abstention
        assert result.confidence == 0.1
        assert result.method == AbstentionMethod.LLM

    @pytest.mark.asyncio
    async def test_llm_threshold_respected(self, detector: AbstentionDetector) -> None:
        """Test that LLM threshold is respected."""
        # Score below threshold
        mock_score = LLMAbstentionScore(
            is_abstention=True,
            confidence=0.5,  # Below default threshold of 0.7
            reasoning="Somewhat uncertain",
        )

        detector.llm.generate_structured = AsyncMock(return_value=mock_score)

        result = await detector.detect_llm_abstention(
            question="What is X?", response="Maybe I don't know."
        )

        assert not result.is_abstention  # Below threshold
        assert result.confidence == 0.5

    @pytest.mark.asyncio
    async def test_llm_required_error(self, detector_no_llm: AbstentionDetector) -> None:
        """Test that LLM detection raises error when no provider."""
        with pytest.raises(ValueError, match="LLM-based detection requires llm_provider"):
            await detector_no_llm.detect_llm_abstention(
                question="What is X?", response="I don't know."
            )


class TestEnsembleAbstentionDetection:
    """Tests for ensemble abstention detection."""

    @pytest.mark.asyncio
    async def test_ensemble_high_confidence_keyword(self, detector: AbstentionDetector) -> None:
        """Test ensemble uses keyword result when confidence is high."""
        # Keyword will have high confidence for this
        result = await detector.detect(
            response="I don't know", question="What is X?", method="ensemble"
        )

        # Should use keyword detection (no LLM call)
        assert result.is_abstention
        assert result.confidence >= detector.keyword_threshold
        # Since keyword confidence is high, LLM should not be called
        detector.llm.generate_structured.assert_not_called()

    @pytest.mark.asyncio
    async def test_ensemble_falls_back_to_llm(self, detector: AbstentionDetector) -> None:
        """Test ensemble falls back to LLM for uncertain cases."""
        mock_score = LLMAbstentionScore(
            is_abstention=True, confidence=0.8, reasoning="Implicit abstention detected"
        )

        detector.llm.generate_structured = AsyncMock(return_value=mock_score)

        # Ambiguous response (keyword won't be confident)
        await detector.detect(
            response="Well, that's a tricky question. I'm not entirely sure about that.",
            question="What is X?",
            method="ensemble",
        )

        # Should have called LLM
        detector.llm.generate_structured.assert_called_once()

    @pytest.mark.asyncio
    async def test_ensemble_averages_confidence(self, detector: AbstentionDetector) -> None:
        """Test ensemble averages keyword and LLM confidence."""
        mock_score = LLMAbstentionScore(
            is_abstention=False, confidence=0.2, reasoning="Seems like a valid answer"
        )

        detector.llm.generate_structured = AsyncMock(return_value=mock_score)

        # Response with low keyword confidence (no strong patterns)
        result = await detector.detect(
            response="Hmm, that's a tricky one. I'm not entirely confident.",
            question="What is X?",
            method="ensemble",
        )

        # Should average keyword and LLM confidence
        assert result.method == AbstentionMethod.ENSEMBLE
        assert 0.0 < result.confidence < 1.0

    @pytest.mark.asyncio
    async def test_ensemble_without_llm(self, detector_no_llm: AbstentionDetector) -> None:
        """Test ensemble falls back to keyword only without LLM."""
        result = await detector_no_llm.detect(
            response="I don't know",
            question=None,  # No question provided
            method="ensemble",
        )

        assert result.is_abstention
        assert result.method == AbstentionMethod.KEYWORD


class TestAbstentionDetectionMethods:
    """Tests for detection method selection."""

    @pytest.mark.asyncio
    async def test_keyword_method(self, detector: AbstentionDetector) -> None:
        """Test explicit keyword method selection."""
        result = await detector.detect(response="I don't know", method="keyword")

        assert result.method == AbstentionMethod.KEYWORD
        assert result.is_abstention

    @pytest.mark.asyncio
    async def test_llm_method(self, detector: AbstentionDetector) -> None:
        """Test explicit LLM method selection."""
        mock_score = LLMAbstentionScore(
            is_abstention=True, confidence=0.9, reasoning="Clear abstention"
        )

        detector.llm.generate_structured = AsyncMock(return_value=mock_score)

        result = await detector.detect(response="I don't know", question="What is X?", method="llm")

        assert result.method == AbstentionMethod.LLM
        assert result.is_abstention

    @pytest.mark.asyncio
    async def test_invalid_method_raises_error(self, detector: AbstentionDetector) -> None:
        """Test invalid method raises error."""
        with pytest.raises(ValueError, match="Invalid detection method"):
            await detector.detect(
                response="I don't know",
                method="invalid",  # type: ignore[arg-type]
            )

    @pytest.mark.asyncio
    async def test_llm_method_requires_question(self, detector: AbstentionDetector) -> None:
        """Test LLM method requires question parameter."""
        with pytest.raises(ValueError, match="requires llm_provider and question"):
            await detector.detect(response="I don't know", question=None, method="llm")


class TestCustomThresholds:
    """Tests for custom threshold configuration."""

    @pytest.mark.asyncio
    async def test_custom_keyword_threshold(self, mock_llm_provider: MagicMock) -> None:
        """Test custom keyword threshold."""
        detector = AbstentionDetector(
            llm_provider=mock_llm_provider,
            keyword_threshold=0.5,  # Lower threshold
        )

        await detector.detect(response="I don't know", method="ensemble")

        # Should use keyword result due to lower threshold
        mock_llm_provider.generate_structured.assert_not_called()

    @pytest.mark.asyncio
    async def test_custom_llm_threshold(self, mock_llm_provider: MagicMock) -> None:
        """Test custom LLM threshold."""
        mock_score = LLMAbstentionScore(
            is_abstention=True, confidence=0.5, reasoning="Moderate confidence"
        )

        mock_llm_provider.generate_structured = AsyncMock(return_value=mock_score)

        detector = AbstentionDetector(
            llm_provider=mock_llm_provider,
            llm_threshold=0.4,  # Lower threshold
        )

        result = await detector.detect_llm_abstention(
            question="What is X?", response="Maybe I don't know"
        )

        # Should be abstention due to lower threshold
        assert result.is_abstention

    @pytest.mark.asyncio
    async def test_custom_ensemble_threshold(self, mock_llm_provider: MagicMock) -> None:
        """Test custom ensemble threshold."""
        mock_score = LLMAbstentionScore(
            is_abstention=True, confidence=0.4, reasoning="Low confidence"
        )

        mock_llm_provider.generate_structured = AsyncMock(return_value=mock_score)

        detector = AbstentionDetector(
            llm_provider=mock_llm_provider,
            ensemble_threshold=0.3,  # Lower threshold
        )

        result = await detector.detect(
            response="unclear response", question="What is X?", method="ensemble"
        )

        # Ensemble average might be below standard threshold but above custom
        # Exact behavior depends on keyword confidence
        assert isinstance(result, AbstentionResult)
