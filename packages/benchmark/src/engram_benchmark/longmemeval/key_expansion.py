"""
Key fact extraction for improved retrieval recall.

Extracts key facts from sessions and expands queries to improve retrieval
of relevant information from long conversation histories.
"""

from typing import Literal

from pydantic import BaseModel, Field

from engram_benchmark.longmemeval.types import ParsedInstance
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
        Extract facts using heuristics (placeholder).

        Currently extracts turns with answer markers as facts.
        """
        facts: list[ExtractedFact] = []

        for session in instance.sessions:
            for turn in session.turns:
                if turn.has_answer:
                    # Use answer-containing turns as facts
                    facts.append(
                        ExtractedFact(
                            content=turn.content,
                            session_id=session.session_id,
                            turn_index=turn.sequence_index,
                            confidence=1.0,  # High confidence for has_answer turns
                        )
                    )

        return FactExtractionResult(
            question_id=instance.question_id,
            facts=facts,
            original_query=instance.question,
            expanded_query=None,  # No expansion for heuristic method
        )


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
