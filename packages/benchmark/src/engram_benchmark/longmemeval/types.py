"""
LongMemEval Dataset Schema.

Based on the LongMemEval benchmark (ICLR 2025):
- https://github.com/xiaowu0162/LongMemEval
- https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned

Question types represent the 5 core memory abilities:
- IE (Information Extraction): single-session-*
- MR (Multi-Session Reasoning): multi-session
- TR (Temporal Reasoning): temporal-reasoning
- KU (Knowledge Update): knowledge-update
- ABS (Abstention): indicated by _abs suffix on question_id
"""

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class QuestionType(str, Enum):
    """Question types in the LongMemEval dataset."""

    SINGLE_SESSION_USER = "single-session-user"
    SINGLE_SESSION_ASSISTANT = "single-session-assistant"
    SINGLE_SESSION_PREFERENCE = "single-session-preference"
    MULTI_SESSION = "multi-session"
    TEMPORAL_REASONING = "temporal-reasoning"
    KNOWLEDGE_UPDATE = "knowledge-update"


# Type alias for memory abilities
MemoryAbility = Literal["IE", "MR", "TR", "KU", "ABS"]


class Turn(BaseModel):
    """A single turn in a conversation (user or assistant message)."""

    model_config = ConfigDict(strict=True, frozen=True)

    role: Literal["user", "assistant"]
    content: str
    has_answer: bool | None = None


# Type alias for a session (array of turns)
Session = list[Turn]


class LongMemEvalInstance(BaseModel):
    """
    A single evaluation instance from LongMemEval.

    Note: answer field coerces numbers to strings because some answers
    are numeric in the dataset.
    """

    model_config = ConfigDict(strict=True, extra="forbid")

    question_id: str
    question_type: QuestionType
    question: str
    answer: str
    question_date: str
    haystack_session_ids: list[str]
    haystack_dates: list[str]
    haystack_sessions: list[Session]
    answer_session_ids: list[str]

    @field_validator("answer", mode="before")
    @classmethod
    def coerce_answer_to_string(cls, v: str | int | float) -> str:
        """Coerce numeric answers to strings."""
        return str(v)

    @field_validator("question_type", mode="before")
    @classmethod
    def coerce_question_type(cls, v: str | QuestionType) -> QuestionType:
        """Coerce string question_type to QuestionType enum."""
        if isinstance(v, str):
            return QuestionType(v)
        return v


# Type alias for the full dataset
LongMemEvalDataset = list[LongMemEvalInstance]


def get_memory_ability(question_type: QuestionType, question_id: str) -> MemoryAbility:
    """
    Map question type to memory ability category.

    Abstention is indicated by _abs suffix on question_id.
    """
    # Check for abstention first
    if question_id.endswith("_abs"):
        return "ABS"

    # Map question type to ability
    ability_map: dict[QuestionType, MemoryAbility] = {
        QuestionType.SINGLE_SESSION_USER: "IE",
        QuestionType.SINGLE_SESSION_ASSISTANT: "IE",
        QuestionType.SINGLE_SESSION_PREFERENCE: "IE",
        QuestionType.MULTI_SESSION: "MR",
        QuestionType.TEMPORAL_REASONING: "TR",
        QuestionType.KNOWLEDGE_UPDATE: "KU",
    }

    return ability_map[question_type]


class ParsedTurn(BaseModel):
    """Parsed turn with sequence index."""

    model_config = ConfigDict(strict=True, frozen=True)

    role: Literal["user", "assistant"]
    content: str
    has_answer: bool
    sequence_index: int


class ParsedSession(BaseModel):
    """Parsed session with normalized data."""

    model_config = ConfigDict(strict=True, frozen=True)

    session_id: str
    timestamp: datetime
    turns: list[ParsedTurn]


class ParsedInstance(BaseModel):
    """Parsed instance with normalized data types."""

    model_config = ConfigDict(strict=True, frozen=True)

    question_id: str
    question_type: QuestionType
    memory_ability: MemoryAbility
    question: str
    answer: str
    question_date: datetime
    sessions: list[ParsedSession]
    answer_session_ids: list[str]
    is_abstention: bool


class BenchmarkResult(BaseModel):
    """Output format for benchmark results."""

    model_config = ConfigDict(strict=True)

    question_id: str
    hypothesis: str


class EvaluatedResult(BaseModel):
    """Evaluation output with judgment."""

    model_config = ConfigDict(strict=True)

    question_id: str
    hypothesis: str
    answer: str
    question_type: QuestionType
    memory_ability: MemoryAbility
    correct: bool
    reasoning: str | None = None


class AbilityMetrics(BaseModel):
    """Aggregate metrics per memory ability."""

    model_config = ConfigDict(strict=True, frozen=True)

    total: int = Field(ge=0)
    correct: int = Field(ge=0)
    accuracy: float = Field(ge=0.0, le=1.0)


class RetrievalMetrics(BaseModel):
    """Retrieval quality metrics."""

    model_config = ConfigDict(strict=True, frozen=True)

    turn_recall: float = Field(ge=0.0, le=1.0, description="Percentage of evidence turns retrieved")
    session_recall: float = Field(
        ge=0.0, le=1.0, description="Percentage of evidence sessions retrieved"
    )
    recall_at_k: dict[int, float] = Field(description="Recall at different K values (1, 5, 10)")
    ndcg_at_k: dict[int, float] = Field(
        description="NDCG at different K values - measures ranking quality"
    )
    mrr: float = Field(ge=0.0, le=1.0, description="Mean Reciprocal Rank")


class AbstentionMetrics(BaseModel):
    """Abstention-specific metrics."""

    model_config = ConfigDict(strict=True, frozen=True)

    true_positives: int = Field(ge=0, description="Correctly abstained")
    false_positives: int = Field(ge=0, description="Incorrectly abstained")
    false_negatives: int = Field(ge=0, description="Should have abstained but didn't")
    true_negatives: int = Field(ge=0, description="Correctly answered")
    precision: float = Field(ge=0.0, le=1.0, description="Correct abstentions / total abstentions")
    recall: float = Field(
        ge=0.0, le=1.0, description="Correct abstentions / questions requiring abstention"
    )
    f1: float = Field(ge=0.0, le=1.0, description="Harmonic mean of precision and recall")


class EvaluationMetrics(BaseModel):
    """Full evaluation metrics."""

    model_config = ConfigDict(strict=True, frozen=True)

    overall: AbilityMetrics
    by_ability: dict[MemoryAbility, AbilityMetrics]
    retrieval: RetrievalMetrics | None = None
    abstention: AbstentionMetrics | None = None
