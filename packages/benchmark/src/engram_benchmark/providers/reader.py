"""
Answer generation with Chain-of-Note (CoN) reasoning.

Chain-of-Note is an enhanced prompting technique that improves accuracy by:
1. Having the model assess relevance of each retrieved context
2. Generate notes about why context is/isn't relevant
3. Use those notes to produce a more accurate final answer

Reference: "Chain-of-Note: Enhancing Retrieval-Augmented Language Models"
https://arxiv.org/abs/2311.09210
"""

from pydantic import BaseModel, Field

from engram_benchmark.providers.llm import LiteLLMProvider


class ReaderOutput(BaseModel):
    """Output from answer generation."""

    answer: str = Field(description="Generated answer to the question")
    reasoning: str | None = Field(default=None, description="Reasoning chain (for Chain-of-Note)")
    confidence: float | None = Field(
        default=None, ge=0.0, le=1.0, description="Model confidence in answer"
    )


class ContextNote(BaseModel):
    """Note about a single retrieved context."""

    context_index: int = Field(description="Index of the context in the input list")
    is_relevant: bool = Field(description="Whether this context is relevant to the question")
    note: str = Field(description="Explanation of relevance/irrelevance")


class ChainOfNoteOutput(BaseModel):
    """Structured output for Chain-of-Note reasoning."""

    notes: list[ContextNote] = Field(description="Notes about each retrieved context")
    answer: str = Field(description="Final answer based on relevant contexts")
    reasoning: str = Field(description="Overall reasoning process")


class ChainOfNoteReader:
    """
    Answer generation with Chain-of-Note reasoning.

    Uses a two-stage process:
    1. Generate notes about each retrieved context's relevance
    2. Use those notes to generate the final answer

    This improves accuracy by forcing the model to explicitly reason
    about context relevance before answering.
    """

    def __init__(
        self,
        llm_provider: LiteLLMProvider,
        use_chain_of_note: bool = True,
    ) -> None:
        """
        Initialize Chain-of-Note reader.

        Args:
            llm_provider: LLM provider for generation
            use_chain_of_note: Whether to use CoN (if False, uses simple prompting)
        """
        self.llm = llm_provider
        self.use_chain_of_note = use_chain_of_note

    async def generate_answer(
        self,
        question: str,
        contexts: list[str],
    ) -> ReaderOutput:
        """
        Generate an answer to a question given retrieved contexts.

        Args:
            question: The question to answer
            contexts: List of retrieved context strings

        Returns:
            ReaderOutput with answer and optional reasoning
        """
        if self.use_chain_of_note and len(contexts) > 0:
            return await self._generate_with_chain_of_note(question, contexts)
        else:
            return await self._generate_simple(question, contexts)

    async def _generate_with_chain_of_note(
        self,
        question: str,
        contexts: list[str],
    ) -> ReaderOutput:
        """
        Generate answer using Chain-of-Note reasoning.

        Args:
            question: The question to answer
            contexts: List of retrieved context strings

        Returns:
            ReaderOutput with answer and reasoning
        """
        prompt = self._format_chain_of_note_prompt(question, contexts)

        # Use structured output to ensure proper JSON format
        # Chain-of-Note needs more tokens for verbose notes per context
        result = await self.llm.generate_structured(
            prompt=prompt,
            schema=ChainOfNoteOutput,
            system_prompt="You are a helpful assistant that answers questions based on provided contexts. "
            "First, you assess the relevance of each context, then generate an accurate answer.",
            max_tokens=2048,
        )

        return ReaderOutput(
            answer=result.answer,
            reasoning=result.reasoning,
            confidence=None,  # Could compute based on note relevance
        )

    async def _generate_simple(
        self,
        question: str,
        contexts: list[str],
    ) -> ReaderOutput:
        """
        Generate answer using simple prompting without Chain-of-Note.

        Args:
            question: The question to answer
            contexts: List of retrieved context strings

        Returns:
            ReaderOutput with answer
        """
        prompt = self._format_simple_prompt(question, contexts)

        response = await self.llm.generate(
            prompt=prompt,
            system_prompt="You are a helpful assistant that answers questions based on provided contexts. "
            "If the contexts don't contain enough information to answer, say 'I don't know'.",
        )

        return ReaderOutput(
            answer=response.content,
            reasoning=None,
            confidence=None,
        )

    def _format_chain_of_note_prompt(self, question: str, contexts: list[str]) -> str:
        """
        Format prompt for Chain-of-Note reasoning.

        Args:
            question: The question to answer
            contexts: List of retrieved context strings

        Returns:
            Formatted prompt string
        """
        # Build context list
        context_list = ""
        for i, ctx in enumerate(contexts):
            context_list += f"[Context {i}]\n{ctx}\n\n"

        prompt = f"""I will provide you with a question and several retrieved contexts. Your task is to:

1. For each context, assess its relevance to the question and write a note explaining why it is or isn't relevant
2. Based on the relevant contexts, generate an accurate answer to the question
3. Explain your overall reasoning process

Question: {question}

{context_list}

Instructions:
- If no contexts are relevant or provide sufficient information, answer with "I don't know"
- Be concise and accurate in your answer
- Base your answer ONLY on information in the relevant contexts

Respond with a JSON object matching this structure:
{{
    "notes": [
        {{
            "context_index": 0,
            "is_relevant": true/false,
            "note": "explanation of relevance"
        }},
        ...
    ],
    "answer": "your answer here",
    "reasoning": "explanation of how you arrived at the answer"
}}
"""

        return prompt

    def _format_simple_prompt(self, question: str, contexts: list[str]) -> str:
        """
        Format prompt for simple (non-CoN) answer generation.

        Args:
            question: The question to answer
            contexts: List of retrieved context strings

        Returns:
            Formatted prompt string
        """
        if len(contexts) == 0:
            return f"Question: {question}\n\nNo context was provided. Answer the question or say 'I don't know' if you cannot answer."

        # Build context list
        context_list = ""
        for i, ctx in enumerate(contexts):
            context_list += f"Context {i + 1}:\n{ctx}\n\n"

        prompt = f"""Answer the following question based on the provided contexts.

Question: {question}

{context_list}

Instructions:
- Answer based ONLY on the information in the contexts
- If the contexts don't provide enough information, say "I don't know"
- Be concise and accurate

Answer:"""

        return prompt
