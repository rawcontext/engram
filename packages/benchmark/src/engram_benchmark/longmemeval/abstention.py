"""
3-layer abstention detection system.

Abstention detection identifies when an LLM should refuse to answer a question
because it lacks sufficient information. This is critical for evaluating
reliable AI systems.

Three detection layers:
1. Keyword-based: Fast regex patterns for explicit abstentions
2. LLM-based: Model confidence scoring for implicit abstentions
3. Ensemble: Voting across multiple detection methods

Reference: LongMemEval benchmark (ICLR 2025)
https://github.com/xiaowu0162/LongMemEval
"""

import re
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

from engram_benchmark.providers.llm import LiteLLMProvider


class AbstentionMethod(str, Enum):
    """Abstention detection method."""

    KEYWORD = "keyword"
    LLM = "llm"
    ENSEMBLE = "ensemble"


class AbstentionResult(BaseModel):
    """Result from abstention detection."""

    is_abstention: bool = Field(description="Whether the response is an abstention")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence in detection (0-1)")
    method: AbstentionMethod = Field(description="Detection method used")
    reasoning: str | None = Field(default=None, description="Explanation of detection")


class LLMAbstentionScore(BaseModel):
    """LLM-based abstention confidence score."""

    is_abstention: bool = Field(description="Whether the response appears to be an abstention")
    confidence: float = Field(
        ge=0.0, le=1.0, description="Confidence that this is an abstention (0-1)"
    )
    reasoning: str = Field(description="Explanation of the judgment")


class AbstentionDetector:
    """
    3-layer abstention detection system.

    Detects when an LLM response indicates insufficient information to answer.

    Examples:
        >>> detector = AbstentionDetector()
        >>> result = await detector.detect("I don't know")
        >>> assert result.is_abstention

        >>> result = await detector.detect("The answer is 42")
        >>> assert not result.is_abstention
    """

    # Common abstention phrases (case-insensitive)
    ABSTENTION_PATTERNS = [
        r"\bi don'?t know\b",
        r"\bcan'?t (?:determine|tell|say|answer)\b",
        r"\bcannot (?:determine|tell|say|answer)\b",
        r"\bunable to (?:determine|tell|say|answer)\b",
        r"\bnot enough information\b",
        r"\binsufficient\b",  # Catches "insufficient information/context/data"
        r"\bno (?:information|context|data)\b",
        r"\bcannot be (?:determined|answered)\b",
        r"\bunclear\b",  # Catches "unclear from...", "this is unclear", etc.
        r"\bneed more (?:information|context)\b",
        r"\b(?:i|we) (?:do not|don't) have\b",
        r"\bunanswerable\b",
        r"\bno way to know\b",
        r"\bimpossible to (?:determine|tell|say|answer)\b",
    ]

    def __init__(
        self,
        llm_provider: LiteLLMProvider | None = None,
        keyword_threshold: float = 0.9,
        llm_threshold: float = 0.7,
        ensemble_threshold: float = 0.6,
    ) -> None:
        """
        Initialize abstention detector.

        Args:
            llm_provider: Optional LLM provider for LLM-based detection
            keyword_threshold: Confidence threshold for keyword detection
            llm_threshold: Confidence threshold for LLM detection
            ensemble_threshold: Confidence threshold for ensemble voting
        """
        self.llm = llm_provider
        self.keyword_threshold = keyword_threshold
        self.llm_threshold = llm_threshold
        self.ensemble_threshold = ensemble_threshold

        # Compile regex patterns
        self._patterns = [re.compile(p, re.IGNORECASE) for p in self.ABSTENTION_PATTERNS]

    async def detect(
        self,
        response: str,
        question: str | None = None,
        method: Literal["keyword", "llm", "ensemble"] = "ensemble",
    ) -> AbstentionResult:
        """
        Detect if a response is an abstention.

        Args:
            response: The LLM response to check
            question: Optional question (required for LLM-based detection)
            method: Detection method to use

        Returns:
            AbstentionResult with detection outcome and confidence

        Raises:
            ValueError: If method is 'llm' or 'ensemble' but no LLM provider configured
        """
        if method == "keyword":
            return self.detect_keyword_abstention(response)
        elif method == "llm":
            if self.llm is None or question is None:
                raise ValueError("LLM-based detection requires llm_provider and question")
            return await self.detect_llm_abstention(question, response)
        elif method == "ensemble":
            # Start with keyword detection (fast)
            keyword_result = self.detect_keyword_abstention(response)

            # If keyword detection is confident, use it
            if keyword_result.confidence >= self.keyword_threshold:
                return keyword_result

            # Otherwise, use LLM detection if available
            if self.llm is not None and question is not None:
                llm_result = await self.detect_llm_abstention(question, response)

                # Ensemble vote: average confidence
                avg_confidence = (keyword_result.confidence + llm_result.confidence) / 2.0
                is_abstention = avg_confidence >= self.ensemble_threshold

                return AbstentionResult(
                    is_abstention=is_abstention,
                    confidence=avg_confidence,
                    method=AbstentionMethod.ENSEMBLE,
                    reasoning=f"Keyword: {keyword_result.confidence:.2f}, LLM: {llm_result.confidence:.2f}",
                )
            else:
                # Fall back to keyword only
                return keyword_result
        else:
            raise ValueError(f"Invalid detection method: {method}")

    def detect_keyword_abstention(self, response: str) -> AbstentionResult:
        """
        Detect abstention using keyword patterns.

        Fast, rule-based detection using regex patterns.

        Args:
            response: The LLM response to check

        Returns:
            AbstentionResult with detection outcome
        """
        # Normalize response for checking
        response_lower = response.lower().strip()

        # Check for exact matches to very short responses
        short_abstentions = [
            "i don't know",
            "i do not know",
            "i dont know",
            "don't know",
            "do not know",
            "dont know",
            "unknown",
            "unclear",
            "n/a",
            "na",
        ]

        if response_lower in short_abstentions:
            return AbstentionResult(
                is_abstention=True,
                confidence=1.0,
                method=AbstentionMethod.KEYWORD,
                reasoning=f"Exact match: '{response_lower}'",
            )

        # Check regex patterns
        matched_patterns = []
        for pattern in self._patterns:
            if pattern.search(response):
                matched_patterns.append(pattern.pattern)

        if matched_patterns:
            # Confidence based on number of matches (more matches = higher confidence)
            confidence = min(1.0, 0.8 + (len(matched_patterns) * 0.1))

            return AbstentionResult(
                is_abstention=True,
                confidence=confidence,
                method=AbstentionMethod.KEYWORD,
                reasoning=f"Matched patterns: {matched_patterns}",
            )

        # No abstention detected
        return AbstentionResult(
            is_abstention=False,
            confidence=0.1,  # Low confidence in negative detection
            method=AbstentionMethod.KEYWORD,
            reasoning="No abstention patterns matched",
        )

    async def detect_llm_abstention(self, question: str, response: str) -> AbstentionResult:
        """
        Detect abstention using LLM-based confidence scoring.

        Uses an LLM to assess whether the response indicates insufficient
        information to answer the question.

        Args:
            question: The original question
            response: The LLM response to check

        Returns:
            AbstentionResult with detection outcome

        Raises:
            ValueError: If no LLM provider configured
        """
        if self.llm is None:
            raise ValueError("LLM-based detection requires llm_provider")

        prompt = f"""Assess whether the following response indicates that the question cannot be answered due to insufficient information.

Question: {question}

Response: {response}

An abstention is when the model explicitly or implicitly indicates it doesn't have enough information to answer, such as:
- Saying "I don't know"
- Stating information is insufficient or unavailable
- Hedging extensively without providing a clear answer
- Providing very vague or non-committal responses

Respond with JSON using EXACTLY these field names:
- "is_abstention": boolean (true if this is an abstention, false otherwise)
- "confidence": number between 0.0 and 1.0
- "reasoning": string with brief explanation

Example: {{"is_abstention": true, "confidence": 0.9, "reasoning": "Response explicitly states 'I don't know'"}}

Consider both explicit phrases and implicit indicators of uncertainty."""

        result = await self.llm.generate_structured(
            prompt=prompt,
            schema=LLMAbstentionScore,
            system_prompt="You are an expert at detecting when language models are unable to answer questions due to insufficient information.",
        )

        return AbstentionResult(
            is_abstention=result.is_abstention and result.confidence >= self.llm_threshold,
            confidence=result.confidence,
            method=AbstentionMethod.LLM,
            reasoning=result.reasoning,
        )
