"""Tests for turns indexing module."""

import contextlib
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.indexing.batch import Document
from src.indexing.turns import (
    TurnFinalizedConsumer,
    TurnFinalizedConsumerConfig,
    TurnsIndexer,
    TurnsIndexerConfig,
)


class TestTurnsIndexerConfig:
    """Tests for TurnsIndexerConfig model."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = TurnsIndexerConfig()
        assert config.collection_name == "engram_turns"
        assert config.dense_vector_name == "turn_dense"
        assert config.sparse_vector_name == "turn_sparse"
        assert config.colbert_vector_name == "turn_colbert"
        assert config.enable_colbert is True
        assert config.batch_size == 32

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = TurnsIndexerConfig(
            collection_name="custom_turns",
            enable_colbert=False,
        )
        assert config.collection_name == "custom_turns"
        assert config.enable_colbert is False


class TestTurnsIndexer:
    """Tests for TurnsIndexer."""

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
    def config(self) -> TurnsIndexerConfig:
        """Create test config - disable ColBERT for most tests."""
        return TurnsIndexerConfig(enable_colbert=False)

    async def test_index_documents_empty(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: TurnsIndexerConfig,
    ) -> None:
        """Test indexing empty document list."""
        indexer = TurnsIndexer(
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
        config: TurnsIndexerConfig,
    ) -> None:
        """Test successful document indexing."""
        indexer = TurnsIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(
            id="turn-1", content="User: test\nAssistant: response", session_id="session-1"
        )
        result = await indexer.index_documents([doc])

        assert result == 1
        mock_qdrant.client.upsert.assert_called_once()

    async def test_index_documents_with_colbert(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test indexing with ColBERT enabled."""
        config = TurnsIndexerConfig(enable_colbert=True)
        indexer = TurnsIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="turn-1", content="test content")
        result = await indexer.index_documents([doc])

        assert result == 1
        mock_embedder_factory.get_colbert_embedder.assert_called_once()

    async def test_index_documents_error(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: TurnsIndexerConfig,
    ) -> None:
        """Test indexing with error returns 0."""
        mock_qdrant.client.upsert = AsyncMock(side_effect=Exception("Qdrant error"))

        indexer = TurnsIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="turn-1", content="test content")
        result = await indexer.index_documents([doc])

        assert result == 0

    def test_build_point_with_colbert(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test building Qdrant point with ColBERT vectors."""
        config = TurnsIndexerConfig(enable_colbert=True)
        indexer = TurnsIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(
            id="turn-1",
            content="test content",
            metadata={"type": "turn"},
            session_id="session-1",
        )

        colbert_vecs = [[0.1, 0.2], [0.3, 0.4]]
        point = indexer._build_point(
            doc=doc,
            dense_vec=[0.1, 0.2, 0.3],
            sparse_vec={1: 0.5, 2: 0.3},
            colbert_vecs=colbert_vecs,
        )

        assert config.colbert_vector_name in point.vector
        assert point.vector[config.colbert_vector_name] == colbert_vecs
        assert point.id == "turn-1"
        assert point.payload["content"] == "test content"
        assert point.payload["session_id"] == "session-1"

    def test_build_point_without_colbert(
        self,
        mock_qdrant: MagicMock,
        mock_embedder_factory: MagicMock,
        config: TurnsIndexerConfig,
    ) -> None:
        """Test building Qdrant point without ColBERT."""
        indexer = TurnsIndexer(
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedder_factory,
            config=config,
        )

        doc = Document(id="turn-1", content="test content")
        point = indexer._build_point(
            doc=doc,
            dense_vec=[0.1, 0.2, 0.3],
            sparse_vec={1: 0.5},
            colbert_vecs=None,
        )

        assert config.colbert_vector_name not in point.vector


class TestTurnFinalizedConsumerConfig:
    """Tests for TurnFinalizedConsumerConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = TurnFinalizedConsumerConfig()
        assert config.topic == "memory.turn_finalized"
        assert config.group_id == "search-turns-indexer"
        assert config.heartbeat_interval_ms == 30000
        assert config.service_id is not None

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = TurnFinalizedConsumerConfig(
            topic="custom.topic",
            group_id="custom-group",
            service_id="test-service",
        )
        assert config.topic == "custom.topic"
        assert config.group_id == "custom-group"
        assert config.service_id == "test-service"


class TestTurnFinalizedConsumer:
    """Tests for TurnFinalizedConsumer."""

    @pytest.fixture
    def mock_nats(self) -> MagicMock:
        """Create mock NATS client."""
        nats = MagicMock()
        nats.close = AsyncMock()
        nats.connect = AsyncMock()
        consumer = AsyncMock()
        consumer.stop = AsyncMock()
        consumer.__aiter__ = MagicMock(return_value=iter([]))
        nats.create_consumer = AsyncMock(return_value=consumer)
        return nats

    @pytest.fixture
    def mock_indexer(self) -> MagicMock:
        """Create mock turns indexer."""
        indexer = MagicMock()
        indexer.index_documents = AsyncMock(return_value=1)
        return indexer

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis publisher."""
        redis = MagicMock()
        redis.publish_consumer_status = AsyncMock()
        return redis

    @pytest.fixture
    def config(self) -> TurnFinalizedConsumerConfig:
        """Create test config."""
        return TurnFinalizedConsumerConfig(
            heartbeat_interval_ms=100,
            service_id="test-service",
        )

    async def test_initialization(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test consumer initialization."""
        consumer = TurnFinalizedConsumer(
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
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test stop when consumer is not running."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        # Should not raise
        await consumer.stop()

    async def test_start_already_running(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test starting already running consumer."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._running = True

        # Should just return
        await consumer.start()

        mock_nats.create_consumer.assert_not_called()

    def test_parse_turn_finalized_valid(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test parsing valid turn_finalized event."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )

        data = {
            "id": "turn-123",
            "session_id": "session-456",
            "sequence_index": 0,
            "user_content": "What is the capital of France?",
            "assistant_content": "The capital of France is Paris.",
            "reasoning_preview": "I need to answer about geography.",
            "tool_calls": ["memory_recall"],
            "files_touched": ["data.json"],
            "input_tokens": 10,
            "output_tokens": 20,
            "timestamp": 1234567890,
        }

        doc = consumer._parse_turn_finalized(data)

        assert doc is not None
        assert doc.id == "turn-123"
        assert "User: What is the capital of France?" in doc.content
        assert "Assistant: The capital of France is Paris." in doc.content
        assert "Reasoning: I need to answer about geography." in doc.content
        assert doc.session_id == "session-456"
        assert doc.metadata["type"] == "turn"
        assert doc.metadata["sequence_index"] == 0
        assert doc.metadata["tool_calls"] == ["memory_recall"]
        assert doc.metadata["files_touched"] == ["data.json"]
        assert doc.metadata["has_reasoning"] is True

    def test_parse_turn_finalized_missing_id(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test parsing with missing id returns None."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )

        data = {"user_content": "test"}
        doc = consumer._parse_turn_finalized(data)

        assert doc is None

    def test_parse_turn_finalized_no_content(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test parsing with no content returns None."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )

        data = {"id": "turn-123"}
        doc = consumer._parse_turn_finalized(data)

        assert doc is None

    def test_parse_turn_finalized_with_code(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test parsing turn with code blocks."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )

        data = {
            "id": "turn-123",
            "assistant_content": "Here's the code:\n```python\nprint('hello')\n```",
        }

        doc = consumer._parse_turn_finalized(data)

        assert doc is not None
        assert doc.metadata["has_code"] is True

    def test_parse_turn_finalized_user_only(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test parsing turn with only user content."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )

        data = {
            "id": "turn-123",
            "user_content": "Hello world",
        }

        doc = consumer._parse_turn_finalized(data)

        assert doc is not None
        assert "User: Hello world" in doc.content
        assert "Assistant:" not in doc.content

    async def test_stop_publishes_disconnected_status(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        mock_redis: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test that stop publishes disconnected status."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            redis_publisher=mock_redis,
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

        mock_redis.publish_consumer_status.assert_called_with(
            status_type="consumer_disconnected",
            group_id=config.group_id,
            service_id=config.service_id,
        )

    async def test_stop_handles_redis_error(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test that stop handles Redis publish errors gracefully."""
        mock_redis = MagicMock()
        mock_redis.publish_consumer_status = AsyncMock(side_effect=Exception("Redis error"))

        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            redis_publisher=mock_redis,
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

    async def test_handle_message_valid(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test handling message with valid data."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._batch_queue = MagicMock()
        consumer._batch_queue.add = AsyncMock()

        data = {"id": "turn-123", "user_content": "test content"}

        await consumer._handle_message("memory.turns.finalized", data)

        consumer._batch_queue.add.assert_called_once()

    async def test_handle_message_with_metadata(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test handling message with metadata."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._batch_queue = MagicMock()
        consumer._batch_queue.add = AsyncMock()

        data = {
            "id": "turn-123",
            "user_content": "test content",
            "assistant_content": "response",
            "session_id": "session-456",
        }

        await consumer._handle_message("memory.turns.finalized", data)

        consumer._batch_queue.add.assert_called_once()

    async def test_handle_message_missing_fields(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test handling message with missing required fields."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._batch_queue = MagicMock()
        consumer._batch_queue.add = AsyncMock()

        # Missing content field
        data = {"id": "turn-123"}

        # Should not raise
        await consumer._handle_message("memory.turns.finalized", data)
        consumer._batch_queue.add.assert_not_called()

    async def test_handle_message_no_batch_queue(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test handling message when batch queue is None."""
        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            config=config,
        )
        consumer._batch_queue = None

        data = {"id": "turn-123", "user_content": "test content"}

        # Should not raise
        await consumer._handle_message("memory.turns.finalized", data)

    async def test_heartbeat_loop(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        mock_redis: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test heartbeat loop publishes heartbeats."""
        import asyncio

        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            redis_publisher=mock_redis,
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
        assert mock_redis.publish_consumer_status.call_count >= 1

    async def test_heartbeat_loop_handles_redis_error(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test heartbeat loop handles Redis errors gracefully."""
        import asyncio

        mock_redis = MagicMock()
        mock_redis.publish_consumer_status = AsyncMock(side_effect=Exception("Redis error"))

        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            redis_publisher=mock_redis,
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

    async def test_heartbeat_loop_no_redis(
        self,
        mock_nats: MagicMock,
        mock_indexer: MagicMock,
        config: TurnFinalizedConsumerConfig,
    ) -> None:
        """Test heartbeat loop with no Redis publisher."""
        import asyncio

        consumer = TurnFinalizedConsumer(
            nats_client=mock_nats,
            indexer=mock_indexer,
            redis_publisher=None,
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
