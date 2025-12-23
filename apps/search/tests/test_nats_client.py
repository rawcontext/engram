"""Tests for NATS client."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

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
