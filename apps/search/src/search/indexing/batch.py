"""Batch queue for efficient document indexing."""

import asyncio
import contextlib
import logging
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class BatchConfig(BaseModel):
    """Configuration for batch indexing."""

    batch_size: int = Field(default=100, description="Max documents per batch")
    flush_interval_ms: int = Field(default=5000, description="Max ms before flush")
    max_queue_size: int = Field(default=1000, description="Max pending documents")


class Document(BaseModel):
    """Document to be indexed."""

    id: str
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    session_id: str | None = None


class BatchQueue:
    """Async batch queue with automatic flushing.

    Collects documents and flushes them to the indexer when either:
    - The batch size is reached
    - The flush interval has elapsed
    - The queue is stopped (final flush)
    """

    def __init__(
        self,
        config: BatchConfig,
        flush_callback: Callable[[list[Document]], Any],
    ) -> None:
        """Initialize the batch queue.

        Args:
            config: Batch configuration.
            flush_callback: Async callback to invoke when flushing a batch.
        """
        self.config = config
        self._flush_callback = flush_callback
        self._queue: list[Document] = []
        self._lock = asyncio.Lock()
        self._flush_task: asyncio.Task[None] | None = None
        self._running = False

    async def start(self) -> None:
        """Start the batch queue flush timer.

        Begins a background task that periodically flushes the queue
        based on the configured flush interval.
        """
        if self._running:
            logger.warning("BatchQueue already started")
            return

        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())
        logger.info(
            f"BatchQueue started (batch_size={self.config.batch_size}, "
            f"flush_interval={self.config.flush_interval_ms}ms)"
        )

    async def stop(self) -> None:
        """Stop the queue and flush remaining documents.

        Cancels the background flush task and performs a final flush
        of any documents remaining in the queue.
        """
        if not self._running:
            return

        logger.info("Stopping BatchQueue...")
        self._running = False

        # Cancel background flush task
        if self._flush_task is not None:
            self._flush_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._flush_task
            self._flush_task = None

        # Final flush
        await self._flush()
        logger.info("BatchQueue stopped")

    async def add(self, document: Document) -> None:
        """Add a document to the queue.

        If the queue reaches the configured batch size, it will be flushed immediately.

        Args:
            document: Document to add to the queue.

        Raises:
            RuntimeError: If queue has reached max capacity.
        """
        async with self._lock:
            # Check queue capacity
            if len(self._queue) >= self.config.max_queue_size:
                logger.error(
                    f"BatchQueue at max capacity ({self.config.max_queue_size}). Dropping document."
                )
                raise RuntimeError("BatchQueue at max capacity")

            self._queue.append(document)

            # Flush if batch size reached
            if len(self._queue) >= self.config.batch_size:
                await self._flush()

    async def _flush(self) -> None:
        """Flush the current batch to the indexer.

        Swaps the queue with an empty list and processes the batch
        asynchronously. Errors in the flush callback are logged but
        don't crash the queue.
        """
        async with self._lock:
            if len(self._queue) == 0:
                return

            # Swap queue with empty list to avoid blocking new additions
            batch = self._queue
            self._queue = []

        logger.info(f"Flushing batch of {len(batch)} documents")

        try:
            # Call the flush callback (indexer.index_documents)
            result = self._flush_callback(batch)

            # If callback returns a coroutine, await it
            if asyncio.iscoroutine(result):
                await result

            logger.info(f"Successfully flushed {len(batch)} documents")
        except Exception as e:
            logger.error(f"Error flushing batch: {e}", exc_info=True)
            # Don't re-raise - we don't want to crash the flush loop

    async def _flush_loop(self) -> None:
        """Background loop for timed flushing.

        Wakes up periodically to flush any pending documents that haven't
        reached the batch size threshold.
        """
        flush_interval_s = self.config.flush_interval_ms / 1000.0

        try:
            while self._running:
                await asyncio.sleep(flush_interval_s)
                await self._flush()
        except asyncio.CancelledError:
            logger.debug("Flush loop cancelled")
        except Exception as e:
            logger.error(f"Error in flush loop: {e}", exc_info=True)

    @property
    def queue_size(self) -> int:
        """Get the current queue size.

        Returns:
            Number of documents currently in the queue.
        """
        return len(self._queue)
