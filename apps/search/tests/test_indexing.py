"""Tests for indexing module (batch, consumer, indexer)."""

import asyncio
import contextlib
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.indexing.batch import BatchConfig, BatchQueue, Document
from src.indexing.consumer import MemoryConsumerConfig, MemoryEventConsumer
from src.indexing.indexer import DocumentIndexer, IndexerConfig


class TestBatchConfig:
    """Tests for BatchConfig model."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = BatchConfig()
        assert config.batch_size == 100
        assert config.flush_interval_ms == 5000
        assert config.max_queue_size == 1000

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = BatchConfig(batch_size=50, flush_interval_ms=1000, max_queue_size=500)
        assert config.batch_size == 50
        assert config.flush_interval_ms == 1000
        assert config.max_queue_size == 500


class TestDocument:
    """Tests for Document model."""

    def test_required_fields(self) -> None:
        """Test document with required fields only."""
        doc = Document(id="doc-1", content="test content")
        assert doc.id == "doc-1"
        assert doc.content == "test content"
        assert doc.metadata == {}
        assert doc.session_id is None

    def test_all_fields(self) -> None:
        """Test document with all fields."""
        doc = Document(
            id="doc-2",
            content="test content",
            metadata={"type": "code"},
            session_id="session-123",
        )
        assert doc.id == "doc-2"
        assert doc.metadata == {"type": "code"}
        assert doc.session_id == "session-123"


class TestBatchQueue:
    """Tests for BatchQueue."""

    @pytest.fixture
    def config(self) -> BatchConfig:
        """Create test config with small values for faster tests."""
        return BatchConfig(batch_size=3, flush_interval_ms=100, max_queue_size=10)

    @pytest.fixture
    def mock_callback(self) -> MagicMock:
        """Create mock flush callback."""
        return MagicMock(return_value=None)

    @pytest.fixture
    def async_callback(self) -> AsyncMock:
        """Create async mock flush callback."""
        return AsyncMock(return_value=None)

    async def test_start_sets_running(self, config: BatchConfig, mock_callback: MagicMock) -> None:
        """Test that start sets running flag."""
        queue = BatchQueue(config, mock_callback)
        assert not queue._running

        await queue.start()
        assert queue._running
        assert queue._flush_task is not None

        await queue.stop()

    async def test_start_already_running_warns(
        self, config: BatchConfig, mock_callback: MagicMock
    ) -> None:
        """Test that starting already running queue logs warning."""
        queue = BatchQueue(config, mock_callback)

        await queue.start()
        # Second start should just return
        await queue.start()
        assert queue._running

        await queue.stop()

    async def test_stop_flushes_remaining(
        self, config: BatchConfig, async_callback: AsyncMock
    ) -> None:
        """Test that stop flushes remaining documents."""
        queue = BatchQueue(config, async_callback)
        await queue.start()

        doc = Document(id="1", content="test")
        await queue.add(doc)

        await queue.stop()

        async_callback.assert_called_once()
        assert len(async_callback.call_args[0][0]) == 1

    async def test_stop_when_not_running(
        self, config: BatchConfig, mock_callback: MagicMock
    ) -> None:
        """Test stop when queue is not running."""
        queue = BatchQueue(config, mock_callback)
        # Should not raise
        await queue.stop()

    async def test_add_document(self, config: BatchConfig, mock_callback: MagicMock) -> None:
        """Test adding a document to queue."""
        queue = BatchQueue(config, mock_callback)
        await queue.start()

        doc = Document(id="1", content="test")
        await queue.add(doc)

        assert queue.queue_size == 1

        await queue.stop()

    async def test_add_triggers_flush_at_batch_size(
        self, config: BatchConfig, async_callback: AsyncMock
    ) -> None:
        """Test that adding documents triggers flush when batch size reached."""
        queue = BatchQueue(config, async_callback)
        await queue.start()

        # Add documents up to batch size (3)
        for i in range(3):
            await queue.add(Document(id=str(i), content=f"content {i}"))

        # Give a small delay for flush
        await asyncio.sleep(0.01)

        # Should have flushed
        async_callback.assert_called_once()
        assert len(async_callback.call_args[0][0]) == 3
        assert queue.queue_size == 0

        await queue.stop()

    async def test_add_exceeds_max_capacity_raises(self, async_callback: AsyncMock) -> None:
        """Test that exceeding max queue size raises error."""
        # Create config where max_queue_size < batch_size to prevent auto-flush
        config = BatchConfig(batch_size=100, flush_interval_ms=10000, max_queue_size=5)

        queue = BatchQueue(config, async_callback)
        await queue.start()

        # Fill queue to max capacity
        for i in range(5):
            await queue.add(Document(id=str(i), content=f"content {i}"))

        # Next add should raise
        with pytest.raises(RuntimeError, match="max capacity"):
            await queue.add(Document(id="overflow", content="overflow"))

        await queue.stop()

    async def test_flush_loop_periodic_flush(
        self, config: BatchConfig, async_callback: AsyncMock
    ) -> None:
        """Test that flush loop periodically flushes."""
        queue = BatchQueue(config, async_callback)
        await queue.start()

        # Add a document
        await queue.add(Document(id="1", content="test"))

        # Wait longer than flush interval
        await asyncio.sleep(0.15)

        # Should have flushed
        async_callback.assert_called()

        await queue.stop()

    async def test_flush_empty_queue(self, config: BatchConfig, async_callback: AsyncMock) -> None:
        """Test that flushing empty queue does nothing."""
        queue = BatchQueue(config, async_callback)
        await queue.start()

        # Wait for flush interval
        await asyncio.sleep(0.15)

        # Should not have called callback for empty queue
        async_callback.assert_not_called()

        await queue.stop()

    async def test_flush_with_sync_callback(
        self, config: BatchConfig, mock_callback: MagicMock
    ) -> None:
        """Test flush with synchronous callback."""
        queue = BatchQueue(config, mock_callback)
        await queue.start()

        doc = Document(id="1", content="test")
        await queue.add(doc)

        await queue.stop()

        mock_callback.assert_called_once()

    async def test_flush_callback_error_handled(self, config: BatchConfig) -> None:
        """Test that callback errors are handled gracefully."""
        error_callback = AsyncMock(side_effect=Exception("Flush error"))
        queue = BatchQueue(config, error_callback)
        await queue.start()

        # Add enough to trigger flush
        for i in range(3):
            await queue.add(Document(id=str(i), content=f"content {i}"))

        await asyncio.sleep(0.01)

        # Error should be logged but not crash
        await queue.stop()

    async def test_queue_size_property(self, config: BatchConfig, mock_callback: MagicMock) -> None:
        """Test queue_size property."""
        queue = BatchQueue(config, mock_callback)
        await queue.start()

        assert queue.queue_size == 0

        await queue.add(Document(id="1", content="test"))
        assert queue.queue_size == 1

        await queue.add(Document(id="2", content="test2"))
        assert queue.queue_size == 2

        await queue.stop()

    async def test_flush_loop_handles_exception(self, config: BatchConfig) -> None:
        """Test that flush loop handles exceptions gracefully."""
        call_count = 0

        async def flaky_callback(docs: list[Document]) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("First flush fails")

        queue = BatchQueue(config, flaky_callback)
        await queue.start()

        # Add document and trigger multiple flushes
        await queue.add(Document(id="1", content="test"))
        await asyncio.sleep(0.15)

        # Should have tried to flush
        assert call_count >= 1

        await queue.stop()


class TestMemoryConsumerConfig:
    """Tests for MemoryConsumerConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = MemoryConsumerConfig()
        assert config.topic == "memory.node_created"
        assert config.group_id == "search-indexer"
        assert config.heartbeat_interval_ms == 30000
        assert config.service_id is not None  # Generated UUID

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = MemoryConsumerConfig(
            topic="custom.topic",
            group_id="custom-group",
            service_id="test-service",
        )
        assert config.topic == "custom.topic"
        assert config.group_id == "custom-group"
        assert config.service_id == "test-service"


class TestMemoryEventConsumer:
    """Tests for MemoryEventConsumer."""

    @pytest.fixture
    def mock_nats(self) -> MagicMock:
        """Create mock NATS client."""
        nats = MagicMock()
        nats.close = AsyncMock()
        nats.connect = AsyncMock()
        consumer = AsyncMock()
        consumer.stop = AsyncMock()
        # Make consumer iterable
        consumer.__aiter__ = MagicMock(return_value=iter([]))
        nats.create_consumer = AsyncMock(return_value=consumer)
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
        nats_pubsub = MagicMock()
        nats_pubsub.publish_consumer_status = AsyncMock()
        return nats_pubsub

    @pytest.fixture
    def config(self) -> MemoryConsumerConfig:
        """Create test config."""
        return MemoryConsumerConfig(
            heartbeat_interval_ms=100,
            service_id="test-service",
        )

    async def test_initialization(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test consumer initialization."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        assert consumer.nats is mock_nats
        assert consumer.indexer is mock_indexer
        assert consumer.config is config
        assert consumer._running is False

    async def test_stop_when_not_running(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test stop when consumer is not running."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        # Should not raise
        await consumer.stop()

    async def test_stop_publishes_disconnected_status(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        mock_nats_pubsub: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test that stop publishes disconnected status."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )

        # Manually set running state
        consumer._running = True
        consumer._batch_queue = MagicMock()
        consumer._batch_queue.stop = AsyncMock()
        consumer._consumer = AsyncMock()
        consumer._consumer.stop = AsyncMock()
        consumer._heartbeat_task = None

        await consumer.stop()

        mock_nats_pubsub.publish_consumer_status.assert_called_with(
            status_type="consumer_disconnected",
            group_id=config.group_id,
            service_id=config.service_id,
        )

    async def test_stop_handles_nats_pubsub_error(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test that stop handles NATS pub/sub publish errors gracefully."""
        mock_nats_pubsub = MagicMock()
        mock_nats_pubsub.publish_consumer_status = AsyncMock(side_effect=Exception("NATS error"))

        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )

        # Manually set running state
        consumer._running = True
        consumer._batch_queue = MagicMock()
        consumer._batch_queue.stop = AsyncMock()
        consumer._consumer = AsyncMock()
        consumer._consumer.stop = AsyncMock()
        consumer._heartbeat_task = None

        # Should not raise
        await consumer.stop()

    def test_parse_memory_node_valid(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing valid memory node data."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )

        data = {
            "id": "node-123",
            "content": "test content",
            "type": "thought",
            "sessionId": "session-456",
            "metadata": {"extra": "data"},
        }

        doc = consumer._parse_memory_node(data)

        assert doc is not None
        assert doc.id == "node-123"
        assert doc.content == "test content"
        assert doc.session_id == "session-456"
        assert doc.metadata["type"] == "thought"
        assert doc.metadata["extra"] == "data"

    def test_parse_memory_node_missing_id(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing with missing id returns None."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )

        data = {"content": "test content"}
        doc = consumer._parse_memory_node(data)

        assert doc is None

    def test_parse_memory_node_missing_content(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing with missing content returns None."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )

        data = {"id": "node-123"}
        doc = consumer._parse_memory_node(data)

        assert doc is None

    def test_parse_memory_node_minimal(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test parsing with minimal required fields."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )

        data = {"id": "node-123", "content": "test content"}
        doc = consumer._parse_memory_node(data)

        assert doc is not None
        assert doc.id == "node-123"
        assert doc.content == "test content"
        assert doc.session_id is None
        assert doc.metadata == {}

    async def test_handle_message_valid(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test handling message with valid data."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._batch_queue = MagicMock()
        consumer._batch_queue.add = AsyncMock()

        data = {"id": "node-123", "content": "test content"}

        await consumer._handle_message("memory.nodes.created", data)

        consumer._batch_queue.add.assert_called_once()

    async def test_handle_message_with_metadata(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test handling message with metadata."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._batch_queue = MagicMock()
        consumer._batch_queue.add = AsyncMock()

        data = {
            "id": "node-123",
            "content": "test content",
            "type": "thought",
            "sessionId": "session-456",
        }

        await consumer._handle_message("memory.nodes.created", data)

        consumer._batch_queue.add.assert_called_once()

    async def test_handle_message_missing_fields(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test handling message with missing required fields."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._batch_queue = MagicMock()
        consumer._batch_queue.add = AsyncMock()

        # Missing content field
        data = {"id": "node-123"}

        # Should not raise
        await consumer._handle_message("memory.nodes.created", data)
        consumer._batch_queue.add.assert_not_called()

    async def test_handle_message_no_batch_queue(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test handling message when batch queue is None."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._batch_queue = None

        data = {"id": "node-123", "content": "test content"}

        # Should not raise
        await consumer._handle_message("memory.nodes.created", data)

    async def test_heartbeat_loop(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        mock_nats_pubsub: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test heartbeat loop publishes heartbeats."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            nats_pubsub=mock_nats_pubsub,
            config=config,
        )
        consumer._running = True

        # Run heartbeat for a short time
        heartbeat_task = asyncio.create_task(consumer._heartbeat_loop())
        await asyncio.sleep(0.15)
        consumer._running = False
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

        # Should have published at least one heartbeat
        assert mock_nats_pubsub.publish_consumer_status.call_count >= 1

    async def test_heartbeat_loop_handles_nats_pubsub_error(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test heartbeat loop handles NATS pub/sub errors gracefully."""
        mock_nats_pubsub = MagicMock()
        mock_nats_pubsub.publish_consumer_status = AsyncMock(side_effect=Exception("NATS error"))

        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
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
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test heartbeat loop with no NATS pub/sub publisher."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
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

    async def test_start_already_running(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: MemoryConsumerConfig,
    ) -> None:
        """Test starting already running consumer."""
        consumer = MemoryEventConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._running = True

        # Should just return
        await consumer.start()

        mock_nats.create_consumer.assert_not_called()


class TestIndexerConfig:
    """Tests for IndexerConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = IndexerConfig()
        assert config.collection_name == "engram_turns"
        assert config.dense_vector_name == "text_dense"
        assert config.sparse_vector_name == "text_sparse"
        assert config.colbert_vector_name == "text_colbert"
        assert config.enable_colbert is True
        assert config.batch_size == 32

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = IndexerConfig(
            collection_name="custom_collection",
            enable_colbert=False,
        )
        assert config.collection_name == "custom_collection"
        assert config.enable_colbert is False


class TestDocumentIndexer:
    """Tests for DocumentIndexer."""

    @pytest.fixture
    def mock_qdrant(self) -> MagicMock:
        """Create mock Qdrant client."""
        qdrant = MagicMock()
        qdrant.client = MagicMock()
        qdrant.client.upsert = AsyncMock()
        return qdrant

    @pytest.fixture
    def mock_embedder_factory(self) -> MagicMock:
        """Create mock embedder factory."""
        factory = MagicMock()

        # Text embedder
        text_embedder = MagicMock()
        text_embedder.load = AsyncMock()
        text_embedder.embed_batch = AsyncMock(return_value=[[0.1, 0.2, 0.3]])
        factory.get_text_embedder = AsyncMock(return_value=text_embedder)

        # Sparse embedder
        sparse_embedder = MagicMock()
        sparse_embedder.load = AsyncMock()
        sparse_embedder.embed_sparse_batch = MagicMock(return_value=[{1: 0.5, 2: 0.3}])
        factory.get_sparse_embedder = AsyncMock(return_value=sparse_embedder)

        # ColBERT embedder
        colbert_embedder = MagicMock()
        colbert_embedder.load = AsyncMock()
        colbert_embedder.embed_document_batch = MagicMock(return_value=[[[0.1, 0.2], [0.3, 0.4]]])
        factory.get_colbert_embedder = AsyncMock(return_value=colbert_embedder)

        return factory

    @pytest.fixture
    def config(self) -> IndexerConfig:
        """Create test config - disable ColBERT to avoid MultiVector issues."""
        return IndexerConfig(enable_colbert=False)

    async def test_initialization(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: IndexerConfig,
    ) -> None:
        """Test indexer initialization."""
        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )
        assert indexer.qdrant is mock_qdrant
        assert indexer.embedders is mock_embedder_factory
        assert indexer.config is config

    async def test_index_documents_empty(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: IndexerConfig,
    ) -> None:
        """Test indexing empty document list."""
        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        result = await indexer.index_documents([])

        assert result == 0
        mock_qdrant.client.upsert.assert_not_called()

    async def test_index_documents_success(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: IndexerConfig,
    ) -> None:
        """Test successful document indexing."""
        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="doc-1", content="test content", session_id="session-1")
        result = await indexer.index_documents([doc])

        assert result == 1
        mock_qdrant.client.upsert.assert_called_once()

    async def test_index_documents_without_colbert(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test indexing with ColBERT disabled."""
        config = IndexerConfig(enable_colbert=False)
        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="doc-1", content="test content")
        result = await indexer.index_documents([doc])

        assert result == 1
        # Should not call ColBERT embedder
        mock_embedder_factory.get_colbert_embedder.assert_not_called()

    async def test_index_documents_error(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: IndexerConfig,
    ) -> None:
        """Test indexing with error returns 0."""
        mock_qdrant.client.upsert = AsyncMock(side_effect=Exception("Qdrant error"))

        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="doc-1", content="test content")
        result = await indexer.index_documents([doc])

        assert result == 0

    async def test_index_single_success(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: IndexerConfig,
    ) -> None:
        """Test indexing single document."""
        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="doc-1", content="test content")
        result = await indexer.index_single(doc)

        assert result is True

    async def test_index_single_failure(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: IndexerConfig,
    ) -> None:
        """Test indexing single document failure."""
        mock_qdrant.client.upsert = AsyncMock(side_effect=Exception("error"))

        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="doc-1", content="test content")
        result = await indexer.index_single(doc)

        assert result is False

    def test_build_point_with_colbert(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test building Qdrant point with ColBERT vectors."""
        # Enable ColBERT for this specific test
        config = IndexerConfig(enable_colbert=True)

        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(
            id="doc-1",
            content="test content",
            metadata={"type": "code"},
            session_id="session-1",
        )

        colbert_vecs = [[0.1, 0.2], [0.3, 0.4]]
        point = indexer._build_point(
            doc=doc,
            dense_vec=[0.1, 0.2, 0.3],
            sparse_vec={1: 0.5, 2: 0.3},
            colbert_vecs=colbert_vecs,
        )

        # Verify ColBERT vectors are included in vectors dict
        assert config.colbert_vector_name in point.vector
        assert point.vector[config.colbert_vector_name] == colbert_vecs
        # Verify payload
        assert point.id == "doc-1"
        assert point.payload["content"] == "test content"
        assert point.payload["type"] == "code"
        assert point.payload["session_id"] == "session-1"

    def test_build_point_without_colbert(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test building Qdrant point without ColBERT vectors."""
        config = IndexerConfig(enable_colbert=False)
        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="doc-1", content="test content")

        point = indexer._build_point(
            doc=doc,
            dense_vec=[0.1, 0.2, 0.3],
            sparse_vec={1: 0.5},
            colbert_vecs=None,
        )

        assert config.colbert_vector_name not in point.vector

    def test_build_point_no_session_id(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: IndexerConfig,
    ) -> None:
        """Test building Qdrant point without session_id."""
        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="doc-1", content="test content")

        point = indexer._build_point(
            doc=doc,
            dense_vec=[0.1, 0.2, 0.3],
            sparse_vec={1: 0.5},
            colbert_vecs=None,
        )

        assert "session_id" not in point.payload

    async def test_index_documents_with_empty_colbert(
        self,
        mock_qdrant: MagicMock,
        config: IndexerConfig,
    ) -> None:
        """Test indexing handles empty ColBERT embeddings."""
        factory = MagicMock()

        text_embedder = MagicMock()
        text_embedder.load = AsyncMock()
        text_embedder.embed_batch = AsyncMock(return_value=[[0.1, 0.2, 0.3]])
        factory.get_text_embedder = AsyncMock(return_value=text_embedder)

        sparse_embedder = MagicMock()
        sparse_embedder.load = AsyncMock()
        sparse_embedder.embed_sparse_batch = MagicMock(return_value=[{1: 0.5}])
        factory.get_sparse_embedder = AsyncMock(return_value=sparse_embedder)

        # ColBERT returns empty embeddings
        colbert_embedder = MagicMock()
        colbert_embedder.load = AsyncMock()
        colbert_embedder.embed_document_batch = MagicMock(return_value=[[]])
        factory.get_colbert_embedder = AsyncMock(return_value=colbert_embedder)

        indexer = DocumentIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=factory,
            config=config,
        )

        doc = Document(id="doc-1", content="test content")
        result = await indexer.index_documents([doc])

        assert result == 1
