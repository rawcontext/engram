"""Tests for NATS client."""

import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.clients.nats import NatsClient, NatsClientConfig


class TestNatsClientConfig:
    """Tests for NatsClientConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = NatsClientConfig()

        assert config.servers == "nats://localhost:4222"
        assert config.client_name == "search-service"

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = NatsClientConfig(servers="nats://custom:4222", client_name="test-client")

        assert config.servers == "nats://custom:4222"
        assert config.client_name == "test-client"


class TestNatsClient:
    """Tests for NatsClient."""

    @pytest.fixture
    def client(self) -> NatsClient:
        """Create a NatsClient instance."""
        return NatsClient()

    @pytest.fixture
    def custom_client(self) -> NatsClient:
        """Create a NatsClient with custom config."""
        config = NatsClientConfig(servers="nats://test:4222", client_name="test")
        return NatsClient(config=config)

    def test_initialization_default(self) -> None:
        """Test client initialization with defaults."""
        client = NatsClient()

        assert client._nc is None
        assert client._js is None
        assert client.config.servers == "nats://localhost:4222"

    def test_initialization_with_config(self) -> None:
        """Test client initialization with config."""
        config = NatsClientConfig(servers="nats://custom:4222")
        client = NatsClient(config=config)

        assert client.config.servers == "nats://custom:4222"

    def test_initialization_from_env(self) -> None:
        """Test client initialization from environment variable."""
        with patch.dict("os.environ", {"NATS_URL": "nats://env:4222"}):
            client = NatsClient()
            assert client.config.servers == "nats://env:4222"

    def test_topic_mappings(self, client: NatsClient) -> None:
        """Test topic to subject mappings."""
        assert client._topic_to_subject("raw_events") == "events.raw"
        assert client._topic_to_subject("parsed_events") == "events.parsed"
        assert client._topic_to_subject("memory.turn_finalized") == "memory.turns.finalized"
        assert client._topic_to_subject("memory.node_created") == "memory.nodes.created"
        assert client._topic_to_subject("ingestion.dead_letter") == "dlq.ingestion"

    def test_topic_mapping_unknown(self, client: NatsClient) -> None:
        """Test topic mapping for unknown topic uses underscore replacement."""
        assert client._topic_to_subject("unknown_topic") == "unknown.topic"
        assert client._topic_to_subject("custom_event_type") == "custom.event.type"

    def test_subject_to_stream_events(self, client: NatsClient) -> None:
        """Test subject to stream mapping for events."""
        assert client._subject_to_stream("events.raw") == "EVENTS"
        assert client._subject_to_stream("events.parsed") == "EVENTS"

    def test_subject_to_stream_memory(self, client: NatsClient) -> None:
        """Test subject to stream mapping for memory."""
        assert client._subject_to_stream("memory.turns.finalized") == "MEMORY"
        assert client._subject_to_stream("memory.nodes.created") == "MEMORY"

    def test_subject_to_stream_dlq(self, client: NatsClient) -> None:
        """Test subject to stream mapping for DLQ."""
        assert client._subject_to_stream("dlq.ingestion") == "DLQ"
        assert client._subject_to_stream("dlq.memory") == "DLQ"

    def test_subject_to_stream_unknown(self, client: NatsClient) -> None:
        """Test subject to stream mapping for unknown subject."""
        with pytest.raises(ValueError, match="Unknown stream for subject"):
            client._subject_to_stream("unknown.subject")

    @pytest.mark.asyncio
    async def test_connect(self, client: NatsClient) -> None:
        """Test connecting to NATS."""
        mock_nc = AsyncMock()
        mock_js = MagicMock()
        # jetstream() is a sync method, so use MagicMock not AsyncMock
        mock_nc.jetstream = MagicMock(return_value=mock_js)

        with patch("src.clients.nats.nats.connect", return_value=mock_nc) as mock_connect:
            await client.connect()

        mock_connect.assert_called_once_with(
            servers=client.config.servers,
            name=client.config.client_name,
        )
        assert client._nc is mock_nc
        assert client._js is mock_js

    @pytest.mark.asyncio
    async def test_connect_already_connected(self, client: NatsClient) -> None:
        """Test connect when already connected is idempotent."""
        mock_nc = AsyncMock()
        client._nc = mock_nc

        with patch("src.clients.nats.nats.connect") as mock_connect:
            await client.connect()

        mock_connect.assert_not_called()

    @pytest.mark.asyncio
    async def test_close(self, client: NatsClient) -> None:
        """Test closing the NATS connection."""
        mock_nc = AsyncMock()
        client._nc = mock_nc
        client._js = MagicMock()

        await client.close()

        mock_nc.drain.assert_called_once()
        mock_nc.close.assert_called_once()
        assert client._nc is None
        assert client._js is None

    @pytest.mark.asyncio
    async def test_close_not_connected(self, client: NatsClient) -> None:
        """Test close when not connected is safe."""
        await client.close()  # Should not raise

    @pytest.mark.asyncio
    async def test_publish(self, client: NatsClient) -> None:
        """Test publishing a message."""
        mock_nc = AsyncMock()
        mock_js = AsyncMock()
        # jetstream() is a sync method, so use MagicMock not AsyncMock
        mock_nc.jetstream = MagicMock(return_value=mock_js)

        with patch("src.clients.nats.nats.connect", return_value=mock_nc):
            await client.publish(
                topic="parsed_events",
                key="msg-123",
                message={"event": "test"},
            )

        mock_js.publish.assert_called_once()
        call_args = mock_js.publish.call_args
        assert call_args[0][0] == "events.parsed"  # Subject
        assert b'"event": "test"' in call_args[0][1]  # Payload
        assert call_args[1]["headers"]["Nats-Msg-Id"] == "msg-123"

    @pytest.mark.asyncio
    async def test_context_manager(self, client: NatsClient) -> None:
        """Test async context manager."""
        mock_nc = AsyncMock()
        mock_js = MagicMock()
        # jetstream() is a sync method, so use MagicMock not AsyncMock
        mock_nc.jetstream = MagicMock(return_value=mock_js)

        with patch("src.clients.nats.nats.connect", return_value=mock_nc):
            async with client as c:
                assert c is client
                assert client._nc is mock_nc

        mock_nc.drain.assert_called_once()
        mock_nc.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_subscribe_processes_messages(self, client: NatsClient) -> None:
        """Test subscribe processes messages successfully."""
        import asyncio

        import nats.errors

        mock_nc = AsyncMock()
        mock_js = AsyncMock()
        mock_nc.jetstream = MagicMock(return_value=mock_js)

        # Create mock messages
        mock_msg1 = MagicMock()
        mock_msg1.subject = "events.parsed"
        mock_msg1.data = b'{"event": "test1"}'
        mock_msg1.ack = AsyncMock()
        mock_msg1.nak = AsyncMock()

        mock_msg2 = MagicMock()
        mock_msg2.subject = "events.parsed"
        mock_msg2.data = b'{"event": "test2"}'
        mock_msg2.ack = AsyncMock()
        mock_msg2.nak = AsyncMock()

        # Create mock pull subscription
        mock_psub = AsyncMock()
        fetch_count = 0
        processed_event = asyncio.Event()

        async def mock_fetch(*args, **kwargs):
            nonlocal fetch_count
            fetch_count += 1
            if fetch_count == 1:
                await asyncio.sleep(0)  # Yield control
                return [mock_msg1, mock_msg2]
            else:
                # Signal that processing is done, then wait forever
                processed_event.set()
                await asyncio.sleep(10)  # Long sleep
                raise nats.errors.TimeoutError()

        mock_psub.fetch = mock_fetch
        mock_js.pull_subscribe = AsyncMock(return_value=mock_psub)

        # Track handler calls
        handler_calls = []

        async def test_handler(subject: str, data: dict) -> None:
            handler_calls.append((subject, data))

        with patch("src.clients.nats.nats.connect", return_value=mock_nc):
            # Run subscribe in a task
            task = asyncio.create_task(
                client.subscribe(
                    topic="parsed_events",
                    group_id="test-consumer",
                    handler=test_handler,
                )
            )

            # Wait for processing to complete
            try:
                await asyncio.wait_for(processed_event.wait(), timeout=1.0)
            except TimeoutError:
                pass
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        # Verify subscription setup
        mock_js.pull_subscribe.assert_called_once()
        call_args = mock_js.pull_subscribe.call_args
        assert call_args[1]["subject"] == "events.parsed"
        assert call_args[1]["durable"] == "test-consumer"
        assert call_args[1]["stream"] == "EVENTS"

        # Verify messages were processed
        assert len(handler_calls) == 2
        assert handler_calls[0] == ("events.parsed", {"event": "test1"})
        assert handler_calls[1] == ("events.parsed", {"event": "test2"})

        # Verify messages were acknowledged
        mock_msg1.ack.assert_called_once()
        mock_msg2.ack.assert_called_once()

    @pytest.mark.asyncio
    async def test_subscribe_handles_message_processing_error(self, client: NatsClient) -> None:
        """Test subscribe handles errors during message processing."""
        import asyncio

        import nats.errors

        mock_nc = AsyncMock()
        mock_js = AsyncMock()
        mock_nc.jetstream = MagicMock(return_value=mock_js)

        # Create mock message
        mock_msg = MagicMock()
        mock_msg.subject = "events.parsed"
        mock_msg.data = b'{"event": "test"}'
        mock_msg.ack = AsyncMock()
        mock_msg.nak = AsyncMock()

        # Create mock pull subscription
        mock_psub = AsyncMock()
        fetch_count = 0
        processed_event = asyncio.Event()

        async def mock_fetch(*args, **kwargs):
            nonlocal fetch_count
            fetch_count += 1
            await asyncio.sleep(0)
            if fetch_count == 1:
                return [mock_msg]
            else:
                processed_event.set()
                await asyncio.sleep(10)
                raise nats.errors.TimeoutError()

        mock_psub.fetch = mock_fetch
        mock_js.pull_subscribe = AsyncMock(return_value=mock_psub)

        # Handler that raises an error
        async def failing_handler(subject: str, data: dict) -> None:
            raise ValueError("Handler error")

        with patch("src.clients.nats.nats.connect", return_value=mock_nc):
            task = asyncio.create_task(
                client.subscribe(
                    topic="parsed_events",
                    group_id="test-consumer",
                    handler=failing_handler,
                )
            )

            try:
                await asyncio.wait_for(processed_event.wait(), timeout=1.0)
            except TimeoutError:
                pass
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        # Verify message was negatively acknowledged due to handler error
        mock_msg.nak.assert_called_once()
        mock_msg.ack.assert_not_called()

    @pytest.mark.asyncio
    async def test_subscribe_handles_invalid_json(self, client: NatsClient) -> None:
        """Test subscribe handles invalid JSON in messages."""
        import asyncio

        import nats.errors

        mock_nc = AsyncMock()
        mock_js = AsyncMock()
        mock_nc.jetstream = MagicMock(return_value=mock_js)

        # Create mock message with invalid JSON
        mock_msg = MagicMock()
        mock_msg.subject = "events.parsed"
        mock_msg.data = b"not-valid-json"
        mock_msg.ack = AsyncMock()
        mock_msg.nak = AsyncMock()

        # Create mock pull subscription
        mock_psub = AsyncMock()
        fetch_count = 0
        processed_event = asyncio.Event()

        async def mock_fetch(*args, **kwargs):
            nonlocal fetch_count
            fetch_count += 1
            await asyncio.sleep(0)
            if fetch_count == 1:
                return [mock_msg]
            else:
                processed_event.set()
                await asyncio.sleep(10)
                raise nats.errors.TimeoutError()

        mock_psub.fetch = mock_fetch
        mock_js.pull_subscribe = AsyncMock(return_value=mock_psub)

        handler_called = False

        async def test_handler(subject: str, data: dict) -> None:
            nonlocal handler_called
            handler_called = True

        with patch("src.clients.nats.nats.connect", return_value=mock_nc):
            task = asyncio.create_task(
                client.subscribe(
                    topic="parsed_events",
                    group_id="test-consumer",
                    handler=test_handler,
                )
            )

            try:
                await asyncio.wait_for(processed_event.wait(), timeout=1.0)
            except TimeoutError:
                pass
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        # Verify handler was not called due to JSON error
        assert not handler_called
        # Verify message was negatively acknowledged
        mock_msg.nak.assert_called_once()
        mock_msg.ack.assert_not_called()

    @pytest.mark.asyncio
    async def test_subscribe_handles_fetch_error(self, client: NatsClient) -> None:
        """Test subscribe handles errors during fetch (non-timeout)."""
        import asyncio

        import nats.errors

        mock_nc = AsyncMock()
        mock_js = AsyncMock()
        mock_nc.jetstream = MagicMock(return_value=mock_js)

        # Create mock pull subscription
        mock_psub = AsyncMock()
        fetch_count = 0
        processed_event = asyncio.Event()

        async def mock_fetch(*args, **kwargs):
            nonlocal fetch_count
            await asyncio.sleep(0)
            fetch_count += 1
            if fetch_count == 1:
                raise RuntimeError("Connection error")
            elif fetch_count == 2:
                processed_event.set()
                await asyncio.sleep(10)
                raise nats.errors.TimeoutError()
            else:
                await asyncio.sleep(10)
                raise nats.errors.TimeoutError()

        mock_psub.fetch = mock_fetch
        mock_js.pull_subscribe = AsyncMock(return_value=mock_psub)

        handler_called = False

        async def test_handler(subject: str, data: dict) -> None:
            nonlocal handler_called
            handler_called = True

        with patch("src.clients.nats.nats.connect", return_value=mock_nc):
            task = asyncio.create_task(
                client.subscribe(
                    topic="parsed_events",
                    group_id="test-consumer",
                    handler=test_handler,
                )
            )

            try:
                await asyncio.wait_for(processed_event.wait(), timeout=1.0)
            except TimeoutError:
                pass
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        # Verify handler was not called due to fetch errors
        assert not handler_called
        # Verify fetch was called multiple times (error recovery)
        assert fetch_count >= 2

    @pytest.mark.asyncio
    async def test_context_manager_with_exception(self, client: NatsClient) -> None:
        """Test async context manager closes connection even on exception."""
        mock_nc = AsyncMock()
        mock_js = MagicMock()
        mock_nc.jetstream = MagicMock(return_value=mock_js)

        with patch("src.clients.nats.nats.connect", return_value=mock_nc):
            try:
                async with client as c:
                    assert c is client
                    raise ValueError("Test error")
            except ValueError:
                pass  # Expected

        # Verify connection was still closed
        mock_nc.drain.assert_called_once()
        mock_nc.close.assert_called_once()


class TestNatsClientTopicMappings:
    """Tests for NATS topic mappings."""

    def test_all_topic_mappings_defined(self) -> None:
        """Test that all expected topic mappings are defined."""
        expected = {
            "raw_events",
            "parsed_events",
            "memory.turn_finalized",
            "memory.node_created",
            "ingestion.dead_letter",
            "memory.dead_letter",
        }
        assert set(NatsClient.TOPIC_MAPPINGS.keys()) == expected

    def test_all_stream_mappings_defined(self) -> None:
        """Test that all expected stream mappings are defined."""
        expected = {"events.", "memory.", "dlq."}
        assert set(NatsClient.STREAM_MAPPINGS.keys()) == expected

    def test_stream_names_are_uppercase(self) -> None:
        """Test that stream names follow naming convention."""
        for stream in NatsClient.STREAM_MAPPINGS.values():
            assert stream == stream.upper()
