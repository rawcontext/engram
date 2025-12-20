"""Kafka consumer for memory node events."""

import asyncio
import contextlib
import json
import logging
import uuid
from typing import Any

from aiokafka import AIOKafkaConsumer
from pydantic import BaseModel, Field

from search.clients.kafka import KafkaClient
from search.clients.redis import RedisPublisher
from search.indexing.batch import BatchConfig, BatchQueue, Document
from search.indexing.indexer import DocumentIndexer, IndexerConfig

logger = logging.getLogger(__name__)


class MemoryConsumerConfig(BaseModel):
    """Configuration for memory event consumer."""

    topic: str = Field(default="memory.node_created", description="Kafka topic")
    group_id: str = Field(default="search-indexer", description="Consumer group ID")
    batch_config: BatchConfig = Field(default_factory=BatchConfig)
    indexer_config: IndexerConfig = Field(default_factory=IndexerConfig)
    heartbeat_interval_ms: int = Field(default=30000, description="Redis heartbeat interval")
    service_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])


class MemoryEventConsumer:
    """Consumes memory node events from Kafka and indexes them to Qdrant.

    Subscribes to the memory.node_created Kafka topic, extracts documents
    from events, and batches them for efficient indexing with multi-vector embeddings.

    Publishes consumer status updates to Redis for monitoring.
    """

    def __init__(
        self,
        kafka_client: KafkaClient,
        indexer: DocumentIndexer,
        redis_publisher: RedisPublisher | None = None,
        config: MemoryConsumerConfig | None = None,
    ) -> None:
        """Initialize the memory event consumer.

        Args:
            kafka_client: Kafka client for consuming events.
            indexer: Document indexer for generating embeddings and upserting to Qdrant.
            redis_publisher: Optional Redis publisher for status updates.
            config: Consumer configuration.
        """
        self.kafka = kafka_client
        self.indexer = indexer
        self.redis = redis_publisher
        self.config = config or MemoryConsumerConfig()
        self._consumer: AIOKafkaConsumer | None = None
        self._batch_queue: BatchQueue | None = None
        self._running = False
        self._heartbeat_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the consumer and begin processing events.

        Creates the Kafka consumer, subscribes to the topic, initializes
        the batch queue, and begins consuming messages.
        """
        if self._running:
            logger.warning("Consumer already running")
            return

        logger.info(
            f"Starting memory consumer for topic '{self.config.topic}' "
            f"(group: {self.config.group_id}, service: {self.config.service_id})"
        )

        # Create Kafka consumer
        self._consumer = await self.kafka.create_consumer(
            topics=[self.config.topic], group_id=self.config.group_id
        )

        # Create batch queue with indexing callback
        self._batch_queue = BatchQueue(
            config=self.config.batch_config,
            flush_callback=self.indexer.index_documents,
        )

        # Start batch queue
        await self._batch_queue.start()

        # Publish consumer_ready to Redis
        if self.redis:
            try:
                await self.redis.publish_consumer_status(
                    status_type="consumer_ready",
                    group_id=self.config.group_id,
                    service_id=self.config.service_id,
                )
            except Exception as e:
                logger.warning(f"Failed to publish consumer_ready status: {e}")

        # Start heartbeat task
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        # Begin consuming messages
        self._running = True
        logger.info("Memory consumer started, beginning message consumption")

        try:
            async for message in self._consumer:
                if not self._running:
                    break

                await self._process_message(message)

        except asyncio.CancelledError:
            logger.info("Consumer task cancelled")
        except Exception as e:
            logger.error(f"Error in consumer loop: {e}", exc_info=True)
        finally:
            await self.stop()

    async def stop(self) -> None:
        """Stop the consumer gracefully.

        Stops message consumption, flushes remaining batches,
        cancels heartbeat, and publishes disconnection status.
        """
        if not self._running:
            return

        logger.info("Stopping memory consumer...")
        self._running = False

        # Stop heartbeat
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._heartbeat_task
            self._heartbeat_task = None

        # Flush batch queue
        if self._batch_queue is not None:
            await self._batch_queue.stop()
            self._batch_queue = None

        # Publish consumer_disconnected to Redis
        if self.redis:
            try:
                await self.redis.publish_consumer_status(
                    status_type="consumer_disconnected",
                    group_id=self.config.group_id,
                    service_id=self.config.service_id,
                )
            except Exception as e:
                logger.warning(f"Failed to publish consumer_disconnected status: {e}")

        # Disconnect consumer
        if self._consumer is not None:
            await self._consumer.stop()
            self._consumer = None

        logger.info("Memory consumer stopped")

    async def _process_message(self, message: Any) -> None:
        """Process a single Kafka message.

        Parses the message, extracts the document, and adds it to the batch queue.

        Args:
            message: Kafka message from aiokafka.
        """
        try:
            # Decode message value
            value = message.value
            if isinstance(value, bytes):
                value = value.decode("utf-8")

            # Parse JSON
            data = json.loads(value)

            # Extract document from memory node event
            document = self._parse_memory_node(data)
            if document is None:
                logger.warning(f"Failed to parse memory node from message: {data}")
                return

            # Add to batch queue
            if self._batch_queue is not None:
                await self._batch_queue.add(document)
                logger.debug(f"Added document {document.id} to batch queue")

        except json.JSONDecodeError as e:
            logger.error(f"Failed to decode JSON message: {e}")
        except Exception as e:
            logger.error(f"Error processing message: {e}", exc_info=True)

    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats to Redis.

        Publishes a heartbeat message at the configured interval
        to indicate the consumer is still alive and processing.
        """
        heartbeat_interval_s = self.config.heartbeat_interval_ms / 1000.0

        try:
            while self._running:
                await asyncio.sleep(heartbeat_interval_s)

                if self.redis:
                    try:
                        await self.redis.publish_consumer_status(
                            status_type="consumer_heartbeat",
                            group_id=self.config.group_id,
                            service_id=self.config.service_id,
                        )
                        logger.debug("Published consumer heartbeat")
                    except Exception as e:
                        logger.warning(f"Failed to publish heartbeat: {e}")

        except asyncio.CancelledError:
            logger.debug("Heartbeat loop cancelled")
        except Exception as e:
            logger.error(f"Error in heartbeat loop: {e}", exc_info=True)

    def _parse_memory_node(self, data: dict[str, Any]) -> Document | None:
        """Parse a memory node event into a Document.

        Expected event structure:
        {
            "id": "node-id",
            "content": "text content",
            "type": "thought|code|doc",
            "sessionId": "session-id",
            "metadata": { ... }
        }

        Args:
            data: Memory node event payload.

        Returns:
            Document instance or None if parsing fails.
        """
        try:
            # Extract required fields
            node_id = data.get("id")
            content = data.get("content")

            if not node_id or not content:
                logger.warning(f"Missing required fields in memory node: {data}")
                return None

            # Extract metadata
            metadata = data.get("metadata", {})

            # Add type to metadata if present
            node_type = data.get("type")
            if node_type:
                metadata["type"] = node_type

            # Extract session ID
            session_id = data.get("sessionId")

            return Document(
                id=str(node_id),
                content=str(content),
                metadata=metadata,
                session_id=session_id,
            )

        except Exception as e:
            logger.error(f"Error parsing memory node: {e}", exc_info=True)
            return None
