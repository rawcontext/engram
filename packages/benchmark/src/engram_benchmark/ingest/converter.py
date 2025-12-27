"""
Converter for LongMemEval → Engram RawStreamEvent format.

Transforms LongMemEval conversations into Gemini-style streaming events
that can be ingested through the full Engram pipeline.
"""

import logging
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from engram_benchmark.longmemeval.types import LongMemEvalInstance

logger = logging.getLogger(__name__)


class RawStreamEvent(BaseModel):
    """Engram raw stream event format."""

    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ingest_timestamp: str = Field(
        default_factory=lambda: datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    provider: str = "gemini"
    payload: dict
    headers: dict[str, str] = Field(default_factory=dict)
    vt_start: int = Field(default_factory=lambda: int(datetime.now(UTC).timestamp() * 1000))
    vt_end: int = 253402300799000  # Max bitemporal date


class LongMemEvalConverter:
    """
    Converts LongMemEval instances to Engram RawStreamEvents.

    Uses Gemini streaming format:
    - Message: {"type": "message", "role": "user"|"assistant", "content": "..."}
    - Result: {"type": "result", "status": "success", "stats": {...}}

    Each session gets a unique session ID, and turns are ordered by sequence.
    """

    def __init__(self, session_prefix: str = "benchmark") -> None:
        """
        Initialize converter.

        Args:
            session_prefix: Prefix for generated session IDs
        """
        self.session_prefix = session_prefix

    def convert_instance(self, instance: LongMemEvalInstance) -> Iterator[RawStreamEvent]:
        """
        Convert a LongMemEval instance to RawStreamEvents.

        Yields one event per turn, with session context in headers.

        Args:
            instance: LongMemEval instance with sessions and turns

        Yields:
            RawStreamEvent for each turn
        """
        for _session_idx, (session_id, session_date, session_turns) in enumerate(
            zip(
                instance.haystack_session_ids,
                instance.haystack_dates,
                instance.haystack_sessions,
                strict=True,
            )
        ):
            # Generate unique session ID for Engram
            engram_session_id = f"{self.session_prefix}-{instance.question_id}-{session_id}"

            # Parse session timestamp
            try:
                # Handle format like "2023/04/10 (Mon) 17:50"
                cleaned_date = session_date
                # Strip day-of-week suffix
                import re
                cleaned_date = re.sub(r"\s*\([A-Za-z]{2,3}\)\s*", " ", cleaned_date).strip()
                session_ts = datetime.strptime(cleaned_date, "%Y/%m/%d %H:%M")
                vt_start = int(session_ts.timestamp() * 1000)
            except (ValueError, TypeError):
                vt_start = int(datetime.now(UTC).timestamp() * 1000)

            for turn_idx, turn in enumerate(session_turns):
                # Generate content event for this turn
                event = self._create_turn_event(
                    session_id=engram_session_id,
                    turn_index=turn_idx,
                    role=turn.role,
                    content=turn.content,
                    has_answer=turn.has_answer or False,
                    question_id=instance.question_id,
                    vt_start=vt_start,
                )
                yield event
                vt_start += 500  # 0.5 second increment

                # Emit result event after assistant turns to finalize
                if turn.role == "assistant":
                    result_event = self._create_result_event(
                        session_id=engram_session_id,
                        content=turn.content,
                        vt_start=vt_start,
                    )
                    yield result_event

                # Small timestamp increment for ordering
                vt_start += 500  # 0.5 second between turns

    def _create_turn_event(
        self,
        session_id: str,
        turn_index: int,
        role: str,
        content: str,
        has_answer: bool,
        question_id: str,
        vt_start: int,
    ) -> RawStreamEvent:
        """Create a RawStreamEvent for a single turn."""
        # Gemini streaming format with type, role and content
        payload = {
            "type": "message",
            "role": role,
            "content": content,
            "timestamp": datetime.now(UTC).isoformat(),
        }

        # Headers provide session context
        headers = {
            "x-session-id": session_id,
            "x-benchmark-question-id": question_id,
            "x-benchmark-turn-index": str(turn_index),
            "x-benchmark-has-answer": str(has_answer).lower(),
        }

        return RawStreamEvent(
            provider="gemini",
            payload=payload,
            headers=headers,
            vt_start=vt_start,
        )

    def _create_result_event(
        self,
        session_id: str,
        content: str,
        vt_start: int,
    ) -> RawStreamEvent:
        """Create a result event to finalize a turn."""
        # Estimate token counts (rough approximation: ~4 chars per token)
        output_tokens = max(1, len(content) // 4)

        # Gemini result format with stats
        payload = {
            "type": "result",
            "status": "success",
            "timestamp": datetime.now(UTC).isoformat(),
            "stats": {
                "input_tokens": 100,  # Placeholder for input
                "output_tokens": output_tokens,
                "total_tokens": 100 + output_tokens,
                "duration_ms": 100,
            },
        }

        headers = {
            "x-session-id": session_id,
        }

        return RawStreamEvent(
            provider="gemini",
            payload=payload,
            headers=headers,
            vt_start=vt_start,
        )

    def convert_batch(
        self, instances: list[LongMemEvalInstance]
    ) -> Iterator[RawStreamEvent]:
        """
        Convert multiple instances to RawStreamEvents.

        Args:
            instances: List of LongMemEval instances

        Yields:
            RawStreamEvent for each turn in all instances
        """
        for instance in instances:
            yield from self.convert_instance(instance)
