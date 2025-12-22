"""Tests for NATS and HuggingFace client wrappers."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.clients import (
    ConsumerStatusUpdate,
    HuggingFaceReranker,
    NatsClient,
    NatsClientConfig,
    NatsPubSubPublisher,
    NatsPubSubSubscriber,
    SessionUpdate,
)


class TestNatsClient:
    """Tests for NatsClient wrapper."""

    @pytest.mark.asyncio
    async def test_connect(self) -> None:
        """Test connecting to NATS."""
        with patch("src.clients.nats.nats.connect") as mock_connect:
            mock_js = MagicMock()
            mock_nc = AsyncMock()
            mock_nc.jetstream = MagicMock(return_value=mock_js)
            mock_connect.return_value = mock_nc

            config = NatsClientConfig(servers="nats://localhost:4222")
            client = NatsClient(config=config)
            await client.connect()

            mock_connect.assert_called_once()
            assert client._nc is not None

            await client.close()

    @pytest.mark.asyncio
    async def test_close_without_connection(self) -> None:
        """Test close works even without connection."""
        config = NatsClientConfig(servers="nats://localhost:4222")
        client = NatsClient(config=config)
        # Should not raise
        await client.close()

    def test_topic_to_subject_mapping(self) -> None:
        """Test topic to NATS subject mapping."""
        config = NatsClientConfig(servers="nats://localhost:4222")
        client = NatsClient(config=config)

        # Test explicit mappings
        assert client._topic_to_subject("raw_events") == "events.raw"
        assert client._topic_to_subject("parsed_events") == "events.parsed"
        assert client._topic_to_subject("memory.turn_finalized") == "memory.turns.finalized"
        assert client._topic_to_subject("memory.node_created") == "memory.nodes.created"

        # Test fallback (replace underscores with dots)
        assert client._topic_to_subject("some_custom_topic") == "some.custom.topic"

    def test_subject_to_stream_mapping(self) -> None:
        """Test subject to stream mapping."""
        config = NatsClientConfig(servers="nats://localhost:4222")
        client = NatsClient(config=config)

        assert client._subject_to_stream("events.raw") == "EVENTS"
        assert client._subject_to_stream("events.parsed") == "EVENTS"
        assert client._subject_to_stream("memory.turns.finalized") == "MEMORY"
        assert client._subject_to_stream("dlq.ingestion") == "DLQ"

    def test_subject_to_stream_unknown_raises(self) -> None:
        """Test unknown subject raises ValueError."""
        config = NatsClientConfig(servers="nats://localhost:4222")
        client = NatsClient(config=config)

        with pytest.raises(ValueError, match="Unknown stream"):
            client._subject_to_stream("unknown.subject")

    @pytest.mark.asyncio
    async def test_publish(self) -> None:
        """Test publishing a message."""
        with patch("src.clients.nats.nats.connect") as mock_connect:
            mock_js = MagicMock()
            mock_js.publish = AsyncMock()
            mock_nc = AsyncMock()
            mock_nc.jetstream = MagicMock(return_value=mock_js)
            mock_connect.return_value = mock_nc

            config = NatsClientConfig(servers="nats://localhost:4222")
            client = NatsClient(config=config)
            await client.connect()

            await client.publish(
                topic="parsed_events", key="test-key", message={"type": "test", "data": "hello"}
            )

            mock_js.publish.assert_called_once()
            call_args = mock_js.publish.call_args
            assert call_args[0][0] == "events.parsed"  # Subject

            await client.close()

    @pytest.mark.asyncio
    async def test_context_manager(self) -> None:
        """Test async context manager protocol."""
        with patch("src.clients.nats.nats.connect") as mock_connect:
            mock_js = MagicMock()
            mock_nc = AsyncMock()
            mock_nc.jetstream = MagicMock(return_value=mock_js)
            mock_connect.return_value = mock_nc

            config = NatsClientConfig(servers="nats://localhost:4222")
            async with NatsClient(config=config) as client:
                assert client._nc is not None

            mock_nc.drain.assert_called_once()
            mock_nc.close.assert_called_once()


class TestNatsPubSubPublisher:
    """Tests for NatsPubSubPublisher wrapper."""

    @pytest.mark.asyncio
    async def test_connect(self) -> None:
        """Test NATS pub/sub connection."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_connect.return_value = mock_nc

            publisher = NatsPubSubPublisher(url="nats://localhost:4222")
            nc = await publisher.connect()

            mock_connect.assert_called_once()
            assert nc == mock_nc

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_publish_session_update(self) -> None:
        """Test publishing session update."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_nc.publish = AsyncMock()
            mock_connect.return_value = mock_nc

            publisher = NatsPubSubPublisher()
            await publisher.publish_session_update(
                session_id="sess-123", update_type="lineage", data={"test": "data"}
            )

            # Should publish to session-specific subject
            mock_nc.publish.assert_called_once()
            call_args = mock_nc.publish.call_args
            assert call_args[0][0] == "observatory.session.sess-123.updates"

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_publish_consumer_status(self) -> None:
        """Test publishing consumer status."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_nc.publish = AsyncMock()
            mock_connect.return_value = mock_nc

            publisher = NatsPubSubPublisher()
            await publisher.publish_consumer_status(
                status_type="consumer_ready", group_id="search-group", service_id="search-1"
            )

            # Should publish to consumers subject
            mock_nc.publish.assert_called_once()
            call_args = mock_nc.publish.call_args
            assert call_args[0][0] == "observatory.consumers.status"

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_context_manager(self) -> None:
        """Test async context manager protocol."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_connect.return_value = mock_nc

            async with NatsPubSubPublisher() as publisher:
                assert publisher._nc is not None

            mock_nc.drain.assert_called_once()
            mock_nc.close.assert_called_once()


class TestNatsPubSubPublisherAdvanced:
    """Additional tests for NatsPubSubPublisher coverage."""

    @pytest.mark.asyncio
    async def test_connect_reuses_existing_client(self) -> None:
        """Test connect reuses existing open client."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_connect.return_value = mock_nc

            publisher = NatsPubSubPublisher()
            # First connect
            await publisher.connect()
            # Second connect should reuse
            await publisher.connect()

            # connect called once since we reuse
            assert mock_connect.call_count == 1

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_connect_reuses_in_flight_promise(self) -> None:
        """Test concurrent connects reuse the same connection task."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_connect.return_value = mock_nc

            publisher = NatsPubSubPublisher()

            # Start two concurrent connects
            import asyncio

            result1, result2 = await asyncio.gather(publisher.connect(), publisher.connect())

            # Both should get the same client
            assert result1 == result2
            # connect should only be called once
            assert mock_connect.call_count == 1

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_publish_global_session_event(self) -> None:
        """Test publishing global session event."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_nc.publish = AsyncMock()
            mock_connect.return_value = mock_nc

            publisher = NatsPubSubPublisher()
            await publisher.publish_global_session_event(
                event_type="session_created",
                session_data={"id": "sess-123", "title": "New Session"},
            )

            mock_nc.publish.assert_called_once()
            call_args = mock_nc.publish.call_args
            assert call_args[0][0] == "observatory.sessions.updates"

            await publisher.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect_when_already_disconnected(self) -> None:
        """Test disconnect is safe when already disconnected."""
        publisher = NatsPubSubPublisher()
        # Should not raise
        await publisher.disconnect()


class TestNatsPubSubSubscriber:
    """Tests for NatsPubSubSubscriber wrapper."""

    @pytest.mark.asyncio
    async def test_connect(self) -> None:
        """Test NATS subscriber connection."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_connect.return_value = mock_nc

            subscriber = NatsPubSubSubscriber()
            await subscriber.connect()

            mock_connect.assert_called_once()
            assert subscriber._nc == mock_nc

            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_builds_session_subject(self) -> None:
        """Test subscribing with session ID builds correct subject."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_sub = AsyncMock()
            mock_nc.subscribe = AsyncMock(return_value=mock_sub)
            mock_connect.return_value = mock_nc

            subscriber = NatsPubSubSubscriber()

            def callback(msg: dict) -> None:
                pass

            # Subscribe with session ID
            await subscriber.subscribe("sess-123", callback)

            # Should build session subject name
            mock_nc.subscribe.assert_called_once()
            call_args = mock_nc.subscribe.call_args
            assert call_args[0][0] == "observatory.session.sess-123.updates"

            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_uses_full_subject_name(self) -> None:
        """Test subscribing with full subject name uses it as-is."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_sub = AsyncMock()
            mock_nc.subscribe = AsyncMock(return_value=mock_sub)
            mock_connect.return_value = mock_nc

            subscriber = NatsPubSubSubscriber()

            def callback(msg: dict) -> None:
                pass

            # Subscribe with full subject name
            await subscriber.subscribe("observatory.sessions.updates", callback)

            # Should use subject name as-is
            mock_nc.subscribe.assert_called_once()
            call_args = mock_nc.subscribe.call_args
            assert call_args[0][0] == "observatory.sessions.updates"

            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_to_consumer_status(self) -> None:
        """Test subscribe_to_consumer_status helper."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_sub = AsyncMock()
            mock_nc.subscribe = AsyncMock(return_value=mock_sub)
            mock_connect.return_value = mock_nc

            subscriber = NatsPubSubSubscriber()

            def callback(msg: dict) -> None:
                pass

            unsubscribe = await subscriber.subscribe_to_consumer_status(callback)

            mock_nc.subscribe.assert_called_once()
            call_args = mock_nc.subscribe.call_args
            assert call_args[0][0] == "observatory.consumers.status"
            assert callable(unsubscribe)

            await subscriber.disconnect()

    @pytest.mark.asyncio
    async def test_context_manager_subscriber(self) -> None:
        """Test async context manager protocol for subscriber."""
        with patch("src.clients.nats_pubsub.nats.connect") as mock_connect:
            mock_nc = AsyncMock()
            mock_nc.is_connected = True
            mock_connect.return_value = mock_nc

            async with NatsPubSubSubscriber() as subscriber:
                assert subscriber._nc is not None

            mock_nc.drain.assert_called()
            mock_nc.close.assert_called()


class TestPydanticModels:
    """Tests for Pydantic models."""

    def test_session_update_model(self) -> None:
        """Test SessionUpdate model validation."""
        update = SessionUpdate(
            type="lineage", sessionId="sess-123", data={"key": "value"}, timestamp=1234567890
        )

        assert update.type == "lineage"
        assert update.sessionId == "sess-123"
        assert update.data == {"key": "value"}
        assert update.timestamp == 1234567890

    def test_consumer_status_update_model(self) -> None:
        """Test ConsumerStatusUpdate model validation."""
        status = ConsumerStatusUpdate(
            type="consumer_ready",
            groupId="search-group",
            serviceId="search-1",
            timestamp=1234567890,
        )

        assert status.type == "consumer_ready"
        assert status.groupId == "search-group"
        assert status.serviceId == "search-1"
        assert status.timestamp == 1234567890

    def test_nats_client_config_model(self) -> None:
        """Test NatsClientConfig model with defaults."""
        config = NatsClientConfig(servers="nats://localhost:4222")

        assert config.servers == "nats://localhost:4222"

        # Test custom values
        config2 = NatsClientConfig(servers="nats://nats.example.com:4222")

        assert config2.servers == "nats://nats.example.com:4222"


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
