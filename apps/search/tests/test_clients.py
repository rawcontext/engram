"""Tests for Kafka and Redis client wrappers."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.clients import (
    ConsumerConfig,
    ConsumerStatusUpdate,
    KafkaClient,
    RedisPublisher,
    RedisSubscriber,
    SessionUpdate,
)


class TestKafkaClient:
    """Tests for KafkaClient wrapper."""

    @pytest.mark.asyncio
    async def test_get_producer(self) -> None:
        """Test getting producer creates it on first call."""
        with patch("src.clients.kafka.AIOKafkaProducer") as mock_producer_class:
            mock_producer = AsyncMock()
            mock_producer_class.return_value = mock_producer

            client = KafkaClient(bootstrap_servers=["localhost:9092"])

            # Get producer
            producer = await client.get_producer()
            mock_producer.start.assert_called_once()
            assert producer == mock_producer

            # Get producer again - should return same instance
            producer2 = await client.get_producer()
            assert producer2 == mock_producer
            # Should not start again
            assert mock_producer.start.call_count == 1

            await client.close()

    @pytest.mark.asyncio
    async def test_create_consumer(self) -> None:
        """Test consumer creation."""
        with patch("src.clients.kafka.AIOKafkaConsumer") as mock_consumer_class:
            mock_consumer = AsyncMock()
            mock_consumer_class.return_value = mock_consumer

            client = KafkaClient()

            consumer = await client.create_consumer(topics=["test-topic"], group_id="test-group")

            mock_consumer.start.assert_called_once()
            assert consumer == mock_consumer

            await client.close()

    @pytest.mark.asyncio
    async def test_send_event(self) -> None:
        """Test sending events."""
        with patch("src.clients.kafka.AIOKafkaProducer") as mock_producer_class:
            mock_producer = AsyncMock()
            mock_producer_class.return_value = mock_producer

            client = KafkaClient()

            await client.send_event("test-topic", "test-key", {"data": "value"})

            mock_producer.send_and_wait.assert_called_once()
            call_kwargs = mock_producer.send_and_wait.call_args
            assert call_kwargs[0][0] == "test-topic"

            await client.close()

    @pytest.mark.asyncio
    async def test_context_manager(self) -> None:
        """Test async context manager protocol."""
        with patch("src.clients.kafka.AIOKafkaProducer") as mock_producer_class:
            mock_producer = AsyncMock()
            mock_producer_class.return_value = mock_producer

            async with KafkaClient() as client:
                # Create producer to have something to close
                await client.get_producer()
                assert client._producer is not None

            # Should close on exit
            mock_producer.stop.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_without_connections(self) -> None:
        """Test close works even without any connections."""
        client = KafkaClient()
        # Should not raise
        await client.close()


class TestRedisPublisher:
    """Tests for RedisPublisher wrapper."""

    @pytest.mark.asyncio
    async def test_connect(self) -> None:
        """Test Redis connection."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = AsyncMock()
            mock_from_url.return_value = mock_client

            publisher = RedisPublisher(url="redis://localhost:6379")
            client = await publisher.connect()

            mock_from_url.assert_called_once_with("redis://localhost:6379", decode_responses=True)
            mock_client.ping.assert_called_once()
            assert client == mock_client

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_publish_session_update(self) -> None:
        """Test publishing session update."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = AsyncMock()
            mock_from_url.return_value = mock_client

            publisher = RedisPublisher()
            await publisher.publish_session_update(
                session_id="sess-123", update_type="lineage", data={"test": "data"}
            )

            # Should publish to session-specific channel
            mock_client.publish.assert_called_once()
            call_args = mock_client.publish.call_args
            assert call_args[0][0] == "session:sess-123:updates"

            # Verify message structure
            import json

            message = json.loads(call_args[0][1])
            assert message["type"] == "lineage"
            assert message["session_id"] == "sess-123"
            assert message["data"] == {"test": "data"}
            assert "timestamp" in message

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_publish_consumer_status(self) -> None:
        """Test publishing consumer status."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = AsyncMock()
            mock_from_url.return_value = mock_client

            publisher = RedisPublisher()
            await publisher.publish_consumer_status(
                status_type="consumer_ready", group_id="search-group", service_id="search-1"
            )

            # Should publish to consumers channel
            mock_client.publish.assert_called_once()
            call_args = mock_client.publish.call_args
            assert call_args[0][0] == "consumers:status"

            # Verify message structure
            import json

            message = json.loads(call_args[0][1])
            assert message["type"] == "consumer_ready"
            assert message["group_id"] == "search-group"
            assert message["service_id"] == "search-1"

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_context_manager(self) -> None:
        """Test async context manager protocol."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = AsyncMock()
            mock_from_url.return_value = mock_client

            async with RedisPublisher() as publisher:
                assert publisher._client is not None

            mock_client.aclose.assert_called_once()


class TestRedisSubscriber:
    """Tests for RedisSubscriber wrapper."""

    @pytest.mark.asyncio
    async def test_connect(self) -> None:
        """Test Redis subscriber connection."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = MagicMock()
            mock_client.ping = AsyncMock()
            mock_client.aclose = AsyncMock()
            mock_pubsub = MagicMock()
            mock_pubsub.aclose = AsyncMock()
            mock_pubsub.unsubscribe = AsyncMock()
            mock_client.pubsub = MagicMock(return_value=mock_pubsub)
            mock_from_url.return_value = mock_client

            subscriber = RedisSubscriber()
            await subscriber.connect()

            mock_from_url.assert_called_once()
            mock_client.ping.assert_called_once()
            assert subscriber._client == mock_client
            assert subscriber._pubsub is not None

            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_builds_session_channel(self) -> None:
        """Test subscribing with session ID builds correct channel."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = MagicMock()
            mock_client.ping = AsyncMock()
            mock_client.aclose = AsyncMock()
            mock_pubsub = MagicMock()
            mock_pubsub.subscribe = AsyncMock()
            mock_pubsub.unsubscribe = AsyncMock()
            mock_pubsub.aclose = AsyncMock()
            mock_pubsub.listen = MagicMock(return_value=AsyncMock().__aiter__())
            mock_client.pubsub = MagicMock(return_value=mock_pubsub)
            mock_from_url.return_value = mock_client

            subscriber = RedisSubscriber()

            def callback(msg: dict) -> None:
                pass

            # Subscribe with session ID
            await subscriber.subscribe("sess-123", callback)

            # Should build session channel name
            mock_pubsub.subscribe.assert_called_once_with("session:sess-123:updates")

            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_uses_full_channel_name(self) -> None:
        """Test subscribing with full channel name uses it as-is."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = MagicMock()
            mock_client.ping = AsyncMock()
            mock_client.aclose = AsyncMock()
            mock_pubsub = MagicMock()
            mock_pubsub.subscribe = AsyncMock()
            mock_pubsub.unsubscribe = AsyncMock()
            mock_pubsub.aclose = AsyncMock()
            mock_pubsub.listen = MagicMock(return_value=AsyncMock().__aiter__())
            mock_client.pubsub = MagicMock(return_value=mock_pubsub)
            mock_from_url.return_value = mock_client

            subscriber = RedisSubscriber()

            def callback(msg: dict) -> None:
                pass

            # Subscribe with full channel name
            await subscriber.subscribe("sessions:updates", callback)

            # Should use channel name as-is
            mock_pubsub.subscribe.assert_called_once_with("sessions:updates")

            await subscriber.disconnect()


class TestPydanticModels:
    """Tests for Pydantic models."""

    def test_session_update_model(self) -> None:
        """Test SessionUpdate model validation."""
        update = SessionUpdate(
            type="lineage", session_id="sess-123", data={"key": "value"}, timestamp=1234567890
        )

        assert update.type == "lineage"
        assert update.session_id == "sess-123"
        assert update.data == {"key": "value"}
        assert update.timestamp == 1234567890

    def test_consumer_status_update_model(self) -> None:
        """Test ConsumerStatusUpdate model validation."""
        status = ConsumerStatusUpdate(
            type="consumer_ready",
            group_id="search-group",
            service_id="search-1",
            timestamp=1234567890,
        )

        assert status.type == "consumer_ready"
        assert status.group_id == "search-group"
        assert status.service_id == "search-1"
        assert status.timestamp == 1234567890

    def test_consumer_config_model(self) -> None:
        """Test ConsumerConfig model with defaults."""
        config = ConsumerConfig(group_id="test-group")

        assert config.group_id == "test-group"
        assert config.auto_offset_reset == "earliest"
        assert config.enable_auto_commit is True

        # Test custom values
        config2 = ConsumerConfig(
            group_id="test-group", auto_offset_reset="latest", enable_auto_commit=False
        )

        assert config2.auto_offset_reset == "latest"
        assert config2.enable_auto_commit is False
