"""Comprehensive tests for memory event consumer module."""

import asyncio
import contextlib
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.indexing.batch import BatchQueue, Document
from src.indexing.consumer import (
    MemoryConsumerConfig,
    MemoryEventConsumer,
)


class TestMemoryConsumerConfig:
    """Tests for MemoryConsumerConfig model."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = MemoryConsumerConfig()
        assert config.topic == "memory.node_created"
        assert config.group_id == "search-indexer"
        assert config.heartbeat_interval_ms == 30000
        assert config.service_id is not None
        assert len(config.service_id) == 8  # UUID shortened to 8 chars

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = MemoryConsumerConfig(
            topic="custom.topic",
            group_id="custom-group",
            service_id="test-123",
            heartbeat_interval_ms=10000,
        )
        assert config.topic == "custom.topic"
        assert config.group_id == "custom-group"
        assert config.service_id == "test-123"
        assert config.heartbeat_interval_ms == 10000

    def test_service_id_auto_generation(self) -> None:
        """Test service_id is automatically generated."""
        config1 = MemoryConsumerConfig()
        config2 = MemoryConsumerConfig()
        # Should generate different IDs
        assert config1.service_id != config2.service_id


class TestMemoryEventConsumer:
    """Tests for MemoryEventConsumer."""

    @pytest.fixture
    def mock_nats_client(self) -> MagicMock:
        """Create mock NATS client."""
        nats = MagicMock()
        nats.connect = AsyncMock()
        nats.close = AsyncMock()
        nats.subscribe = AsyncMock()
        return nats

    @pytest.fixture
    def mock_indexer(self) -> MagicMock:
        """Create mock document indexer."""
        indexer = MagicMock()
        indexer.index_documents = AsyncMock(return_value=1)
        return indexer

    @pytest.fixture
    def mock_nats_pubsub(self) -> MagicMock:
        """Create mock NATS pub/sub publisher."""
        pubsub = MagicMock()
        pubsub.publish_consumer_status = AsyncMock()
        return pubsub

    @pytest.fixture
    def config(self) -> MemoryConsumerConfig:
        """Create test configuration with short intervals."""
        return MemoryConsumerConfig(
            heartbeat_interval_ms=100,  # 100ms for faster tests
            service_id="test-service",
        )

    def test_initialization(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test consumer initialization."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        assert consumer.nats is mock_nats_client
        assert consumer.indexer is mock_indexer
        assert consumer.config is config
        assert consumer._running is False
        assert consumer._batch_queue is None
        assert consumer._heartbeat_task is None

    def test_initialization_with_nats_pubsub(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        mock_nats_pubsub: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test initialization with NATS pub/sub."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )

        assert consumer.nats_pubsub is mock_nats_pubsub

    def test_initialization_without_config(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
    ) -> None:
        """Test initialization with default config."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
        )

        assert consumer.config is not None
        assert isinstance(consumer.config, MemoryConsumerConfig)

    async def test_stop_when_not_running(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test stop when consumer is not running."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        # Should not raise and should not call close
        await consumer.stop()
        mock_nats_client.close.assert_not_called()

    async def test_start_already_running(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test starting already running consumer."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )
        consumer._running = True

        # Should just return without connecting
        await consumer.start()
        mock_nats_client.connect.assert_not_called()

    async def test_start_publishes_ready_status(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        mock_nats_pubsub: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test that start publishes consumer_ready status."""

        async def mock_subscribe(topic: str, group_id: str, handler) -> None:
            # Immediately raise CancelledError to exit
            raise asyncio.CancelledError()

        mock_nats_client.subscribe = mock_subscribe

        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )

        await consumer.start()

        # Should publish consumer_ready
        assert mock_nats_pubsub.publish_consumer_status.call_count >= 1
        mock_nats_pubsub.publish_consumer_status.assert_any_call(
            status_type="consumer_ready",
            group_id=config.group_id,
            service_id=config.service_id,
        )

    async def test_start_handles_nats_pubsub_error(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test start handles NATS pub/sub publish errors gracefully."""
        mock_nats_pubsub = MagicMock()
        mock_nats_pubsub.publish_consumer_status = AsyncMock(
            side_effect=Exception("NATS pub/sub error")
        )

        async def mock_subscribe(topic: str, group_id: str, handler) -> None:
            raise asyncio.CancelledError()

        mock_nats_client.subscribe = mock_subscribe

        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )

        # Should not raise
        await consumer.start()

    async def test_stop_flushes_batch_queue(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test that stop flushes and stops batch queue."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        # Manually set running state and batch queue
        consumer._running = True
        mock_batch_queue = MagicMock()
        mock_batch_queue.stop = AsyncMock()
        consumer._batch_queue = mock_batch_queue

        await consumer.stop()

        mock_batch_queue.stop.assert_called_once()
        assert consumer._batch_queue is None

    async def test_stop_cancels_heartbeat_task(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test that stop cancels heartbeat task."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        # Manually set running state and create a real task
        consumer._running = True

        async def fake_heartbeat() -> None:
            while True:
                await asyncio.sleep(1)

        consumer._heartbeat_task = asyncio.create_task(fake_heartbeat())

        await consumer.stop()

        assert consumer._heartbeat_task is None

    async def test_stop_publishes_disconnected_status(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        mock_nats_pubsub: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test that stop publishes consumer_disconnected status."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )

        # Manually set running state
        consumer._running = True

        await consumer.stop()

        mock_nats_pubsub.publish_consumer_status.assert_called_with(
            status_type="consumer_disconnected",
            group_id=config.group_id,
            service_id=config.service_id,
        )

    async def test_stop_closes_nats_connection(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test that stop closes NATS connection."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        consumer._running = True
        await consumer.stop()

        mock_nats_client.close.assert_called_once()

    def test_parse_memory_node_valid(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing valid memory node event."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        data = {
            "id": "node-123",
            "content": "This is test content",
            "type": "thought",
            "sessionId": "session-456",
            "metadata": {"extra": "data"},
        }

        doc = consumer._parse_memory_node(data)

        assert doc is not None
        assert doc.id == "node-123"
        assert doc.content == "This is test content"
        assert doc.session_id == "session-456"
        assert doc.metadata["type"] == "thought"
        assert doc.metadata["extra"] == "data"

    def test_parse_memory_node_minimal(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing minimal memory node with just required fields."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        data = {
            "id": "node-123",
            "content": "Minimal content",
        }

        doc = consumer._parse_memory_node(data)

        assert doc is not None
        assert doc.id == "node-123"
        assert doc.content == "Minimal content"
        assert doc.session_id is None
        assert doc.metadata == {}

    def test_parse_memory_node_missing_id(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing with missing id returns None."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        data = {"content": "test content"}

        doc = consumer._parse_memory_node(data)
        assert doc is None

    def test_parse_memory_node_missing_content(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing with missing content returns None."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        data = {"id": "node-123"}

        doc = consumer._parse_memory_node(data)
        assert doc is None

    def test_parse_memory_node_with_type(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing memory node with type field."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        data = {
            "id": "node-123",
            "content": "Code snippet",
            "type": "code",
        }

        doc = consumer._parse_memory_node(data)

        assert doc is not None
        assert doc.metadata["type"] == "code"

    def test_parse_memory_node_error_handling(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing handles malformed data gracefully."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        # Invalid data that might cause errors
        data = {"id": None, "content": None}

        doc = consumer._parse_memory_node(data)
        assert doc is None

    async def test_handle_message_valid(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test handling valid message."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        mock_batch_queue = MagicMock()
        mock_batch_queue.add = AsyncMock()
        consumer._batch_queue = mock_batch_queue

        data = {
            "id": "node-123",
            "content": "Test content",
        }

        await consumer._handle_message("memory.nodes.created", data)

        mock_batch_queue.add.assert_called_once()
        call_args = mock_batch_queue.add.call_args
        doc = call_args[0][0]
        assert isinstance(doc, Document)
        assert doc.id == "node-123"

    async def test_handle_message_invalid_data(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test handling message with invalid data."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        mock_batch_queue = MagicMock()
        mock_batch_queue.add = AsyncMock()
        consumer._batch_queue = mock_batch_queue

        # Missing required fields
        data = {"invalid": "data"}

        # Should not raise
        await consumer._handle_message("memory.nodes.created", data)

        # Should not add to queue
        mock_batch_queue.add.assert_not_called()

    async def test_handle_message_no_batch_queue(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test handling message when batch queue is None."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        consumer._batch_queue = None

        data = {
            "id": "node-123",
            "content": "Test content",
        }

        # Should not raise
        await consumer._handle_message("memory.nodes.created", data)

    async def test_handle_message_exception_handling(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test handling message with exception in processing."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        mock_batch_queue = MagicMock()
        mock_batch_queue.add = AsyncMock(side_effect=Exception("Queue error"))
        consumer._batch_queue = mock_batch_queue

        data = {
            "id": "node-123",
            "content": "Test content",
        }

        # Should not raise - errors should be logged
        await consumer._handle_message("memory.nodes.created", data)

    async def test_heartbeat_loop(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        mock_nats_pubsub: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test heartbeat loop publishes heartbeats."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )
        consumer._running = True

        # Run heartbeat for a short time
        heartbeat_task = asyncio.create_task(consumer._heartbeat_loop())
        await asyncio.sleep(0.15)  # Wait for at least one heartbeat
        consumer._running = False
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

        # Should have published at least one heartbeat
        assert mock_nats_pubsub.publish_consumer_status.call_count >= 1
        mock_nats_pubsub.publish_consumer_status.assert_any_call(
            status_type="consumer_heartbeat",
            group_id=config.group_id,
            service_id=config.service_id,
        )

    async def test_heartbeat_loop_handles_error(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test heartbeat loop handles NATS pub/sub errors gracefully."""
        mock_nats_pubsub = MagicMock()
        mock_nats_pubsub.publish_consumer_status = AsyncMock(
            side_effect=Exception("NATS error")
        )

        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )
        consumer._running = True

        # Run heartbeat for a short time - should not crash
        heartbeat_task = asyncio.create_task(consumer._heartbeat_loop())
        await asyncio.sleep(0.15)
        consumer._running = False
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

    async def test_heartbeat_loop_no_nats_pubsub(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test heartbeat loop with no NATS pub/sub publisher."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            nats_pubsub=None,
            config=config,
        )
        consumer._running = True

        # Run heartbeat for a short time - should not crash
        heartbeat_task = asyncio.create_task(consumer._heartbeat_loop())
        await asyncio.sleep(0.15)
        consumer._running = False
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

    async def test_heartbeat_loop_cancellation(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        mock_nats_pubsub: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test heartbeat loop handles cancellation properly."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )
        consumer._running = True

        heartbeat_task = asyncio.create_task(consumer._heartbeat_loop())
        await asyncio.sleep(0.05)
        heartbeat_task.cancel()

        # Should not raise
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

    async def test_start_and_stop_integration(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        mock_nats_pubsub: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test full start/stop cycle."""

        async def mock_subscribe(topic: str, group_id: str, handler) -> None:
            # Wait a bit then exit
            await asyncio.sleep(0.05)
            raise asyncio.CancelledError()

        mock_nats_client.subscribe = mock_subscribe

        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )

        await consumer.start()

        # Verify lifecycle events
        assert mock_nats_client.connect.call_count >= 1
        assert mock_nats_pubsub.publish_consumer_status.call_count >= 2  # ready + disconnected
        assert mock_nats_client.close.call_count >= 1

    async def test_subscribe_exception_handling(
        self,
        mock_nats_client: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test start handles subscription exceptions."""

        async def mock_subscribe(topic: str, group_id: str, handler) -> None:
            raise Exception("Subscription error")

        mock_nats_client.subscribe = mock_subscribe

        consumer = MemoryEventConsumer(
            nats_client=mock_nats_client,
            indexer=mock_indexer,
            config=config,
        )

        # Should call stop on exception
        await consumer.start()

        # Stop should have been called
        mock_nats_client.close.assert_called()
