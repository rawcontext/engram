"""Tests for Kafka, Redis, and HuggingFace client wrappers."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.clients import (
    ConsumerConfig,
    ConsumerStatusUpdate,
    HuggingFaceReranker,
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


class TestRedisPublisherAdvanced:
    """Additional tests for RedisPublisher coverage."""

    @pytest.mark.asyncio
    async def test_connect_reuses_existing_client(self) -> None:
        """Test connect reuses existing open client."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = AsyncMock()
            mock_from_url.return_value = mock_client

            publisher = RedisPublisher()
            # First connect
            await publisher.connect()
            # Second connect should reuse and just ping
            await publisher.connect()

            # from_url called once, ping called twice
            assert mock_from_url.call_count == 1
            assert mock_client.ping.call_count == 2

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_connect_reconnects_on_ping_failure(self) -> None:
        """Test connect creates new client if existing ping fails."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client1 = AsyncMock()
            mock_client1.ping.side_effect = Exception("Connection lost")

            mock_client2 = AsyncMock()
            mock_client2.ping = AsyncMock()  # New client ping succeeds
            mock_client2.aclose = AsyncMock()

            mock_from_url.return_value = mock_client2

            publisher = RedisPublisher()
            # Set existing (broken) client
            publisher._client = mock_client1
            # Connect should fail ping and create new client
            client = await publisher.connect()

            assert client == mock_client2
            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_connect_reuses_in_flight_promise(self) -> None:
        """Test concurrent connects reuse the same connection task."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = AsyncMock()
            mock_from_url.return_value = mock_client

            publisher = RedisPublisher()

            # Start two concurrent connects
            import asyncio

            result1, result2 = await asyncio.gather(publisher.connect(), publisher.connect())

            # Both should get the same client
            assert result1 == result2
            # from_url should only be called once
            assert mock_from_url.call_count == 1

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_publish_global_session_event(self) -> None:
        """Test publishing global session event."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = AsyncMock()
            mock_from_url.return_value = mock_client

            publisher = RedisPublisher()
            await publisher.publish_global_session_event(
                event_type="session_created",
                session_data={"id": "sess-123", "title": "New Session"},
            )

            mock_client.publish.assert_called_once()
            call_args = mock_client.publish.call_args
            assert call_args[0][0] == "sessions:updates"

            import json

            message = json.loads(call_args[0][1])
            assert message["type"] == "session_created"
            assert message["session_id"] == ""  # Global event
            assert message["data"]["id"] == "sess-123"

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect_when_already_disconnected(self) -> None:
        """Test disconnect is safe when already disconnected."""
        publisher = RedisPublisher()
        # Should not raise
        await publisher.disconnect()


class TestRedisSubscriberAdvanced:
    """Additional tests for RedisSubscriber coverage."""

    @pytest.mark.asyncio
    async def test_connect_reuses_existing_client(self) -> None:
        """Test connect reuses existing open client."""
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
            await subscriber.connect()

            # from_url called once, ping called twice
            assert mock_from_url.call_count == 1
            assert mock_client.ping.call_count == 2

            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_connect_reconnects_on_ping_failure(self) -> None:
        """Test connect creates new client if existing ping fails."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client1 = MagicMock()
            mock_client1.ping = AsyncMock(side_effect=Exception("Connection lost"))
            mock_client1.aclose = AsyncMock()

            mock_client2 = MagicMock()
            mock_client2.ping = AsyncMock()
            mock_client2.aclose = AsyncMock()
            mock_pubsub = MagicMock()
            mock_pubsub.aclose = AsyncMock()
            mock_pubsub.unsubscribe = AsyncMock()
            mock_pubsub.listen = MagicMock(return_value=AsyncMock().__aiter__())
            mock_client2.pubsub = MagicMock(return_value=mock_pubsub)

            mock_from_url.return_value = mock_client2

            subscriber = RedisSubscriber()
            subscriber._client = mock_client1
            await subscriber.connect()

            assert subscriber._client == mock_client2
            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_to_consumer_status(self) -> None:
        """Test subscribe_to_consumer_status helper."""
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

            unsubscribe = await subscriber.subscribe_to_consumer_status(callback)

            mock_pubsub.subscribe.assert_called_once_with("consumers:status")
            assert callable(unsubscribe)

            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_unsubscribe_removes_callback(self) -> None:
        """Test unsubscribe function removes the callback."""
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

            unsubscribe = await subscriber.subscribe("test-channel:events", callback)

            # Unsubscribe
            unsubscribe()

            # Check that subscriptions were cleaned up
            assert "test-channel:events" not in subscriber._subscriptions

            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_context_manager_subscriber(self) -> None:
        """Test async context manager protocol for subscriber."""
        with patch("src.clients.redis.redis.from_url") as mock_from_url:
            mock_client = MagicMock()
            mock_client.ping = AsyncMock()
            mock_client.aclose = AsyncMock()
            mock_pubsub = MagicMock()
            mock_pubsub.aclose = AsyncMock()
            mock_pubsub.unsubscribe = AsyncMock()
            mock_pubsub.listen = MagicMock(return_value=AsyncMock().__aiter__())
            mock_client.pubsub = MagicMock(return_value=mock_pubsub)
            mock_from_url.return_value = mock_client

            async with RedisSubscriber() as subscriber:
                assert subscriber._client is not None

            mock_client.aclose.assert_called()


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


class TestHuggingFaceReranker:
    """Tests for HuggingFaceReranker client."""

    @pytest.mark.asyncio
    async def test_rerank_async_success(self) -> None:
        """Test async reranking with successful API response."""
        reranker = HuggingFaceReranker(model_id="BAAI/bge-reranker-v2-m3", api_token="test-token")

        mock_response = MagicMock()
        mock_response.json.return_value = [
            {"index": 1, "score": 0.95},
            {"index": 0, "score": 0.75},
            {"index": 2, "score": 0.60},
        ]
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client.post.return_value = mock_response
            mock_client_class.return_value = mock_client

            query = "What is machine learning?"
            documents = ["ML is AI", "ML teaches computers", "Weather forecast"]

            results = await reranker.rerank_async(query, documents)

            # Verify results are sorted by score
            assert len(results) == 3
            assert results[0].score == 0.95
            assert results[0].text == "ML teaches computers"
            assert results[0].original_index == 1
            assert results[1].score == 0.75
            assert results[2].score == 0.60

            # Verify API call
            mock_client.post.assert_called_once()
            call_args = mock_client.post.call_args
            assert "BAAI/bge-reranker-v2-m3" in call_args[0][0]
            payload = call_args[1]["json"]
            assert payload["inputs"]["query"] == query
            assert payload["inputs"]["texts"] == documents

    @pytest.mark.asyncio
    async def test_rerank_async_with_top_k(self) -> None:
        """Test async reranking with top_k limit."""
        reranker = HuggingFaceReranker(
            model_id="jinaai/jina-reranker-v2-base-multilingual", api_token="test-token"
        )

        mock_response = MagicMock()
        mock_response.json.return_value = [
            {"index": 2, "score": 0.98},
            {"index": 0, "score": 0.85},
            {"index": 1, "score": 0.72},
        ]
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client.post.return_value = mock_response
            mock_client_class.return_value = mock_client

            results = await reranker.rerank_async("query", ["doc1", "doc2", "doc3"], top_k=2)

            # Only top 2 results
            assert len(results) == 2
            assert results[0].score == 0.98
            assert results[1].score == 0.85

    @pytest.mark.asyncio
    async def test_rerank_async_empty_documents(self) -> None:
        """Test async reranking with empty document list."""
        reranker = HuggingFaceReranker(model_id="BAAI/bge-reranker-v2-m3", api_token="test-token")

        results = await reranker.rerank_async("query", [])
        assert results == []

    @pytest.mark.asyncio
    async def test_rerank_async_retry_on_503(self) -> None:
        """Test async reranking retries on 503 errors."""
        reranker = HuggingFaceReranker(
            model_id="BAAI/bge-reranker-v2-m3",
            api_token="test-token",
            max_retries=3,
            retry_delay=0.01,
        )

        mock_response_503 = MagicMock()
        mock_response_503.status_code = 503
        mock_response_503.raise_for_status.side_effect = Exception("503 Service Unavailable")

        mock_response_ok = MagicMock()
        mock_response_ok.json.return_value = [{"index": 0, "score": 0.9}]
        mock_response_ok.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            # First call fails with 503, second succeeds
            mock_client.post.side_effect = [
                MagicMock(
                    status_code=503,
                    raise_for_status=MagicMock(
                        side_effect=__import__("httpx").HTTPStatusError(
                            "503",
                            request=MagicMock(),
                            response=MagicMock(status_code=503),
                        )
                    ),
                ),
                mock_response_ok,
            ]
            mock_client_class.return_value = mock_client

            results = await reranker.rerank_async("query", ["doc"])

            # Should eventually succeed
            assert len(results) == 1
            assert results[0].score == 0.9
            # Should have called twice (1 failure + 1 success)
            assert mock_client.post.call_count == 2

    def test_rerank_sync_success(self) -> None:
        """Test synchronous reranking."""
        reranker = HuggingFaceReranker(model_id="BAAI/bge-reranker-v2-m3", api_token="test-token")

        mock_response = MagicMock()
        mock_response.json.return_value = [
            {"index": 0, "score": 0.88},
        ]
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client.__enter__.return_value = mock_client
            mock_client.__exit__.return_value = None
            mock_client.post.return_value = mock_response
            mock_client_class.return_value = mock_client

            results = reranker.rerank("test query", ["test doc"])

            assert len(results) == 1
            assert results[0].score == 0.88
            assert results[0].text == "test doc"

    def test_parse_response(self) -> None:
        """Test response parsing."""
        reranker = HuggingFaceReranker(model_id="BAAI/bge-reranker-v2-m3", api_token="test-token")

        api_response = [
            {"index": 2, "score": 0.95},
            {"index": 0, "score": 0.80},
            {"index": 1, "score": 0.65},
        ]
        documents = ["doc0", "doc1", "doc2"]

        results = reranker._parse_response(api_response, documents)

        # Should be sorted by score descending
        assert len(results) == 3
        assert results[0].score == 0.95
        assert results[0].text == "doc2"
        assert results[0].original_index == 2
        assert results[1].score == 0.80
        assert results[1].text == "doc0"
        assert results[2].score == 0.65
        assert results[2].text == "doc1"
