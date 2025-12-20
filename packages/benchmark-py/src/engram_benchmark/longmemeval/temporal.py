"""
Temporal query enhancement for time-aware retrieval.

Parses temporal references in questions and enhances queries with
temporal context for improved retrieval in time-sensitive scenarios.
"""

import re
from datetime import datetime, timedelta
from typing import Literal

import dateparser
from pydantic import BaseModel, Field

from engram_benchmark.longmemeval.types import ParsedInstance


class TemporalReference(BaseModel):
    """A temporal reference found in a question."""

    text: str = Field(description="Original temporal text (e.g., 'last week')")
    type: Literal["absolute", "relative", "duration"] = Field(
        description="Type of temporal reference"
    )
    parsed_date: datetime | None = Field(
        default=None,
        description="Parsed datetime (if absolute or relative)",
    )
    days_offset: int | None = Field(
        default=None,
        description="Days offset from reference date (if relative)",
    )


class TemporalQuery(BaseModel):
    """Query with temporal information extracted."""

    question_id: str
    original_query: str
    temporal_refs: list[TemporalReference] = Field(default_factory=list)
    enhanced_query: str | None = None
    time_filter: dict[str, datetime] | None = Field(
        default=None,
        description="Time range filter (start_date, end_date)",
    )


class TemporalQueryEnhancer:
    """
    Enhances queries with temporal context.

    Parses temporal references in questions and adds temporal filtering
    hints for improved retrieval of time-sensitive information.

    Examples:
            >>> enhancer = TemporalQueryEnhancer()
            >>> result = enhancer.enhance_query(instance)
            >>> if result.time_filter:
            ...     print(f"Filter from {result.time_filter['start_date']}")
    """

    # Common temporal patterns
    TEMPORAL_PATTERNS = [
        # Relative dates
        (r"last\s+(week|month|year)", "relative"),
        (r"this\s+(week|month|year)", "relative"),
        (r"next\s+(week|month|year)", "relative"),
        (r"(\d+)\s+days?\s+ago", "relative"),
        (r"(\d+)\s+weeks?\s+ago", "relative"),
        (r"(\d+)\s+months?\s+ago", "relative"),
        (r"yesterday", "relative"),
        (r"today", "relative"),
        (r"tomorrow", "relative"),
        # Absolute dates
        (r"\d{4}-\d{2}-\d{2}", "absolute"),
        (r"\d{1,2}/\d{1,2}/\d{4}", "absolute"),
        (
            r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}",
            "absolute",
        ),
        # Durations
        (r"in\s+the\s+(last|past)\s+(\d+)\s+(days?|weeks?|months?|years?)", "duration"),
    ]

    def __init__(self, reference_date: datetime | None = None) -> None:
        """
        Initialize temporal query enhancer.

        Args:
                reference_date: Reference date for relative date parsing
                        (defaults to question_date from instance)
        """
        self.reference_date = reference_date

    def enhance_query(self, instance: ParsedInstance) -> TemporalQuery:
        """
        Enhance a query with temporal information.

        Args:
                instance: ParsedInstance with question and metadata

        Returns:
                TemporalQuery with temporal references and filters
        """
        # Use instance question date as reference
        ref_date = self.reference_date or instance.question_date

        # Extract temporal references
        temporal_refs = self._extract_temporal_refs(instance.question, ref_date)

        # Generate time filter if temporal refs found
        time_filter = self._generate_time_filter(temporal_refs, ref_date)

        # Enhance query with temporal context
        enhanced_query = self._enhance_query_text(instance.question, temporal_refs, ref_date)

        return TemporalQuery(
            question_id=instance.question_id,
            original_query=instance.question,
            temporal_refs=temporal_refs,
            enhanced_query=enhanced_query,
            time_filter=time_filter,
        )

    def _extract_temporal_refs(self, query: str, ref_date: datetime) -> list[TemporalReference]:
        """Extract temporal references from query text."""
        refs: list[TemporalReference] = []
        query_lower = query.lower()

        for pattern, ref_type in self.TEMPORAL_PATTERNS:
            matches = re.finditer(pattern, query_lower, re.IGNORECASE)

            for match in matches:
                text = match.group(0)

                # Try to parse the temporal expression
                parsed_date = None
                days_offset = None

                if ref_type in ["absolute", "relative"]:
                    # Use dateparser with reference date
                    parsed_date = dateparser.parse(
                        text,
                        settings={
                            "RELATIVE_BASE": ref_date,
                            "PREFER_DATES_FROM": "past",
                        },
                    )

                    # Calculate offset if relative
                    if ref_type == "relative" and parsed_date:
                        days_offset = (ref_date - parsed_date).days

                refs.append(
                    TemporalReference(
                        text=text,
                        type=ref_type,  # type: ignore
                        parsed_date=parsed_date,
                        days_offset=days_offset,
                    )
                )

        return refs

    def _generate_time_filter(
        self, refs: list[TemporalReference], ref_date: datetime
    ) -> dict[str, datetime] | None:
        """Generate time range filter from temporal references."""
        if not refs:
            return None

        # Find earliest and latest dates
        dates = [ref.parsed_date for ref in refs if ref.parsed_date is not None]

        if not dates:
            return None

        # Create a time window around the temporal references
        earliest = min(dates)
        latest = max(dates)

        # Add some buffer (e.g., ±7 days)
        buffer_days = 7

        return {
            "start_date": earliest - timedelta(days=buffer_days),
            "end_date": latest + timedelta(days=buffer_days),
        }

    def _enhance_query_text(
        self, query: str, refs: list[TemporalReference], ref_date: datetime
    ) -> str | None:
        """Enhance query text with temporal context."""
        if not refs:
            return None

        # Add temporal context hint
        temporal_hints = []
        for ref in refs:
            if ref.parsed_date:
                date_str = ref.parsed_date.strftime("%Y-%m-%d")
                temporal_hints.append(f"around {date_str}")

        if temporal_hints:
            enhanced = f"{query} (temporal context: {', '.join(temporal_hints)})"
            return enhanced

        return None


def enhance_queries_batch(
    instances: list[ParsedInstance],
    enhancer: TemporalQueryEnhancer | None = None,
) -> list[TemporalQuery]:
    """
    Enhance a batch of queries with temporal information.

    Args:
            instances: List of ParsedInstance objects
            enhancer: Optional TemporalQueryEnhancer (creates default if None)

    Returns:
            List of TemporalQuery objects
    """
    if enhancer is None:
        enhancer = TemporalQueryEnhancer()

    return [enhancer.enhance_query(instance) for instance in instances]
