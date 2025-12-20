"""Tests for the SessionAwareRetriever class."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from search.config import Settings
from search.retrieval import (
    SessionAwareRetriever,
    SessionRetrieverConfig,
)


@pytest.fixture
def mock_settings() -> Settings:
    """Create mock settings for testing."""
    return Settings(
        qdrant_url="http://localhost:6333",
        qdrant_collection="test_collection",
        embedder_device="cpu",
    )


@pytest.fixture
def mock_qdrant_client() -> MagicMock:
    """Create a mock Qdrant client."""
    client = MagicMock()
    client.client = AsyncMock()
    return client


@pytest.fixture
def mock_embedder_factory() -> MagicMock:
    """Create a mock embedder factory."""
    factory = MagicMock()

    # Mock text embedder
    text_embedder = MagicMock()
    text_embedder.embed = AsyncMock(return_value=[0.1] * 768)
    text_embedder.load = AsyncMock()
    factory.get_text_embedder.return_value = text_embedder

    return factory


@pytest.fixture
def mock_reranker_router() -> MagicMock:
    """Create a mock reranker router."""
    router = MagicMock()
    router.rerank = AsyncMock()
    return router


@pytest.fixture
def session_config() -> SessionRetrieverConfig:
    """Create session retriever config for testing."""
    return SessionRetrieverConfig(
        top_sessions=3,
        turns_per_session=2,
        final_top_k=5,
        session_collection="test_sessions",
        turn_collection="test_turns",
    )


@pytest.fixture
def retriever(
    mock_qdrant_client: MagicMock,
    mock_embedder_factory: MagicMock,
    mock_reranker_router: MagicMock,
    mock_settings: Settings,
    session_config: SessionRetrieverConfig,
) -> SessionAwareRetriever:
    """Create a SessionAwareRetriever with mocked dependencies."""
    return SessionAwareRetriever(
        qdrant_client=mock_qdrant_client,
        embedder_factory=mock_embedder_factory,
        settings=mock_settings,
        reranker_router=mock_reranker_router,
        config=session_config,
    )


class TestSessionAwareRetriever:
    """Tests for SessionAwareRetriever."""

    @pytest.mark.asyncio
    async def test_retrieve_sessions_stage_1(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test stage 1 session retrieval."""
        # Setup mock session results
        mock_session_1 = MagicMock()
        mock_session_1.id = "session-1"
        mock_session_1.score = 0.95
        mock_session_1.payload = {
            "session_id": "session-1",
            "summary": "Discussion about Docker",
            "topics": ["docker", "containers"],
            "entities": ["Docker", "Kubernetes"],
        }

        mock_session_2 = MagicMock()
        mock_session_2.id = "session-2"
        mock_session_2.score = 0.85
        mock_session_2.payload = {
            "session_id": "session-2",
            "summary": "Discussion about Python",
            "topics": ["python", "programming"],
            "entities": ["Python", "FastAPI"],
        }

        # Mock turn results
        mock_turn_1 = MagicMock()
        mock_turn_1.id = "turn-1"
        mock_turn_1.score = 0.92
        mock_turn_1.payload = {
            "content": "How to use Docker?",
            "session_id": "session-1",
        }

        mock_turn_2 = MagicMock()
        mock_turn_2.id = "turn-2"
        mock_turn_2.score = 0.88
        mock_turn_2.payload = {
            "content": "Docker best practices",
            "session_id": "session-1",
        }

        # Setup search responses
        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                [mock_session_1, mock_session_2],  # Stage 1: sessions
                [mock_turn_1, mock_turn_2],  # Stage 2: turns for session-1
                [],  # Stage 2: turns for session-2 (empty)
            ]
        )

        # Execute retrieval
        results = await retriever.retrieve("Docker containers")

        # Verify search was called for sessions
        assert mock_qdrant_client.client.search.call_count == 3

        # Verify first call was for sessions
        first_call = mock_qdrant_client.client.search.call_args_list[0]
        assert first_call.kwargs["collection_name"] == "test_sessions"

        # Verify results
        assert len(results) == 2
        assert results[0].session_id == "session-1"
        assert results[0].session_summary == "Discussion about Docker"

    @pytest.mark.asyncio
    async def test_retrieve_with_reranking(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test retrieval with reranking enabled."""
        # Setup mock session
        mock_session = MagicMock()
        mock_session.id = "session-1"
        mock_session.score = 0.95
        mock_session.payload = {
            "session_id": "session-1",
            "summary": "Docker discussion",
            "topics": ["docker"],
        }

        # Setup mock turns
        mock_turns = []
        for i in range(10):
            mock_turn = MagicMock()
            mock_turn.id = f"turn-{i}"
            mock_turn.score = 0.9 - (i * 0.05)
            mock_turn.payload = {
                "content": f"Turn content {i}",
                "session_id": "session-1",
            }
            mock_turns.append(mock_turn)

        # Mock search to return session and turns
        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                [mock_session],  # Stage 1: sessions
                mock_turns,  # Stage 2: turns
            ]
        )

        # Mock reranker to return top 5
        from search.rerankers.base import RankedResult

        mock_reranked = [
            RankedResult(text=f"Turn content {i}", score=0.95 - i * 0.05, original_index=i)
            for i in range(5)
        ]
        mock_reranker_router.rerank = AsyncMock(return_value=(mock_reranked, "fast", False))

        # Execute retrieval
        results = await retriever.retrieve("Docker")

        # Verify reranker was called
        assert mock_reranker_router.rerank.call_count == 1

        # Verify results are limited to final_top_k
        assert len(results) == 5
        assert all(r.reranker_score is not None for r in results)

    @pytest.mark.asyncio
    async def test_retrieve_no_sessions_found(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test retrieval when no sessions are found."""
        # Mock empty session results
        mock_qdrant_client.client.search = AsyncMock(return_value=[])

        # Execute retrieval
        results = await retriever.retrieve("nonexistent query")

        # Verify empty results
        assert len(results) == 0

    @pytest.mark.asyncio
    async def test_retrieve_parallel_turn_retrieval(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test parallel turn retrieval for multiple sessions."""
        # Ensure parallel retrieval is enabled
        retriever.config.parallel_turn_retrieval = True

        # Setup mock sessions
        mock_sessions = []
        for i in range(3):
            mock_session = MagicMock()
            mock_session.id = f"session-{i}"
            mock_session.score = 0.9 - i * 0.1
            mock_session.payload = {
                "session_id": f"session-{i}",
                "summary": f"Session {i} summary",
            }
            mock_sessions.append(mock_session)

        # Setup mock turns for each session
        mock_turn = MagicMock()
        mock_turn.id = "turn-1"
        mock_turn.score = 0.85
        mock_turn.payload = {"content": "Turn content", "session_id": "session-0"}

        # Mock search calls
        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                mock_sessions,  # Stage 1: sessions
                [mock_turn],  # Stage 2: turns for session-0
                [mock_turn],  # Stage 2: turns for session-1
                [mock_turn],  # Stage 2: turns for session-2
            ]
        )

        # Execute retrieval
        await retriever.retrieve("test query")

        # Verify all sessions were searched in parallel
        assert mock_qdrant_client.client.search.call_count == 4  # 1 session + 3 turn searches

    @pytest.mark.asyncio
    async def test_update_config(self, retriever: SessionAwareRetriever) -> None:
        """Test runtime configuration updates."""
        # Initial config values
        assert retriever.config.top_sessions == 3
        assert retriever.config.turns_per_session == 2

        # Update config
        retriever.update_config(top_sessions=5, turns_per_session=4)

        # Verify updates
        assert retriever.config.top_sessions == 5
        assert retriever.config.turns_per_session == 4

    @pytest.mark.asyncio
    async def test_preload(
        self,
        retriever: SessionAwareRetriever,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test preloading embedder."""
        # Execute preload
        await retriever.preload()

        # Verify text embedder was loaded
        text_embedder = mock_embedder_factory.get_text_embedder()
        text_embedder.load.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_config(
        self, retriever: SessionAwareRetriever, session_config: SessionRetrieverConfig
    ) -> None:
        """Test getting configuration."""
        config = retriever.get_config()

        assert config.top_sessions == session_config.top_sessions
        assert config.turns_per_session == session_config.turns_per_session
        assert config.final_top_k == session_config.final_top_k
