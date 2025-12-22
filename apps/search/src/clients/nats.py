"""Async NATS JetStream client wrapper."""

import json
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

import nats
from nats.js import JetStreamContext
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class NatsClientConfig(BaseModel):
    """Configuration for NATS client."""

    servers: str = Field(default="nats://localhost:4222", description="NATS server URL")
    client_name: str = Field(default="search-service", description="NATS client name")


class NatsClient:
    """Async NATS JetStream client wrapper.

    Provides publish/subscribe functionality using NATS JetStream
    for durable message delivery.
    """

    # Topic to subject mapping (legacy topic names -> NATS subjects)
    TOPIC_MAPPINGS: dict[str, str] = {
        "raw_events": "events.raw",
        "parsed_events": "events.parsed",
        "memory.turn_finalized": "memory.turns.finalized",
        "memory.node_created": "memory.nodes.created",
        "ingestion.dead_letter": "dlq.ingestion",
        "memory.dead_letter": "dlq.memory",
    }

    # Subject to stream mapping
    STREAM_MAPPINGS: dict[str, str] = {
        "events.": "EVENTS",
        "memory.": "MEMORY",
        "dlq.": "DLQ",
    }

    def __init__(self, config: NatsClientConfig | None = None) -> None:
        """Initialize NATS client.

        Args:
            config: Client configuration.
        """
        self.config = config or NatsClientConfig(
            servers=os.environ.get("NATS_URL", "nats://localhost:4222")
        )
        self._nc: nats.NATS | None = None
        self._js: JetStreamContext | None = None

    async def connect(self) -> None:
        """Connect to NATS server and initialize JetStream context."""
        if self._nc is not None:
            return

        logger.info(f"Connecting to NATS at {self.config.servers}")
        self._nc = await nats.connect(
            servers=self.config.servers,
            name=self.config.client_name,
        )
        self._js = self._nc.jetstream()
        logger.info("Connected to NATS JetStream")

    async def publish(self, topic: str, key: str, message: dict[str, Any]) -> None:
        """Publish a message to a NATS subject.

        Args:
            topic: Topic name (will be mapped to NATS subject).
            key: Message key for deduplication.
            message: Message payload.
        """
        await self.connect()

        subject = self._topic_to_subject(topic)
        payload = json.dumps(message).encode("utf-8")

        await self._js.publish(subject, payload, headers={"Nats-Msg-Id": key})
        logger.debug(f"Published message to {subject} with key {key}")

    async def subscribe(
        self,
        topic: str,
        group_id: str,
        handler: Callable[[str, dict[str, Any]], Awaitable[None]],
    ) -> None:
        """Subscribe to a topic and process messages.

        Args:
            topic: Topic name.
            group_id: Consumer group ID (becomes durable consumer name).
            handler: Async callback for processing messages.
        """
        await self.connect()

        subject = self._topic_to_subject(topic)
        stream = self._subject_to_stream(subject)

        logger.info(f"Subscribing to {subject} on stream {stream} as {group_id}")

        # Create or get the pull subscription
        psub = await self._js.pull_subscribe(
            subject=subject,
            durable=group_id,
            stream=stream,
            config=ConsumerConfig(
                durable_name=group_id,
                ack_policy=AckPolicy.EXPLICIT,
                deliver_policy=DeliverPolicy.ALL,
            ),
        )

        logger.info(f"Started consuming from {subject}")

        while True:
            try:
                # Fetch messages in batches
                msgs = await psub.fetch(batch=10, timeout=5)

                for msg in msgs:
                    try:
                        data = json.loads(msg.data.decode("utf-8"))
                        await handler(msg.subject, data)
                        await msg.ack()
                    except Exception as e:
                        logger.error(f"Error processing message: {e}", exc_info=True)
                        await msg.nak()

            except nats.errors.TimeoutError:
                # No messages available, continue polling
                continue
            except Exception as e:
                logger.error(f"Error fetching messages: {e}", exc_info=True)
                continue

    async def close(self) -> None:
        """Close the NATS connection."""
        if self._nc is not None:
            await self._nc.drain()
            await self._nc.close()
            self._nc = None
            self._js = None
            logger.info("NATS connection closed")

    def _topic_to_subject(self, topic: str) -> str:
        """Map topic name to NATS subject."""
        return self.TOPIC_MAPPINGS.get(topic, topic.replace("_", "."))

    def _subject_to_stream(self, subject: str) -> str:
        """Determine which stream a subject belongs to."""
        for prefix, stream in self.STREAM_MAPPINGS.items():
            if subject.startswith(prefix):
                return stream
        raise ValueError(f"Unknown stream for subject: {subject}")

    async def __aenter__(self) -> "NatsClient":
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit."""
        await self.close()
