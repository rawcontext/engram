"""Async Redis pub/sub wrapper."""

import asyncio
import contextlib
import json
import logging
import os
from collections.abc import Callable
from typing import Any

import redis.asyncio as redis
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class SessionUpdate(BaseModel):
    """Session update event published to Redis.

    Supports various session-related events like lineage, timeline updates,
    and node creation notifications.
    """

    type: str = Field(
        description="Event type: lineage, timeline, node_created, session_created, etc."
    )
    session_id: str = Field(description="Session ID this update belongs to")
    data: dict[str, Any] = Field(description="Event-specific payload data")
    timestamp: int = Field(description="Unix timestamp in milliseconds")


class ConsumerStatusUpdate(BaseModel):
    """Consumer status event published to Redis.

    Tracks consumer lifecycle events for monitoring and coordination.
    """

    type: str = Field(
        description="Status type: consumer_ready, consumer_disconnected, consumer_heartbeat"
    )
    group_id: str = Field(description="Consumer group identifier")
    service_id: str = Field(description="Unique service instance identifier")
    timestamp: int = Field(description="Unix timestamp in milliseconds")


# Global channels for system-wide updates
SESSIONS_CHANNEL = "sessions:updates"
CONSUMERS_CHANNEL = "consumers:status"


class RedisPublisher:
    """Redis publisher for session and consumer status updates.

    Publishes events to both per-session channels and global channels.
    Mirrors the TypeScript RedisPublisher implementation.
    """

    def __init__(self, url: str | None = None) -> None:
        """Initialize the Redis publisher.

        Args:
            url: Redis connection URL. Defaults to REDIS_URL env var.
        """
        self.url = url or os.environ.get("REDIS_URL", "redis://localhost:6379")
        self._client: redis.Redis | None = None
        self._connect_promise: asyncio.Task[redis.Redis] | None = None

    async def connect(self) -> redis.Redis:
        """Connect to Redis server with connection reuse.

        Returns existing connection if already open, otherwise creates new connection.
        Handles concurrent connection attempts by reusing in-flight connection promises.

        Returns:
            Connected Redis client instance.
        """
        # Return existing open client
        if self._client is not None:
            try:
                await self._client.ping()  # type: ignore[misc]
                return self._client
            except Exception:
                pass

        # If already connecting, wait for that attempt
        if self._connect_promise is not None:
            return await self._connect_promise

        # Start new connection attempt
        async def _connect() -> redis.Redis:
            try:
                logger.info(f"Connecting to Redis at {self.url}")
                client = redis.from_url(self.url, decode_responses=True)  # type: ignore[no-untyped-call]
                await client.ping()
                self._client = client
                logger.info("Redis publisher connected successfully")
                return client  # type: ignore[no-any-return]
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
        client = await self.connect()
        channel = f"session:{session_id}:updates"

        message = SessionUpdate(
            type=update_type,
            session_id=session_id,
            data=data,
            timestamp=int(asyncio.get_event_loop().time() * 1000),
        )

        await client.publish(channel, message.model_dump_json())
        logger.debug(f"Published {update_type} to {channel}")

    async def publish_global_session_event(
        self, event_type: str, session_data: dict[str, Any]
    ) -> None:
        """Publish a global session event to the sessions:updates channel.

        Used for homepage session list updates and other cross-session notifications.

        Args:
            event_type: Event type (session_created, session_updated, session_closed).
            session_data: Session metadata or update payload.
        """
        client = await self.connect()

        message = SessionUpdate(
            type=event_type,
            session_id="",  # Global event, not tied to specific session
            data=session_data,
            timestamp=int(asyncio.get_event_loop().time() * 1000),
        )

        await client.publish(SESSIONS_CHANNEL, message.model_dump_json())
        logger.debug(f"Published global session event: {event_type}")

    async def publish_consumer_status(
        self, status_type: str, group_id: str, service_id: str
    ) -> None:
        """Publish a consumer status update to the consumers:status channel.

        Args:
            status_type: Status event type (consumer_ready, consumer_disconnected,
                consumer_heartbeat).
            group_id: Consumer group identifier.
            service_id: Unique service instance identifier.
        """
        client = await self.connect()

        message = ConsumerStatusUpdate(
            type=status_type,
            group_id=group_id,
            service_id=service_id,
            timestamp=int(asyncio.get_event_loop().time() * 1000),
        )

        await client.publish(CONSUMERS_CHANNEL, message.model_dump_json())
        logger.debug(f"Published consumer status: {status_type} for {service_id}")

    async def disconnect(self) -> None:
        """Close the Redis connection.

        Properly cleans up the Redis client connection.
        """
        if self._client is not None:
            logger.info("Disconnecting Redis publisher")
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> "RedisPublisher":
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


class RedisSubscriber:
    """Redis subscriber for receiving updates via pub/sub.

    Supports subscribing to session-specific channels and global system channels.
    Mirrors the TypeScript RedisSubscriber implementation.
    """

    def __init__(self, url: str | None = None) -> None:
        """Initialize the Redis subscriber.

        Args:
            url: Redis connection URL. Defaults to REDIS_URL env var.
        """
        self.url = url or os.environ.get("REDIS_URL", "redis://localhost:6379")
        self._client: redis.Redis | None = None
        self._pubsub: redis.client.PubSub | None = None
        self._subscriptions: dict[str, set[Callable[[dict[str, Any]], None]]] = {}
        self._listen_task: asyncio.Task[None] | None = None

    async def connect(self) -> redis.Redis:
        """Connect to Redis server.

        Returns:
            Connected Redis client instance.
        """
        if self._client is not None:
            try:
                await self._client.ping()  # type: ignore[misc]
                return self._client
            except Exception:
                pass

        logger.info(f"Connecting to Redis subscriber at {self.url}")
        self._client = redis.from_url(self.url, decode_responses=True)  # type: ignore[no-untyped-call]
        self._pubsub = self._client.pubsub()
        await self._client.ping()  # type: ignore[misc]
        logger.info("Redis subscriber connected successfully")

        # Start message listener
        if self._listen_task is None:
            self._listen_task = asyncio.create_task(self._listen_for_messages())

        return self._client

    async def _listen_for_messages(self) -> None:
        """Internal task to listen for incoming pub/sub messages.

        Parses messages and dispatches them to registered callbacks.
        """
        if self._pubsub is None:
            return

        try:
            async for message in self._pubsub.listen():
                if message["type"] == "message":
                    channel = message["channel"]
                    data = message["data"]

                    try:
                        parsed = json.loads(data)
                        callbacks = self._subscriptions.get(channel, set())
                        for callback in callbacks:
                            try:
                                callback(parsed)
                            except Exception as e:
                                logger.error(f"Error in subscription callback for {channel}: {e}")
                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to parse message from {channel}: {e}")
        except asyncio.CancelledError:
            logger.info("Message listener task cancelled")
        except Exception as e:
            logger.error(f"Error in message listener: {e}")

    async def subscribe(
        self, channel_or_session_id: str, callback: Callable[[dict[str, Any]], None]
    ) -> Callable[[], None]:
        """Subscribe to a channel with a callback function.

        Supports both session-specific channels (by session ID) and global channels
        (by full channel name like "sessions:updates").

        Args:
            channel_or_session_id: Either a full channel name or a session ID.
            callback: Function to call when messages arrive on this channel.

        Returns:
            Unsubscribe function to remove this callback.
        """
        await self.connect()

        # Determine if this is a full channel name or a session ID
        if ":" in channel_or_session_id:
            channel = channel_or_session_id  # Already a full channel name
        else:
            channel = f"session:{channel_or_session_id}:updates"  # Build session channel

        # Track callbacks per channel
        if channel not in self._subscriptions:
            self._subscriptions[channel] = set()
            # Subscribe to the channel (only once per channel)
            if self._pubsub is not None:
                await self._pubsub.subscribe(channel)
                logger.info(f"Subscribed to channel: {channel}")

        self._subscriptions[channel].add(callback)

        # Return unsubscribe function
        def unsubscribe() -> None:
            callbacks = self._subscriptions.get(channel)
            if callbacks:
                callbacks.discard(callback)
                # Clean up channel subscription if no more callbacks
                if len(callbacks) == 0:
                    self._subscriptions.pop(channel, None)
                    if self._pubsub is not None:
                        # Fire and forget unsubscribe task
                        async def _unsub() -> None:
                            if self._pubsub is not None:
                                await self._pubsub.unsubscribe(channel)

                        _ = asyncio.create_task(_unsub())
                        logger.info(f"Unsubscribed from channel: {channel}")

        return unsubscribe

    async def subscribe_to_consumer_status(
        self, callback: Callable[[dict[str, Any]], None]
    ) -> Callable[[], None]:
        """Subscribe to consumer status updates on the consumers:status channel.

        Args:
            callback: Function to call when consumer status messages arrive.

        Returns:
            Unsubscribe function to remove this callback.
        """
        return await self.subscribe(CONSUMERS_CHANNEL, callback)

    async def disconnect(self) -> None:
        """Disconnect from Redis and clean up resources.

        Unsubscribes from all channels and closes the connection.
        """
        logger.info("Disconnecting Redis subscriber")

        # Cancel message listener
        if self._listen_task is not None:
            self._listen_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listen_task
            self._listen_task = None

        # Unsubscribe from all channels
        if self._pubsub is not None:
            for channel in list(self._subscriptions.keys()):
                await self._pubsub.unsubscribe(channel)
            self._subscriptions.clear()
            await self._pubsub.aclose()  # type: ignore[no-untyped-call]
            self._pubsub = None

        # Close client connection
        if self._client is not None:
            await self._client.aclose()
            self._client = None

        logger.info("Redis subscriber disconnected")

    async def __aenter__(self) -> "RedisSubscriber":
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
