"""Async NATS Core pub/sub wrapper for real-time updates.

This module provides NATS Core pub/sub functionality (not JetStream) for
ephemeral real-time messaging. Used for consumer status updates and
WebSocket notifications.

This replaces the Redis pub/sub implementation and mirrors the TypeScript
createNatsPubSubPublisher/createNatsPubSubSubscriber from @engram/storage.
"""

import asyncio
import json
import logging
import os
from collections.abc import Callable
from typing import Any

import nats
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class SessionUpdate(BaseModel):
    """Session update event published via NATS pub/sub.

    Supports various session-related events like lineage, timeline updates,
    and node creation notifications.
    """

    type: str = Field(
        description="Event type: lineage, timeline, node_created, session_created, etc."
    )
    sessionId: str = Field(  # noqa: N815 - matches TypeScript interface
        description="Session ID this update belongs to"
    )
    data: dict[str, Any] = Field(description="Event-specific payload data")
    timestamp: int = Field(description="Unix timestamp in milliseconds")


class ConsumerStatusUpdate(BaseModel):
    """Consumer status event published via NATS pub/sub.

    Tracks consumer lifecycle events for monitoring and coordination.
    """

    type: str = Field(
        description="Status type: consumer_ready, consumer_disconnected, consumer_heartbeat"
    )
    groupId: str = Field(  # noqa: N815 - matches TypeScript interface
        description="Consumer group identifier"
    )
    serviceId: str = Field(  # noqa: N815 - matches TypeScript interface
        description="Unique service instance identifier"
    )
    timestamp: int = Field(description="Unix timestamp in milliseconds")


# Subject patterns for pub/sub (Core NATS, not JetStream)
PUBSUB_SUBJECTS = {
    "session_updates": lambda session_id: f"observatory.session.{session_id}.updates",
    "sessions_global": "observatory.sessions.updates",
    "consumers_status": "observatory.consumers.status",
}


class NatsPubSubPublisher:
    """NATS Core pub/sub publisher for real-time updates.

    Uses ephemeral Core NATS (not JetStream) for real-time updates.
    Matches the TypeScript NatsPubSubPublisher interface for consistency.
    """

    def __init__(self, url: str | None = None) -> None:
        """Initialize the NATS pub/sub publisher.

        Args:
            url: NATS connection URL. Defaults to NATS_URL env var.
        """
        self.url = url or os.environ.get("NATS_URL", "nats://localhost:4222")
        self._nc: nats.NATS | None = None
        self._connect_promise: asyncio.Task[nats.NATS] | None = None

    async def connect(self) -> nats.NATS:
        """Connect to NATS server with connection reuse.

        Returns existing connection if already open, otherwise creates new connection.

        Returns:
            Connected NATS client instance.
        """
        # Return existing open client
        if self._nc is not None and self._nc.is_connected:
            return self._nc

        # If already connecting, wait for that attempt
        if self._connect_promise is not None:
            return await self._connect_promise

        # Start new connection attempt
        async def _connect() -> nats.NATS:
            try:
                logger.info(f"Connecting to NATS pub/sub at {self.url}")
                nc = await nats.connect(servers=self.url, name="search-pubsub")
                self._nc = nc
                logger.info("NATS pub/sub publisher connected successfully")
                return nc
            finally:
                # Clear promise after completion (success or failure)
                self._connect_promise = None

        self._connect_promise = asyncio.create_task(_connect())
        return await self._connect_promise

    async def publish_session_update(
        self, session_id: str, update_type: str, data: dict[str, Any]
    ) -> None:
        """Publish a session-specific update event.

        Args:
            session_id: The session ID to publish to.
            update_type: The type of update (lineage, timeline, node_created, etc.).
            data: Event-specific payload data.
        """
        nc = await self.connect()
        subject = PUBSUB_SUBJECTS["session_updates"](session_id)

        message = SessionUpdate(
            type=update_type,
            sessionId=session_id,
            data=data,
            timestamp=int(asyncio.get_event_loop().time() * 1000),
        )

        await nc.publish(subject, message.model_dump_json().encode("utf-8"))
        logger.debug(f"Published {update_type} to {subject}")

    async def publish_global_session_event(
        self, event_type: str, session_data: dict[str, Any]
    ) -> None:
        """Publish a global session event to the sessions subject.

        Used for homepage session list updates and other cross-session notifications.

        Args:
            event_type: Event type (session_created, session_updated, session_closed).
            session_data: Session metadata or update payload.
        """
        nc = await self.connect()
        subject = PUBSUB_SUBJECTS["sessions_global"]

        message = SessionUpdate(
            type=event_type,
            sessionId="",  # Global event, not tied to specific session
            data=session_data,
            timestamp=int(asyncio.get_event_loop().time() * 1000),
        )

        await nc.publish(subject, message.model_dump_json().encode("utf-8"))
        logger.debug(f"Published global session event: {event_type}")

    async def publish_consumer_status(
        self, status_type: str, group_id: str, service_id: str
    ) -> None:
        """Publish a consumer status update to the consumers status subject.

        Args:
            status_type: Status event type (consumer_ready, consumer_disconnected,
                consumer_heartbeat).
            group_id: Consumer group identifier.
            service_id: Unique service instance identifier.
        """
        nc = await self.connect()
        subject = PUBSUB_SUBJECTS["consumers_status"]

        message = ConsumerStatusUpdate(
            type=status_type,
            groupId=group_id,
            serviceId=service_id,
            timestamp=int(asyncio.get_event_loop().time() * 1000),
        )

        await nc.publish(subject, message.model_dump_json().encode("utf-8"))
        logger.debug(f"Published consumer status: {status_type} for {service_id}")

    async def disconnect(self) -> None:
        """Close the NATS connection.

        Properly cleans up the NATS client connection.
        """
        if self._nc is not None:
            logger.info("Disconnecting NATS pub/sub publisher")
            await self._nc.drain()
            await self._nc.close()
            self._nc = None

    async def __aenter__(self) -> "NatsPubSubPublisher":
        """Async context manager entry.

        Returns:
            Self for context manager protocol.
        """
        await self.connect()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit.

        Args:
            exc_type: Exception type if an exception was raised.
            exc_val: Exception value if an exception was raised.
            exc_tb: Exception traceback if an exception was raised.
        """
        await self.disconnect()


class NatsPubSubSubscriber:
    """NATS Core pub/sub subscriber for receiving real-time updates.

    Uses ephemeral Core NATS (not JetStream) for real-time updates.
    Matches the TypeScript NatsPubSubSubscriber interface for consistency.
    """

    def __init__(self, url: str | None = None) -> None:
        """Initialize the NATS pub/sub subscriber.

        Args:
            url: NATS connection URL. Defaults to NATS_URL env var.
        """
        self.url = url or os.environ.get("NATS_URL", "nats://localhost:4222")
        self._nc: nats.NATS | None = None
        self._subscriptions: dict[
            str, tuple[nats.Subscription, set[Callable[[dict[str, Any]], None]]]
        ] = {}

    async def connect(self) -> nats.NATS:
        """Connect to NATS server.

        Returns:
            Connected NATS client instance.
        """
        if self._nc is not None and self._nc.is_connected:
            return self._nc

        logger.info(f"Connecting to NATS pub/sub subscriber at {self.url}")
        self._nc = await nats.connect(servers=self.url, name="search-subscriber")
        logger.info("NATS pub/sub subscriber connected successfully")

        return self._nc

    async def subscribe(
        self, channel_or_session_id: str, callback: Callable[[dict[str, Any]], None]
    ) -> Callable[[], None]:
        """Subscribe to a subject with a callback function.

        Supports both session-specific subjects (by session ID) and global subjects
        (by full subject name like "observatory.sessions.updates").

        Args:
            channel_or_session_id: Either a full subject name or a session ID.
            callback: Function to call when messages arrive on this subject.

        Returns:
            Unsubscribe function to remove this callback.
        """
        await self.connect()

        # Determine if this is a full subject name or a session ID
        if "." in channel_or_session_id:
            subject = channel_or_session_id  # Already a full subject name
        else:
            subject = PUBSUB_SUBJECTS["session_updates"](channel_or_session_id)

        # Track callbacks per subject
        if subject not in self._subscriptions:
            # Create message handler
            async def message_handler(msg: nats.Msg) -> None:
                try:
                    parsed = json.loads(msg.data.decode("utf-8"))
                    entry = self._subscriptions.get(msg.subject)
                    if entry:
                        for cb in entry[1]:
                            try:
                                cb(parsed)
                            except Exception as e:
                                logger.error(
                                    f"Error in subscription callback for {msg.subject}: {e}"
                                )
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse message from {msg.subject}: {e}")

            # Subscribe to the subject
            sub = await self._nc.subscribe(subject, cb=message_handler)
            self._subscriptions[subject] = (sub, set())
            logger.info(f"Subscribed to subject: {subject}")

        self._subscriptions[subject][1].add(callback)

        # Return unsubscribe function
        def unsubscribe() -> None:
            entry = self._subscriptions.get(subject)
            if entry:
                entry[1].discard(callback)
                # Clean up subscription if no more callbacks
                if len(entry[1]) == 0:
                    self._subscriptions.pop(subject, None)
                    # Fire and forget unsubscribe
                    asyncio.create_task(entry[0].unsubscribe())
                    logger.info(f"Unsubscribed from subject: {subject}")

        return unsubscribe

    async def subscribe_to_consumer_status(
        self, callback: Callable[[dict[str, Any]], None]
    ) -> Callable[[], None]:
        """Subscribe to consumer status updates on the consumers status subject.

        Args:
            callback: Function to call when consumer status messages arrive.

        Returns:
            Unsubscribe function to remove this callback.
        """
        return await self.subscribe(PUBSUB_SUBJECTS["consumers_status"], callback)

    async def disconnect(self) -> None:
        """Disconnect from NATS and clean up resources.

        Unsubscribes from all subjects and closes the connection.
        """
        logger.info("Disconnecting NATS pub/sub subscriber")

        # Unsubscribe from all subjects
        for _subject, (sub, _) in list(self._subscriptions.items()):
            await sub.unsubscribe()
        self._subscriptions.clear()

        # Close client connection
        if self._nc is not None:
            await self._nc.drain()
            await self._nc.close()
            self._nc = None

        logger.info("NATS pub/sub subscriber disconnected")

    async def __aenter__(self) -> "NatsPubSubSubscriber":
        """Async context manager entry.

        Returns:
            Self for context manager protocol.
        """
        await self.connect()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit.

        Args:
            exc_type: Exception type if an exception was raised.
            exc_val: Exception value if an exception was raised.
            exc_tb: Exception traceback if an exception was raised.
        """
        await self.disconnect()
