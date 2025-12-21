"""Async Kafka client wrapper using aiokafka."""

import json
import logging
from typing import Any

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class ProducerConfig(BaseModel):
    """Configuration for Kafka producer."""

    bootstrap_servers: list[str] = Field(
        default=["localhost:19092"], description="Kafka bootstrap servers"
    )
    client_id: str = Field(default="search-producer", description="Kafka client ID")
    compression_type: str = Field(default="gzip", description="Compression type")
    request_timeout_ms: int = Field(default=30000, description="Request timeout in milliseconds")


class ConsumerConfig(BaseModel):
    """Configuration for Kafka consumer."""

    bootstrap_servers: list[str] = Field(
        default=["localhost:19092"], description="Kafka bootstrap servers"
    )
    group_id: str = Field(default="search-indexer", description="Consumer group ID")
    auto_offset_reset: str = Field(default="earliest", description="Auto offset reset strategy")
    enable_auto_commit: bool = Field(default=True, description="Enable auto commit")
    session_timeout_ms: int = Field(default=120000, description="Session timeout (2 minutes)")
    max_poll_interval_ms: int = Field(default=180000, description="Max poll interval (3 minutes)")


class KafkaClient:
    """Async Kafka client wrapper with producer and consumer management."""

    def __init__(
        self,
        bootstrap_servers: list[str] | None = None,
        producer_config: ProducerConfig | None = None,
        consumer_config: ConsumerConfig | None = None,
    ) -> None:
        """Initialize Kafka client.

        Args:
            bootstrap_servers: Kafka bootstrap servers. Overrides config if provided.
            producer_config: Producer configuration.
            consumer_config: Consumer configuration.
        """
        self._producer_config = producer_config or ProducerConfig()
        self._consumer_config = consumer_config or ConsumerConfig()

        # Override bootstrap servers if provided
        if bootstrap_servers:
            self._producer_config.bootstrap_servers = bootstrap_servers
            self._consumer_config.bootstrap_servers = bootstrap_servers

        self._producer: AIOKafkaProducer | None = None
        self._consumers: dict[str, AIOKafkaConsumer] = {}

    async def get_producer(self) -> AIOKafkaProducer:
        """Get or create Kafka producer.

        Returns:
            AIOKafkaProducer instance.
        """
        if self._producer is None:
            logger.info(f"Creating Kafka producer for {self._producer_config.bootstrap_servers}")
            self._producer = AIOKafkaProducer(
                bootstrap_servers=self._producer_config.bootstrap_servers,
                client_id=self._producer_config.client_id,
                compression_type=self._producer_config.compression_type,
                request_timeout_ms=self._producer_config.request_timeout_ms,
            )
            await self._producer.start()
            logger.info("Kafka producer started")

        return self._producer

    async def create_consumer(
        self, topics: list[str], group_id: str | None = None
    ) -> AIOKafkaConsumer:
        """Create a new Kafka consumer.

        Args:
            topics: List of topics to subscribe to.
            group_id: Consumer group ID (uses config default if not provided).

        Returns:
            AIOKafkaConsumer instance.
        """
        consumer_group_id = group_id or self._consumer_config.group_id
        consumer_key = f"{consumer_group_id}:{','.join(sorted(topics))}"

        if consumer_key in self._consumers:
            logger.warning(f"Consumer for {consumer_key} already exists")
            return self._consumers[consumer_key]

        logger.info(f"Creating Kafka consumer for topics {topics} with group {consumer_group_id}")

        consumer = AIOKafkaConsumer(
            *topics,
            bootstrap_servers=self._consumer_config.bootstrap_servers,
            group_id=consumer_group_id,
            auto_offset_reset=self._consumer_config.auto_offset_reset,
            enable_auto_commit=self._consumer_config.enable_auto_commit,
            session_timeout_ms=self._consumer_config.session_timeout_ms,
            max_poll_interval_ms=self._consumer_config.max_poll_interval_ms,
        )

        await consumer.start()
        self._consumers[consumer_key] = consumer
        logger.info(f"Kafka consumer started for {consumer_key}")

        return consumer

    async def send_event(self, topic: str, key: str, message: dict[str, Any]) -> None:
        """Send an event to a Kafka topic.

        Args:
            topic: Kafka topic name.
            key: Message key for partitioning.
            message: Message payload.
        """
        producer = await self.get_producer()

        # Serialize message to JSON bytes
        value = json.dumps(message).encode("utf-8")
        key_bytes = key.encode("utf-8")

        await producer.send_and_wait(topic, value=value, key=key_bytes)
        logger.debug(f"Sent message to {topic} with key {key}")

    async def close(self) -> None:
        """Close all producers and consumers."""
        logger.info("Closing Kafka client")

        # Close producer
        if self._producer:
            await self._producer.stop()
            self._producer = None
            logger.info("Kafka producer stopped")

        # Close all consumers
        for consumer_key, consumer in self._consumers.items():
            await consumer.stop()
            logger.info(f"Kafka consumer stopped: {consumer_key}")

        self._consumers.clear()

    async def __aenter__(self) -> "KafkaClient":
        """Async context manager entry.

        Returns:
            Self for context manager protocol.
        """
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit.

        Args:
            exc_type: Exception type if an exception was raised.
            exc_val: Exception value if an exception was raised.
            exc_tb: Exception traceback if an exception was raised.
        """
        await self.close()
