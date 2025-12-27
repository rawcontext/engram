"""
Event streamer for ingesting benchmark data into Engram.

Streams RawStreamEvents to the Engram ingestion endpoint with
rate limiting and progress tracking.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable

import httpx
from pydantic import BaseModel

from engram_benchmark.ingest.converter import RawStreamEvent

logger = logging.getLogger(__name__)


class IngestResult(BaseModel):
    """Result of ingesting a single event."""

    event_id: str
    success: bool
    error: str | None = None


class IngestStats(BaseModel):
    """Statistics from an ingestion run."""

    total_events: int = 0
    successful: int = 0
    failed: int = 0
    sessions: set[str] = set()

    class Config:
        arbitrary_types_allowed = True


class EventStreamer:
    """
    Streams RawStreamEvents to Engram ingestion endpoint.

    Features:
    - Async HTTP client with connection pooling
    - Configurable rate limiting
    - Retry logic for transient failures
    - Progress tracking
    """

    def __init__(
        self,
        ingestion_url: str = "http://localhost:6175/ingest",
        api_key: str | None = None,
        rate_limit: float = 100.0,  # events per second
        max_retries: int = 3,
        timeout: float = 30.0,
    ) -> None:
        """
        Initialize event streamer.

        Args:
            ingestion_url: URL of the Engram ingestion endpoint
            api_key: Optional API key for authentication
            rate_limit: Maximum events per second
            max_retries: Maximum retry attempts for failed requests
            timeout: Request timeout in seconds
        """
        self.ingestion_url = ingestion_url
        self.api_key = api_key
        self.rate_limit = rate_limit
        self.max_retries = max_retries
        self.timeout = timeout
        self._delay = 1.0 / rate_limit if rate_limit > 0 else 0

        # Build headers
        self._headers = {"Content-Type": "application/json"}
        if api_key:
            self._headers["Authorization"] = f"Bearer {api_key}"

    async def stream_events(
        self,
        events: AsyncIterator[RawStreamEvent],
        progress_callback: Callable | None = None,
    ) -> IngestStats:
        """
        Stream events to the ingestion endpoint.

        Args:
            events: Async iterator of RawStreamEvents
            progress_callback: Optional callback(stats) for progress updates

        Returns:
            IngestStats with summary of the ingestion
        """
        stats = IngestStats()

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async for event in events:
                result = await self._ingest_event(client, event)
                stats.total_events += 1

                if result.success:
                    stats.successful += 1
                    # Track unique sessions
                    session_id = event.headers.get("x-session-id", "")
                    if session_id:
                        stats.sessions.add(session_id)
                else:
                    stats.failed += 1
                    logger.warning(f"Failed to ingest event {event.event_id}: {result.error}")

                # Rate limiting
                if self._delay > 0:
                    await asyncio.sleep(self._delay)

                # Progress callback
                if progress_callback and stats.total_events % 100 == 0:
                    progress_callback(stats)

        return stats

    async def stream_events_sync(
        self,
        events: list[RawStreamEvent],
        progress_callback: Callable | None = None,
    ) -> IngestStats:
        """
        Stream a list of events (sync-friendly wrapper).

        Args:
            events: List of RawStreamEvents
            progress_callback: Optional callback(stats) for progress updates

        Returns:
            IngestStats with summary of the ingestion
        """

        async def event_iter() -> AsyncIterator[RawStreamEvent]:
            for event in events:
                yield event

        return await self.stream_events(event_iter(), progress_callback)

    async def _ingest_event(
        self,
        client: httpx.AsyncClient,
        event: RawStreamEvent,
    ) -> IngestResult:
        """Ingest a single event with retry logic."""
        for attempt in range(self.max_retries):
            try:
                response = await client.post(
                    self.ingestion_url,
                    json=event.model_dump(),
                    headers=self._headers,
                )

                if response.status_code == 200:
                    return IngestResult(event_id=event.event_id, success=True)
                else:
                    error = f"HTTP {response.status_code}: {response.text}"
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(0.5 * (attempt + 1))  # Backoff
                        continue
                    return IngestResult(event_id=event.event_id, success=False, error=error)

            except httpx.RequestError as e:
                error = str(e)
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                return IngestResult(event_id=event.event_id, success=False, error=error)

        return IngestResult(event_id=event.event_id, success=False, error="Max retries exceeded")
