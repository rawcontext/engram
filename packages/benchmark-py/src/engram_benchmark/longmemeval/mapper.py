"""
Document mapper for LongMemEval instances.

Maps LongMemEval instances to indexable documents with configurable granularity:
- Turn-level: Each conversation turn becomes a separate document
- Session-level: Each session becomes a single document
"""

from datetime import datetime
from typing import Literal

from dateutil import parser as dateparser
from pydantic import BaseModel, Field

from engram_benchmark.longmemeval.types import (
    LongMemEvalInstance,
    ParsedInstance,
    ParsedSession,
    ParsedTurn,
    get_memory_ability,
)


class IndexableDocument(BaseModel):
    """A document ready for indexing in a vector store."""

    doc_id: str = Field(description="Unique document identifier")
    content: str = Field(description="Document content to embed")
    metadata: dict[str, str | int | bool | float] = Field(
        default_factory=dict,
        description="Metadata for filtering and retrieval",
    )


Granularity = Literal["turn", "session"]


class DocumentMapper:
    """
    Maps LongMemEval instances to indexable documents.

    Supports two granularity levels:
    - turn: Each conversation turn becomes a separate document (default)
    - session: Each session becomes a single document

    Examples:
            >>> mapper = DocumentMapper(granularity="turn")
            >>> parsed = mapper.parse_instance(instance)
            >>> documents = mapper.map_to_documents(parsed)
            >>> len(documents)
            42  # Number of turns across all sessions
    """

    def __init__(self, granularity: Granularity = "turn") -> None:
        """
        Initialize document mapper.

        Args:
                granularity: Document granularity ("turn" or "session")
        """
        self.granularity = granularity

    def parse_instance(self, instance: LongMemEvalInstance) -> ParsedInstance:
        """
        Parse a LongMemEval instance into normalized format.

        Args:
                instance: Raw LongMemEval instance

        Returns:
                ParsedInstance with normalized timestamps and structure
        """
        # Parse sessions
        parsed_sessions: list[ParsedSession] = []

        for session_id, haystack_date, session_turns in zip(
            instance.haystack_session_ids,
            instance.haystack_dates,
            instance.haystack_sessions,
            strict=True,
        ):
            # Parse timestamp
            timestamp = dateparser.parse(haystack_date)
            if timestamp is None:
                # Fallback to current time if parsing fails
                timestamp = datetime.now()

            # Parse turns with sequence indices
            parsed_turns: list[ParsedTurn] = []
            for seq_idx, turn in enumerate(session_turns):
                parsed_turns.append(
                    ParsedTurn(
                        role=turn.role,
                        content=turn.content,
                        has_answer=turn.has_answer or False,
                        sequence_index=seq_idx,
                    )
                )

            parsed_sessions.append(
                ParsedSession(
                    session_id=session_id,
                    timestamp=timestamp,
                    turns=parsed_turns,
                )
            )

        # Parse question date
        question_date = dateparser.parse(instance.question_date)
        if question_date is None:
            question_date = datetime.now()

        # Determine memory ability
        memory_ability = get_memory_ability(instance.question_type, instance.question_id)

        return ParsedInstance(
            question_id=instance.question_id,
            question_type=instance.question_type,
            memory_ability=memory_ability,
            question=instance.question,
            answer=instance.answer,
            question_date=question_date,
            sessions=parsed_sessions,
            answer_session_ids=instance.answer_session_ids,
            is_abstention=instance.question_id.endswith("_abs"),
        )

    def map_to_documents(self, instance: ParsedInstance) -> list[IndexableDocument]:
        """
        Map a parsed instance to indexable documents.

        Args:
                instance: ParsedInstance with normalized data

        Returns:
                List of IndexableDocument objects
        """
        if self.granularity == "turn":
            return self._map_turn_level(instance)
        else:
            return self._map_session_level(instance)

    def _map_turn_level(self, instance: ParsedInstance) -> list[IndexableDocument]:
        """Map each turn to a separate document."""
        documents: list[IndexableDocument] = []

        for session in instance.sessions:
            for turn in session.turns:
                doc_id = f"{instance.question_id}_{session.session_id}_{turn.sequence_index}"

                # Format content with role prefix
                content = f"{turn.role.capitalize()}: {turn.content}"

                # Metadata for filtering and retrieval
                metadata = {
                    "question_id": instance.question_id,
                    "session_id": session.session_id,
                    "turn_index": turn.sequence_index,
                    "role": turn.role,
                    "has_answer": turn.has_answer,
                    "timestamp": session.timestamp.isoformat(),
                    "question_type": instance.question_type.value,
                    "memory_ability": instance.memory_ability,
                }

                documents.append(
                    IndexableDocument(
                        doc_id=doc_id,
                        content=content,
                        metadata=metadata,
                    )
                )

        return documents

    def _map_session_level(self, instance: ParsedInstance) -> list[IndexableDocument]:
        """Map each session to a single document."""
        documents: list[IndexableDocument] = []

        for session in instance.sessions:
            doc_id = f"{instance.question_id}_{session.session_id}"

            # Concatenate all turns in the session
            turn_contents = []
            has_answer = False

            for turn in session.turns:
                turn_contents.append(f"{turn.role.capitalize()}: {turn.content}")
                if turn.has_answer:
                    has_answer = True

            content = "\n".join(turn_contents)

            # Metadata for filtering and retrieval
            metadata = {
                "question_id": instance.question_id,
                "session_id": session.session_id,
                "turn_count": len(session.turns),
                "has_answer": has_answer,
                "timestamp": session.timestamp.isoformat(),
                "question_type": instance.question_type.value,
                "memory_ability": instance.memory_ability,
            }

            documents.append(
                IndexableDocument(
                    doc_id=doc_id,
                    content=content,
                    metadata=metadata,
                )
            )

        return documents


def parse_batch(
    instances: list[LongMemEvalInstance],
    mapper: DocumentMapper | None = None,
) -> list[ParsedInstance]:
    """
    Parse a batch of instances.

    Args:
            instances: List of raw LongMemEval instances
            mapper: Optional DocumentMapper (creates default if None)

    Returns:
            List of ParsedInstance objects
    """
    if mapper is None:
        mapper = DocumentMapper()

    return [mapper.parse_instance(instance) for instance in instances]


def map_batch(
    instances: list[ParsedInstance],
    mapper: DocumentMapper | None = None,
) -> list[IndexableDocument]:
    """
    Map a batch of parsed instances to documents.

    Args:
            instances: List of ParsedInstance objects
            mapper: Optional DocumentMapper (creates default if None)

    Returns:
            List of IndexableDocument objects (flattened)
    """
    if mapper is None:
        mapper = DocumentMapper()

    documents: list[IndexableDocument] = []
    for instance in instances:
        documents.extend(mapper.map_to_documents(instance))

    return documents
