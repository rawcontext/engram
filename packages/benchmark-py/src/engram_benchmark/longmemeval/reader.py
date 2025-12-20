"""
LongMemEval reader implementation.

Integrates the Chain-of-Note reader with abstention detection to generate
answers for LongMemEval evaluation instances.
"""

from pydantic import BaseModel, Field

from engram_benchmark.longmemeval.abstention import AbstentionDetector
from engram_benchmark.longmemeval.types import ParsedInstance
from engram_benchmark.providers.llm import LiteLLMProvider
from engram_benchmark.providers.reader import ChainOfNoteReader


class LongMemEvalReaderOutput(BaseModel):
    """Output from LongMemEval reader."""

    question_id: str
    answer: str
    reasoning: str | None = None
    is_abstention: bool = Field(default=False)
    abstention_confidence: float | None = Field(default=None)
    contexts_used: list[str] = Field(default_factory=list)


class LongMemEvalReader:
    """
    Reader for generating answers on LongMemEval instances.

    Combines:
    - Chain-of-Note reasoning for improved accuracy
    - Abstention detection to identify when the model lacks information
    - Context management from retrieved sessions/turns
    """

    def __init__(
        self,
        llm_provider: LiteLLMProvider,
        use_chain_of_note: bool = True,
        detect_abstention: bool = True,
    ) -> None:
        """
        Initialize LongMemEval reader.

        Args:
            llm_provider: LLM provider for generation
            use_chain_of_note: Whether to use Chain-of-Note reasoning
            detect_abstention: Whether to detect abstentions in responses
        """
        self.llm = llm_provider
        self.reader = ChainOfNoteReader(llm_provider, use_chain_of_note)
        self.abstention_detector = (
            AbstentionDetector(llm_provider) if detect_abstention else None
        )

    async def generate_answer(
        self,
        instance: ParsedInstance,
        contexts: list[str],
    ) -> LongMemEvalReaderOutput:
        """
        Generate an answer for a LongMemEval instance.

        Args:
            instance: Parsed instance with question and metadata
            contexts: List of retrieved context strings (from retrieval stage)

        Returns:
            LongMemEvalReaderOutput with answer and metadata
        """
        # Generate answer using Chain-of-Note reader
        reader_output = await self.reader.generate_answer(
            question=instance.question,
            contexts=contexts,
        )

        # Detect abstention if enabled
        is_abstention = False
        abstention_confidence = None

        if self.abstention_detector is not None:
            abstention_result = await self.abstention_detector.detect(
                response=reader_output.answer,
                question=instance.question,
                method="ensemble",
            )
            is_abstention = abstention_result.is_abstention
            abstention_confidence = abstention_result.confidence

        return LongMemEvalReaderOutput(
            question_id=instance.question_id,
            answer=reader_output.answer,
            reasoning=reader_output.reasoning,
            is_abstention=is_abstention,
            abstention_confidence=abstention_confidence,
            contexts_used=contexts,
        )

    def format_contexts_from_sessions(self, instance: ParsedInstance) -> list[str]:
        """
        Format contexts from parsed sessions.

        This is a helper to convert session turns into context strings
        for retrieval. In practice, contexts would come from a retrieval
        system, but this is useful for oracle evaluation.

        Args:
            instance: Parsed instance with sessions

        Returns:
            List of formatted context strings (one per turn with answer)
        """
        contexts = []

        for session in instance.sessions:
            session_date = session.timestamp.strftime("%Y-%m-%d")

            for turn in session.turns:
                if turn.has_answer:
                    # Format as context string
                    context = f"[Session {session.session_id}, {session_date}, Turn {turn.sequence_index}]\n"
                    context += f"{turn.role.capitalize()}: {turn.content}"
                    contexts.append(context)

        return contexts
