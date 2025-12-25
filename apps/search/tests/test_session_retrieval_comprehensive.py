"""Comprehensive tests for SessionAwareRetriever.

This test suite provides comprehensive coverage of SessionAwareRetriever functionality:
- Two-stage hierarchical retrieval (sessions then turns)
- Parallel and sequential turn retrieval
- Reranking integration
- Error handling and fallback scenarios
- Configuration management
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.config import Settings
from src.retrieval.session import (
    SessionAwareRetriever,
    SessionAwareSearchResult,
    SessionResult,
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


def create_mock_qdrant_result(
    result_id: str | int, score: float, payload: dict[str, Any]
) -> MagicMock:
    """Helper to create a mock Qdrant search result."""
    result = MagicMock()
    result.id = result_id
    result.score = score
    result.payload = payload
    return result


class TestSessionRetrieverConfig:
    """Test SessionRetrieverConfig validation and defaults."""

    def test_config_defaults(self) -> None:
        """Test that SessionRetrieverConfig has correct defaults."""
        config = SessionRetrieverConfig()
        assert config.top_sessions == 5
        assert config.turns_per_session == 3
        assert config.final_top_k == 10
        assert config.session_collection == "sessions"
        assert config.turn_collection == "engram_turns"
        assert config.session_vector_name == "text_dense"
        assert config.turn_vector_name == "text_dense"
        assert config.session_score_threshold == 0.3
        assert config.parallel_turn_retrieval is True

    def test_config_custom_values(self) -> None:
        """Test custom configuration values."""
        config = SessionRetrieverConfig(
            top_sessions=10,
            turns_per_session=5,
            final_top_k=20,
            session_collection="custom_sessions",
            turn_collection="custom_turns",
            session_vector_name="custom_dense",
            turn_vector_name="custom_dense",
            session_score_threshold=0.5,
            parallel_turn_retrieval=False,
        )
        assert config.top_sessions == 10
        assert config.turns_per_session == 5
        assert config.final_top_k == 20
        assert config.session_collection == "custom_sessions"
        assert config.turn_collection == "custom_turns"
        assert config.session_vector_name == "custom_dense"
        assert config.turn_vector_name == "custom_dense"
        assert config.session_score_threshold == 0.5
        assert config.parallel_turn_retrieval is False


class TestStage1SessionRetrieval:
    """Test stage 1 session retrieval."""

    @pytest.mark.asyncio
    async def test_retrieve_sessions_basic(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test basic session retrieval."""
        # Setup mock session results
        mock_sessions = [
            create_mock_qdrant_result(
                "session-1",
                0.95,
                {
                    "session_id": "session-1",
                    "summary": "Discussion about Docker",
                    "topics": ["docker", "containers"],
                    "entities": ["Docker", "Kubernetes"],
                },
            ),
            create_mock_qdrant_result(
                "session-2",
                0.85,
                {
                    "session_id": "session-2",
                    "summary": "Discussion about Python",
                    "topics": ["python", "programming"],
                    "entities": ["Python", "FastAPI"],
                },
            ),
        ]

        # Mock empty turn results
        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                mock_sessions,  # Stage 1: sessions
                [],  # Stage 2: turns for session-1
                [],  # Stage 2: turns for session-2
            ]
        )

        await retriever.retrieve("Docker containers")

        # Verify session search was called
        first_call = mock_qdrant_client.client.search.call_args_list[0]
        assert first_call.kwargs["collection_name"] == "test_sessions"
        assert first_call.kwargs["limit"] == 3  # top_sessions

    @pytest.mark.asyncio
    async def test_retrieve_sessions_score_threshold(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test session retrieval applies score threshold."""
        mock_qdrant_client.client.search = AsyncMock(return_value=[])

        await retriever.retrieve("test query")

        # Verify score threshold was passed
        call_args = mock_qdrant_client.client.search.call_args
        assert call_args.kwargs["score_threshold"] == retriever.config.session_score_threshold

    @pytest.mark.asyncio
    async def test_retrieve_no_sessions_found(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test retrieval when no sessions are found."""
        mock_qdrant_client.client.search = AsyncMock(return_value=[])

        results = await retriever.retrieve("nonexistent query")

        assert len(results) == 0
        # Should only call session search, not turn search
        assert mock_qdrant_client.client.search.call_count == 1

    @pytest.mark.asyncio
    async def test_retrieve_sessions_error_handling(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test error handling during session retrieval."""
        mock_qdrant_client.client.search = AsyncMock(side_effect=Exception("Qdrant error"))

        results = await retriever.retrieve("test query")

        # Should return empty results on error
        assert len(results) == 0


class TestStage2TurnRetrieval:
    """Test stage 2 turn retrieval."""

    @pytest.mark.asyncio
    async def test_retrieve_turns_basic(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test basic turn retrieval from matched sessions."""
        # Setup mock session
        mock_session = create_mock_qdrant_result(
            "session-1",
            0.95,
            {
                "session_id": "session-1",
                "summary": "Docker discussion",
                "topics": ["docker"],
            },
        )

        # Setup mock turns
        mock_turns = [
            create_mock_qdrant_result(
                "turn-1",
                0.92,
                {
                    "content": "How to use Docker?",
                    "session_id": "session-1",
                },
            ),
            create_mock_qdrant_result(
                "turn-2",
                0.88,
                {
                    "content": "Docker best practices",
                    "session_id": "session-1",
                },
            ),
        ]

        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                [mock_session],  # Stage 1: sessions
                mock_turns,  # Stage 2: turns
            ]
        )

        results = await retriever.retrieve("Docker containers")

        # Verify results
        assert len(results) == 2
        assert results[0].session_id == "session-1"
        assert results[0].session_summary == "Docker discussion"
        assert results[0].payload["content"] == "How to use Docker?"

    @pytest.mark.asyncio
    async def test_retrieve_turns_filters_by_session(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test turn retrieval filters by session_id."""
        mock_session = create_mock_qdrant_result(
            "session-1",
            0.95,
            {"session_id": "session-123", "summary": "test"},
        )

        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                [mock_session],  # Stage 1
                [],  # Stage 2
            ]
        )

        await retriever.retrieve("test query")

        # Verify turn search was filtered by session_id
        turn_call = mock_qdrant_client.client.search.call_args_list[1]
        query_filter = turn_call.kwargs["query_filter"]
        assert query_filter is not None

    @pytest.mark.asyncio
    async def test_retrieve_turns_limit_per_session(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test turn retrieval respects turns_per_session limit."""
        mock_session = create_mock_qdrant_result(
            "session-1", 0.95, {"session_id": "session-1", "summary": "test"}
        )

        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                [mock_session],
                [],
            ]
        )

        await retriever.retrieve("test query")

        # Verify turns_per_session limit was used
        turn_call = mock_qdrant_client.client.search.call_args_list[1]
        assert turn_call.kwargs["limit"] == retriever.config.turns_per_session

    @pytest.mark.asyncio
    async def test_retrieve_turns_no_turns_found(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test retrieval when sessions are found but no turns."""
        mock_session = create_mock_qdrant_result(
            "session-1", 0.95, {"session_id": "session-1", "summary": "test"}
        )

        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                [mock_session],  # Sessions found
                [],  # No turns
            ]
        )

        results = await retriever.retrieve("test query")

        assert len(results) == 0

    @pytest.mark.asyncio
    async def test_retrieve_turns_error_handling(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test error handling during turn retrieval."""
        mock_session = create_mock_qdrant_result(
            "session-1", 0.95, {"session_id": "session-1", "summary": "test"}
        )

        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                [mock_session],  # Sessions OK
                Exception("Turn retrieval failed"),  # Turn retrieval fails
            ]
        )

        results = await retriever.retrieve("test query")

        # Should handle error gracefully
        assert len(results) == 0


class TestParallelRetrieval:
    """Test parallel turn retrieval."""

    @pytest.mark.asyncio
    async def test_parallel_turn_retrieval(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test parallel turn retrieval for multiple sessions."""
        # Ensure parallel retrieval is enabled
        retriever.config.parallel_turn_retrieval = True

        # Setup mock sessions
        mock_sessions = [
            create_mock_qdrant_result(
                f"session-{i}",
                0.9 - i * 0.1,
                {"session_id": f"session-{i}", "summary": f"Session {i}"},
            )
            for i in range(3)
        ]

        # Setup mock turn
        mock_turn = create_mock_qdrant_result(
            "turn-1", 0.85, {"content": "Turn content", "session_id": "session-0"}
        )

        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                mock_sessions,  # Stage 1: sessions
                [mock_turn],  # Stage 2: turns for session-0
                [mock_turn],  # Stage 2: turns for session-1
                [mock_turn],  # Stage 2: turns for session-2
            ]
        )

        await retriever.retrieve("test query")

        # Verify all sessions were searched (1 session + 3 turn searches)
        assert mock_qdrant_client.client.search.call_count == 4

    @pytest.mark.asyncio
    async def test_sequential_turn_retrieval(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test sequential turn retrieval."""
        # Disable parallel retrieval
        retriever.config.parallel_turn_retrieval = False

        mock_sessions = [
            create_mock_qdrant_result(
                "session-1", 0.95, {"session_id": "session-1", "summary": "Session 1"}
            ),
            create_mock_qdrant_result(
                "session-2", 0.85, {"session_id": "session-2", "summary": "Session 2"}
            ),
        ]

        mock_turn = create_mock_qdrant_result(
            "turn-1", 0.85, {"content": "Turn", "session_id": "session-1"}
        )

        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                mock_sessions,  # Sessions
                [mock_turn],  # Turns for session-1
                [mock_turn],  # Turns for session-2
            ]
        )

        await retriever.retrieve("test query")

        # Sequential should still call all searches
        assert mock_qdrant_client.client.search.call_count == 3


class TestReranking:
    """Test reranking integration."""

    @pytest.mark.asyncio
    async def test_reranking_enabled(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test reranking is applied when results exceed final_top_k."""
        mock_session = create_mock_qdrant_result(
            "session-1", 0.95, {"session_id": "session-1", "summary": "Session"}
        )

        # Create more turns than final_top_k
        mock_turns = [
            create_mock_qdrant_result(
                f"turn-{i}", 0.9 - i * 0.05, {"content": f"Turn {i}", "session_id": "session-1"}
            )
            for i in range(10)
        ]

        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                [mock_session],
                mock_turns,
            ]
        )

        # Mock reranker
        from src.rerankers.base import RankedResult

        mock_reranked = [
            RankedResult(text=f"Turn {i}", score=0.95 - i * 0.05, original_index=i)
            for i in range(5)
        ]
        mock_reranker_router.rerank = AsyncMock(return_value=(mock_reranked, "fast", False))

        results = await retriever.retrieve("test query")

        # Verify reranker was called
        assert mock_reranker_router.rerank.call_count == 1
        assert len(results) == 5  # final_top_k

    @pytest.mark.asyncio
    async def test_reranking_preserves_session_context(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test reranking preserves session metadata."""
        mock_session = create_mock_qdrant_result(
            "session-1",
            0.95,
            {"session_id": "session-123", "summary": "Docker discussion"},
        )

        mock_turns = [
            create_mock_qdrant_result(
                f"turn-{i}", 0.9 - i * 0.1, {"content": f"Turn {i}", "session_id": "session-123"}
            )
            for i in range(10)
        ]

        mock_qdrant_client.client.search = AsyncMock(side_effect=[[mock_session], mock_turns])

        from src.rerankers.base import RankedResult

        mock_reranked = [RankedResult(text="Turn 0", score=0.98, original_index=0)]
        mock_reranker_router.rerank = AsyncMock(return_value=(mock_reranked, "fast", False))

        results = await retriever.retrieve("Docker")

        # Verify session context is preserved
        assert results[0].session_id == "session-123"
        assert results[0].session_summary == "Docker discussion"
        assert results[0].session_score == 0.95
        assert results[0].reranker_score == 0.98

    @pytest.mark.asyncio
    async def test_reranking_disabled_sorts_by_score(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test results are sorted by score when reranking is disabled."""
        # Disable reranker
        retriever.reranker_router = None

        mock_session = create_mock_qdrant_result(
            "session-1", 0.95, {"session_id": "session-1", "summary": "Session"}
        )

        # Turns with various scores
        mock_turns = [
            create_mock_qdrant_result(
                "turn-1", 0.5, {"content": "Low score", "session_id": "session-1"}
            ),
            create_mock_qdrant_result(
                "turn-2", 0.9, {"content": "High score", "session_id": "session-1"}
            ),
            create_mock_qdrant_result(
                "turn-3", 0.7, {"content": "Mid score", "session_id": "session-1"}
            ),
        ]

        mock_qdrant_client.client.search = AsyncMock(side_effect=[[mock_session], mock_turns])

        results = await retriever.retrieve("test query")

        # Should be sorted by score descending
        assert results[0].score == 0.9
        assert results[1].score == 0.7
        assert results[2].score == 0.5

    @pytest.mark.asyncio
    async def test_reranking_error_fallback(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test graceful degradation when reranking fails."""
        mock_session = create_mock_qdrant_result(
            "session-1", 0.95, {"session_id": "session-1", "summary": "Session"}
        )

        mock_turns = [
            create_mock_qdrant_result(
                f"turn-{i}", 0.9 - i * 0.1, {"content": f"Turn {i}", "session_id": "session-1"}
            )
            for i in range(10)
        ]

        mock_qdrant_client.client.search = AsyncMock(side_effect=[[mock_session], mock_turns])

        # Make reranker fail
        mock_reranker_router.rerank = AsyncMock(side_effect=Exception("Reranker failed"))

        results = await retriever.retrieve("test query")

        # Should fall back to sorted results
        assert len(results) == 5  # final_top_k
        # Should be sorted by score
        assert results[0].score >= results[1].score


class TestConfigManagement:
    """Test configuration management."""

    def test_get_config(
        self, retriever: SessionAwareRetriever, session_config: SessionRetrieverConfig
    ) -> None:
        """Test getting configuration."""
        config = retriever.get_config()

        assert config.top_sessions == session_config.top_sessions
        assert config.turns_per_session == session_config.turns_per_session
        assert config.final_top_k == session_config.final_top_k

    def test_update_config(self, retriever: SessionAwareRetriever) -> None:
        """Test runtime configuration updates."""
        # Initial config values
        assert retriever.config.top_sessions == 3
        assert retriever.config.turns_per_session == 2

        # Update config
        retriever.update_config(top_sessions=5, turns_per_session=4)

        # Verify updates
        assert retriever.config.top_sessions == 5
        assert retriever.config.turns_per_session == 4

    def test_update_config_partial(self, retriever: SessionAwareRetriever) -> None:
        """Test partial configuration updates."""
        original_turns = retriever.config.turns_per_session

        # Update only one field
        retriever.update_config(top_sessions=10)

        # Updated field changed
        assert retriever.config.top_sessions == 10
        # Other fields unchanged
        assert retriever.config.turns_per_session == original_turns


class TestPreloading:
    """Test embedder preloading."""

    @pytest.mark.asyncio
    async def test_preload(
        self,
        retriever: SessionAwareRetriever,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test preloading embedder."""
        await retriever.preload()

        # Verify text embedder was loaded
        text_embedder = mock_embedder_factory.get_text_embedder()
        text_embedder.load.assert_called_once()


class TestSessionResult:
    """Test SessionResult model."""

    def test_session_result_creation(self) -> None:
        """Test SessionResult creation and fields."""
        result = SessionResult(
            session_id="session-123",
            summary="Test session",
            score=0.95,
            topics=["topic1", "topic2"],
            entities=["Entity1", "Entity2"],
        )

        assert result.session_id == "session-123"
        assert result.summary == "Test session"
        assert result.score == 0.95
        assert result.topics == ["topic1", "topic2"]
        assert result.entities == ["Entity1", "Entity2"]

    def test_session_result_optional_fields(self) -> None:
        """Test SessionResult with optional fields omitted."""
        result = SessionResult(session_id="session-123", summary="Test", score=0.95)

        assert result.topics is None
        assert result.entities is None


class TestSessionAwareSearchResult:
    """Test SessionAwareSearchResult model."""

    def test_search_result_creation(self) -> None:
        """Test SessionAwareSearchResult creation."""
        result = SessionAwareSearchResult(
            id="turn-1",
            score=0.92,
            payload={"content": "test content"},
            session_id="session-123",
            session_summary="Session summary",
            session_score=0.95,
            rrf_score=0.88,
            reranker_score=0.97,
        )

        assert result.id == "turn-1"
        assert result.score == 0.92
        assert result.session_id == "session-123"
        assert result.session_summary == "Session summary"
        assert result.session_score == 0.95
        assert result.rrf_score == 0.88
        assert result.reranker_score == 0.97

    def test_search_result_optional_fields(self) -> None:
        """Test SessionAwareSearchResult with optional fields omitted."""
        result = SessionAwareSearchResult(
            id="turn-1", score=0.92, payload={"content": "test"}, session_id="session-123"
        )

        assert result.session_summary is None
        assert result.session_score is None
        assert result.rrf_score is None
        assert result.reranker_score is None


class TestRetrievalIntegration:
    """Test full retrieval pipeline integration."""

    @pytest.mark.asyncio
    async def test_full_pipeline(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test complete retrieval pipeline from query to results."""
        # Setup realistic mock data
        mock_sessions = [
            create_mock_qdrant_result(
                "session-1",
                0.95,
                {
                    "session_id": "session-1",
                    "summary": "Docker troubleshooting",
                    "topics": ["docker", "debugging"],
                },
            ),
            create_mock_qdrant_result(
                "session-2",
                0.85,
                {
                    "session_id": "session-2",
                    "summary": "Python async patterns",
                    "topics": ["python", "async"],
                },
            ),
        ]

        mock_turns_s1 = [
            create_mock_qdrant_result(
                "turn-1",
                0.93,
                {"content": "How to debug Docker containers?", "session_id": "session-1"},
            ),
            create_mock_qdrant_result(
                "turn-2",
                0.90,
                {"content": "Docker logs command", "session_id": "session-1"},
            ),
        ]

        mock_turns_s2 = [
            create_mock_qdrant_result(
                "turn-3",
                0.87,
                {"content": "Async context managers", "session_id": "session-2"},
            ),
            create_mock_qdrant_result(
                "turn-4",
                0.82,
                {"content": "asyncio.gather usage", "session_id": "session-2"},
            ),
        ]

        mock_qdrant_client.client.search = AsyncMock(
            side_effect=[
                mock_sessions,  # Stage 1
                mock_turns_s1,  # Stage 2: session-1
                mock_turns_s2,  # Stage 2: session-2
            ]
        )

        results = await retriever.retrieve("Docker debugging")

        # Verify we got results from both sessions
        assert len(results) == 4
        session_ids = {r.session_id for r in results}
        assert "session-1" in session_ids
        assert "session-2" in session_ids

        # Verify session context is attached
        docker_result = next(r for r in results if "Docker" in r.payload["content"])
        assert docker_result.session_summary == "Docker troubleshooting"

    @pytest.mark.asyncio
    async def test_empty_query_result(
        self,
        retriever: SessionAwareRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test handling of queries with no matches."""
        mock_qdrant_client.client.search = AsyncMock(return_value=[])

        results = await retriever.retrieve("completely unrelated query")

        assert len(results) == 0
