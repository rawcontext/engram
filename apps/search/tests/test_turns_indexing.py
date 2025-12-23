"""Tests for turn-level document indexing."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.clients.qdrant import QdrantClientWrapper
from src.config import Settings
from src.embedders.factory import EmbedderFactory
from src.indexing.batch import Document
from src.indexing.turns import (
    TurnFinalizedConsumer,
    TurnFinalizedConsumerConfig,
    TurnsIndexer,
    TurnsIndexerConfig,
)


class TestTurnsIndexer:
    """Tests for TurnsIndexer."""

    @pytest.fixture
    def mock_settings(self) -> Settings:
        """Create mock settings."""
        return Settings(
            qdrant_url="http://localhost:6333",
            qdrant_turns_collection="test_turns",
            embedder_device="cpu",
            embedder_preload=False,
        )

    @pytest.fixture
    def mock_qdrant_wrapper(self, mock_settings: Settings) -> QdrantClientWrapper:
        """Create mock Qdrant client wrapper."""
        wrapper = QdrantClientWrapper(mock_settings)
        wrapper._client = AsyncMock()
        return wrapper

    @pytest.fixture
    def mock_embedder_factory(self, mock_settings: Settings) -> EmbedderFactory:
        """Create mock embedder factory."""
        factory = EmbedderFactory(mock_settings)

        # Mock text embedder
        text_embedder = MagicMock()
        text_embedder.load = AsyncMock()
        text_embedder.embed_batch = AsyncMock(return_value=[[0.1] * 384])

        # Mock sparse embedder
        sparse_embedder = MagicMock()
        sparse_embedder.load = AsyncMock()
        sparse_embedder.embed_sparse_batch = MagicMock(return_value=[{1: 0.5, 2: 0.3}])

        # Mock ColBERT embedder
        colbert_embedder = MagicMock()
        colbert_embedder.load = AsyncMock()
        colbert_embedder.embed_document_batch = MagicMock(return_value=[[[0.1] * 128]])

        factory.get_text_embedder = AsyncMock(return_value=text_embedder)
        factory.get_sparse_embedder = AsyncMock(return_value=sparse_embedder)
        factory.get_colbert_embedder = AsyncMock(return_value=colbert_embedder)

        return factory

    @pytest.fixture
    def turns_indexer(
        self,
        mock_qdrant_wrapper: QdrantClientWrapper,
        mock_embedder_factory: EmbedderFactory,
    ) -> TurnsIndexer:
        """Create TurnsIndexer instance."""
        config = TurnsIndexerConfig(collection_name="test_turns")
        return TurnsIndexer(mock_qdrant_wrapper, mock_embedder_factory, config)

    @pytest.mark.asyncio
    async def test_index_documents_success(
        self,
        turns_indexer: TurnsIndexer,
        mock_qdrant_wrapper: QdrantClientWrapper,
    ) -> None:
        """Test successful document indexing."""
        documents = [
            Document(
                id="turn-1",
                content="User: How do I fix this?\n\nAssistant: Here's the solution...",
                metadata={"type": "turn", "sequence_index": 0},
                session_id="session-1",
            )
        ]

        mock_qdrant_wrapper.client.upsert = AsyncMock()  # type: ignore[method-assign]

        count = await turns_indexer.index_documents(documents)

        assert count == 1
        mock_qdrant_wrapper.client.upsert.assert_called_once()

        # Verify the point structure
        call_args = mock_qdrant_wrapper.client.upsert.call_args
        assert call_args.kwargs["collection_name"] == "test_turns"
        points = call_args.kwargs["points"]
        assert len(points) == 1

        point = points[0]
        assert point.id == "turn-1"
        assert "turn_dense" in point.vector
        assert "turn_sparse" in point.vector
        assert "turn_colbert" in point.vector
        # ColBERT vectors are list of lists
        assert isinstance(point.vector["turn_colbert"], list)
        assert point.payload["content"] == documents[0].content
        assert point.payload["session_id"] == "session-1"

    @pytest.mark.asyncio
    async def test_index_empty_documents(self, turns_indexer: TurnsIndexer) -> None:
        """Test indexing empty document list."""
        count = await turns_indexer.index_documents([])
        assert count == 0

    @pytest.mark.asyncio
    async def test_index_documents_without_colbert(
        self,
        mock_qdrant_wrapper: QdrantClientWrapper,
        mock_embedder_factory: EmbedderFactory,
    ) -> None:
        """Test indexing without ColBERT embeddings."""
        config = TurnsIndexerConfig(
            collection_name="test_turns",
            enable_colbert=False,
        )
        indexer = TurnsIndexer(mock_qdrant_wrapper, mock_embedder_factory, config)

        documents = [
            Document(
                id="turn-1",
                content="Test content",
                metadata={},
            )
        ]

        mock_qdrant_wrapper.client.upsert = AsyncMock()  # type: ignore[method-assign]

        count = await indexer.index_documents(documents)

        assert count == 1

        # Verify ColBERT vectors are not included
        call_args = mock_qdrant_wrapper.client.upsert.call_args
        points = call_args.kwargs["points"]
        point = points[0]
        assert "turn_colbert" not in point.vector


class TestTurnFinalizedConsumer:
    """Tests for TurnFinalizedConsumer."""

    @pytest.fixture
    def mock_turns_indexer(self) -> TurnsIndexer:
        """Create mock turns indexer."""
        indexer = MagicMock(spec=TurnsIndexer)
        indexer.index_documents = AsyncMock(return_value=1)
        return indexer

    def test_parse_turn_finalized_success(
        self,
        mock_turns_indexer: TurnsIndexer,
    ) -> None:
        """Test parsing a valid turn_finalized event."""
        consumer = TurnFinalizedConsumer(
            nats_client=MagicMock(),
            indexer=mock_turns_indexer,
        )

        event = {
            "id": "turn-123",
            "session_id": "session-456",
            "sequence_index": 2,
            "user_content": "How do I implement this feature?",
            "assistant_content": "Here's how you can implement it...",
            "reasoning_preview": "Let me think about this...",
            "tool_calls": ["Read", "Edit"],
            "files_touched": ["src/main.ts", "src/utils.ts"],
            "input_tokens": 100,
            "output_tokens": 500,
            "timestamp": 1234567890,
        }

        document = consumer._parse_turn_finalized(event)

        assert document is not None
        assert document.id == "turn-123"
        assert document.session_id == "session-456"
        assert "User: How do I implement" in document.content
        assert "Assistant: Here's how" in document.content
        assert "Reasoning: Let me think" in document.content
        assert document.metadata["type"] == "turn"
        assert document.metadata["sequence_index"] == 2
        assert document.metadata["tool_calls"] == ["Read", "Edit"]
        assert document.metadata["files_touched"] == ["src/main.ts", "src/utils.ts"]
        assert document.metadata["has_reasoning"] is True

    def test_parse_turn_finalized_minimal(
        self,
        mock_turns_indexer: TurnsIndexer,
    ) -> None:
        """Test parsing a minimal turn_finalized event."""
        consumer = TurnFinalizedConsumer(
            nats_client=MagicMock(),
            indexer=mock_turns_indexer,
        )

        event = {
            "id": "turn-123",
            "user_content": "Hello",
            "assistant_content": "Hi there!",
        }

        document = consumer._parse_turn_finalized(event)

        assert document is not None
        assert document.id == "turn-123"
        assert "User: Hello" in document.content
        assert "Assistant: Hi there!" in document.content

    def test_parse_turn_finalized_missing_id(
        self,
        mock_turns_indexer: TurnsIndexer,
    ) -> None:
        """Test parsing event without id returns None."""
        consumer = TurnFinalizedConsumer(
            nats_client=MagicMock(),
            indexer=mock_turns_indexer,
        )

        event = {
            "user_content": "Hello",
            "assistant_content": "Hi there!",
        }

        document = consumer._parse_turn_finalized(event)

        assert document is None

    def test_parse_turn_finalized_no_content(
        self,
        mock_turns_indexer: TurnsIndexer,
    ) -> None:
        """Test parsing event with no content returns None."""
        consumer = TurnFinalizedConsumer(
            nats_client=MagicMock(),
            indexer=mock_turns_indexer,
        )

        event = {
            "id": "turn-123",
            "user_content": "",
            "assistant_content": "",
        }

        document = consumer._parse_turn_finalized(event)

        assert document is None

    def test_parse_turn_finalized_code_detection(
        self,
        mock_turns_indexer: TurnsIndexer,
    ) -> None:
        """Test that has_code is set when content contains code blocks."""
        consumer = TurnFinalizedConsumer(
            nats_client=MagicMock(),
            indexer=mock_turns_indexer,
        )

        event = {
            "id": "turn-123",
            "user_content": "Show me example code",
            "assistant_content": "Here's an example:\n```python\nprint('hello')\n```",
        }

        document = consumer._parse_turn_finalized(event)

        assert document is not None
        assert document.metadata["has_code"] is True


class TestTurnsIndexerConfig:
    """Tests for TurnsIndexerConfig."""

    def test_default_config(self) -> None:
        """Test default configuration values."""
        config = TurnsIndexerConfig()

        assert config.collection_name == "engram_turns"
        assert config.dense_vector_name == "turn_dense"
        assert config.sparse_vector_name == "turn_sparse"
        assert config.colbert_vector_name == "turn_colbert"
        assert config.enable_colbert is True
        assert config.batch_size == 32

    def test_custom_config(self) -> None:
        """Test custom configuration values."""
        config = TurnsIndexerConfig(
            collection_name="custom_turns",
            dense_vector_name="custom_dense",
            enable_colbert=False,
        )

        assert config.collection_name == "custom_turns"
        assert config.dense_vector_name == "custom_dense"
        assert config.enable_colbert is False


class TestTurnFinalizedConsumerConfig:
    """Tests for TurnFinalizedConsumerConfig."""

    def test_default_config(self) -> None:
        """Test default configuration values."""
        config = TurnFinalizedConsumerConfig()

        assert config.topic == "memory.turn_finalized"
        assert config.group_id == "search-turns-indexer"
        assert config.heartbeat_interval_ms == 10000
        assert config.service_id  # Should have a generated ID
