"""
Key fact extraction for improved retrieval recall.

Extracts key facts from sessions and expands queries to improve retrieval
of relevant information from long conversation histories.
"""

from typing import Literal

from pydantic import BaseModel, Field

from engram_benchmark.longmemeval.types import ParsedInstance, ParsedTurn
from engram_benchmark.providers.llm import LiteLLMProvider


class ExtractedFact(BaseModel):
    """A key fact extracted from a session."""

    content: str = Field(description="The extracted fact")
    session_id: str = Field(description="Source session ID")
    turn_index: int = Field(description="Source turn index")
    confidence: float = Field(ge=0.0, le=1.0, description="Extraction confidence")


class FactExtractionResult(BaseModel):
    """Result of fact extraction from an instance."""

    question_id: str
    facts: list[ExtractedFact]
    original_query: str
    expanded_query: str | None = None


ExtractionMethod = Literal["llm", "heuristic", "none"]


class KeyFactExtractor:
    """
    Extracts key facts from sessions to improve retrieval.

    Uses LLM-based extraction to identify important information that
    can be used to expand queries and improve recall.

    Examples:
            >>> llm = LiteLLMProvider(model="openai/gpt-4o-mini")
            >>> extractor = KeyFactExtractor(llm, method="llm")
            >>> result = await extractor.extract_facts(instance)
            >>> print(f"Extracted {len(result.facts)} facts")
    """

    def __init__(
        self,
        llm: LiteLLMProvider | None = None,
        method: ExtractionMethod = "heuristic",
        max_facts_per_session: int = 5,
    ) -> None:
        """
        Initialize key fact extractor.

        Args:
                llm: LLM provider for fact extraction (required if method="llm")
                method: Extraction method ("llm", "heuristic", "none")
                max_facts_per_session: Maximum facts to extract per session
        """
        self.llm = llm
        self.method = method
        self.max_facts_per_session = max_facts_per_session

        if method == "llm" and llm is None:
            raise ValueError("LLM provider required for llm-based extraction")

    async def extract_facts(self, instance: ParsedInstance) -> FactExtractionResult:
        """
        Extract key facts from an instance.

        Args:
                instance: ParsedInstance with sessions

        Returns:
                FactExtractionResult with extracted facts
        """
        if self.method == "none":
            return FactExtractionResult(
                question_id=instance.question_id,
                facts=[],
                original_query=instance.question,
            )

        if self.method == "llm":
            return await self._extract_with_llm(instance)
        else:
            return self._extract_heuristic(instance)

    async def _extract_with_llm(self, instance: ParsedInstance) -> FactExtractionResult:
        """Extract facts using LLM."""
        if self.llm is None:
            raise ValueError("LLM provider not initialized")

        facts: list[ExtractedFact] = []

        # Extract facts from each session
        for session in instance.sessions:
            # Build session context
            session_text = []
            for turn in session.turns:
                session_text.append(f"{turn.role.capitalize()}: {turn.content}")

            context = "\n".join(session_text)

            # Prompt for fact extraction
            prompt = f"""Extract the {self.max_facts_per_session} most important facts from this conversation session.

Session:
{context}

For each fact, provide a concise statement (one sentence).
List facts one per line, numbered.

Facts:"""

            # Call LLM
            llm_response = await self.llm.generate(
                prompt=prompt,
                max_tokens=500,
                temperature=0.3,
            )
            response = llm_response.content

            # Parse response (simple line-based parsing)
            lines = response.strip().split("\n")
            for line in lines:
                # Remove numbering and clean up
                fact_text = line.strip()
                if fact_text and len(fact_text) > 10:
                    # Remove leading numbers/bullets
                    fact_text = fact_text.lstrip("0123456789.-•* ")

                    if fact_text:
                        facts.append(
                            ExtractedFact(
                                content=fact_text,
                                session_id=session.session_id,
                                turn_index=0,  # Session-level fact
                                confidence=0.8,  # Fixed confidence for LLM extraction
                            )
                        )

                if len(facts) >= self.max_facts_per_session:
                    break

        # Expand query with facts (simple concatenation)
        expanded_query = None
        if facts:
            fact_summary = " ".join([f.content for f in facts[:3]])
            expanded_query = f"{instance.question} Context: {fact_summary}"

        return FactExtractionResult(
            question_id=instance.question_id,
            facts=facts,
            original_query=instance.question,
            expanded_query=expanded_query,
        )

    def _extract_heuristic(self, instance: ParsedInstance) -> FactExtractionResult:
        """
        Extract facts using heuristics.

        Applies multiple extraction strategies:
        1. Turns with has_answer=True (highest confidence)
        2. Assistant turns containing key information markers
        3. User preference statements
        4. Temporal/numerical information
        """
        facts: list[ExtractedFact] = []
        session_fact_counts: dict[str, int] = {}

        for session in instance.sessions:
            session_fact_counts[session.session_id] = 0

            for turn in session.turns:
                extracted_facts = self._extract_from_turn(turn, session.session_id)

                # Apply max_facts_per_session limit per session
                for fact in extracted_facts:
                    if session_fact_counts[session.session_id] < self.max_facts_per_session:
                        facts.append(fact)
                        session_fact_counts[session.session_id] += 1
                    else:
                        break

        # Sort by confidence (highest first)
        facts.sort(key=lambda f: f.confidence, reverse=True)

        # Generate expanded query if we have facts
        expanded_query = None
        if facts:
            # Take top 3 highest confidence facts for query expansion
            top_facts = facts[: min(3, len(facts))]
            fact_snippets = []

            for fact in top_facts:
                # Extract key phrases (simplified - first sentence or up to 100 chars)
                snippet = fact.content.split(".")[0] if "." in fact.content else fact.content
                snippet = snippet[:100] + "..." if len(snippet) > 100 else snippet
                fact_snippets.append(snippet)

            if fact_snippets:
                expanded_query = f"{instance.question} [Context: {' | '.join(fact_snippets)}]"

        return FactExtractionResult(
            question_id=instance.question_id,
            facts=facts,
            original_query=instance.question,
            expanded_query=expanded_query,
        )

    def _extract_from_turn(self, turn: ParsedTurn, session_id: str) -> list[ExtractedFact]:
        """
        Extract facts from a single turn using heuristics.

        Args:
            turn: Turn to extract from
            session_id: ID of the parent session

        Returns:
            List of extracted facts (may be empty or contain multiple facts)
        """
        facts: list[ExtractedFact] = []
        content = turn.content

        # Skip very short turns (likely not informative)
        if len(content) < 15:
            return facts

        # Strategy 1: Turns with has_answer flag (highest priority)
        if turn.has_answer:
            facts.append(
                ExtractedFact(
                    content=content,
                    session_id=session_id,
                    turn_index=turn.sequence_index,
                    confidence=1.0,  # Highest confidence
                )
            )
            return facts  # has_answer is definitive, skip other heuristics

        # Strategy 2: Assistant turns with information markers
        if turn.role == "assistant":
            confidence = self._assess_assistant_turn_confidence(content)
            if confidence > 0.3:  # Only include if above threshold
                facts.append(
                    ExtractedFact(
                        content=content,
                        session_id=session_id,
                        turn_index=turn.sequence_index,
                        confidence=confidence,
                    )
                )
                return facts

        # Strategy 3: User preference/information statements
        if turn.role == "user":
            confidence = self._assess_user_turn_confidence(content)
            if confidence > 0.3:  # Only include if above threshold
                facts.append(
                    ExtractedFact(
                        content=content,
                        session_id=session_id,
                        turn_index=turn.sequence_index,
                        confidence=confidence,
                    )
                )

        return facts

    def _assess_assistant_turn_confidence(self, content: str) -> float:
        """
        Assess confidence that an assistant turn contains useful facts.

        Uses heuristics based on information markers.
        """
        content_lower = content.lower()
        confidence = 0.0

        # Definitive statements (high confidence)
        definitive_markers = [
            " is ",
            " are ",
            " was ",
            " were ",
            " will be ",
            " has been ",
            " have been ",
        ]
        if any(marker in content_lower for marker in definitive_markers):
            confidence += 0.4

        # Factual information markers
        factual_markers = [
            "the",
            "this",
            "that",
            "according to",
            "based on",
            "specifically",
        ]
        marker_count = sum(1 for marker in factual_markers if marker in content_lower)
        confidence += min(marker_count * 0.1, 0.3)

        # Temporal/numerical information (often important facts)
        import re

        # Dates, numbers, measurements
        if re.search(r"\d+", content):
            confidence += 0.2

        # Named entities (simple heuristic: capitalized words not at sentence start)
        sentences = content.split(". ")
        for sentence in sentences:
            words = sentence.split()
            # Count capitalized words that aren't the first word
            caps_count = sum(
                1 for i, word in enumerate(words) if i > 0 and word and word[0].isupper()
            )
            if caps_count > 0:
                confidence += min(caps_count * 0.1, 0.2)
                break

        # Explanatory content (longer, structured responses)
        if len(content) > 100:
            confidence += 0.1

        return min(confidence, 1.0)

    def _assess_user_turn_confidence(self, content: str) -> float:
        """
        Assess confidence that a user turn contains useful facts.

        Focuses on preference statements and declarative information.
        """
        content_lower = content.lower()
        confidence = 0.0

        # Preference indicators
        preference_markers = [
            "i like",
            "i prefer",
            "i want",
            "i need",
            "i don't like",
            "i hate",
            "my favorite",
            "i enjoy",
            "i love",
        ]
        if any(marker in content_lower for marker in preference_markers):
            confidence += 0.6

        # Personal information statements
        personal_markers = [
            "my name is",
            "i am",
            "i'm",
            "i live in",
            "i work",
            "my",
            "i have",
        ]
        marker_count = sum(1 for marker in personal_markers if marker in content_lower)
        if marker_count > 0:
            confidence += min(marker_count * 0.15, 0.5)

        # Declarative statements (not questions)
        if "?" not in content:
            confidence += 0.1

        # Temporal/numerical information
        import re

        if re.search(r"\d+", content):
            confidence += 0.15

        return min(confidence, 1.0)


async def extract_facts_batch(
    instances: list[ParsedInstance],
    extractor: KeyFactExtractor,
) -> list[FactExtractionResult]:
    """
    Extract facts from a batch of instances.

    Args:
            instances: List of ParsedInstance objects
            extractor: KeyFactExtractor instance

    Returns:
            List of FactExtractionResult objects
    """
    results = []
    for instance in instances:
        result = await extractor.extract_facts(instance)
        results.append(result)

    return results
