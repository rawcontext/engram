"""
Tests for retriever implementations.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from engram_benchmark.longmemeval.retriever import (
    ChromaRetriever,
    EngramRetriever,
    RetrievalResult,
    RetrievedContext,
)
from engram_benchmark.longmemeval.types import (
    ParsedInstance,
    ParsedSession,
    ParsedTurn,
    QuestionType,
)
from engram_benchmark.providers.embeddings import EmbeddingProvider
from engram_benchmark.providers.engram import EngramSearchClient, SearchResponse, SearchResult


@pytest.fixture
def sample_parsed_instance() -> ParsedInstance:
    """Create a sample parsed instance for testing."""
    return ParsedInstance(
        question_id="test_001",
        question_type=QuestionType.SINGLE_SESSION_USER,
        memory_ability="IE",
        question="What is the capital of France?",
        answer="Paris",
        question_date=datetime(2023, 4, 10, 23, 7),
        sessions=[
            ParsedSession(
                session_id="session_001",
                timestamp=datetime(2023, 4, 10, 17, 50),
                turns=[
                    ParsedTurn(
                        role="user",
                        content="I love Paris.",
                        has_answer=True,
                        sequence_index=0,
                    ),
                    ParsedTurn(
                        role="assistant",
                        content="Paris is beautiful!",
                        has_answer=False,
                        sequence_index=1,
                    ),
                    ParsedTurn(
                        role="user",
                        content="It's the capital of France.",
                        has_answer=True,
                        sequence_index=2,
                    ),
                ],
            )
        ],
        answer_session_ids=["session_001"],
        is_abstention=False,
    )


@pytest.fixture
def mock_embedder() -> MagicMock:
    """Mock EmbeddingProvider."""
    embedder = MagicMock(spec=EmbeddingProvider)
    embedder.load = AsyncMock()
    embedder.embed = AsyncMock(return_value=[0.1] * 384)
    embedder.embed_batch = AsyncMock(return_value=[[0.1] * 384, [0.2] * 384, [0.3] * 384])
    return embedder


@pytest.fixture
def mock_chroma_collection() -> MagicMock:
    """Mock ChromaDB collection."""
    collection = MagicMock()

    # Mock query results
    collection.query.return_value = {
        "ids": [["test_001_session_001_0", "test_001_session_001_2"]],
        "documents": [["User: I love Paris.", "User: It's the capital of France."]],
        "metadatas": [
            [
                {
                    "question_id": "test_001",
                    "session_id": "session_001",
                    "turn_index": 0,
                    "role": "user",
                    "has_answer": True,
                    "timestamp": "2023-04-10T17:50:00",
                },
                {
                    "question_id": "test_001",
                    "session_id": "session_001",
                    "turn_index": 2,
                    "role": "user",
                    "has_answer": True,
                    "timestamp": "2023-04-10T17:50:00",
                },
            ]
        ],
        "distances": [[0.15, 0.25]],
    }

    collection.add = MagicMock()
    return collection


@pytest.fixture
def mock_chroma_client(mock_chroma_collection: MagicMock) -> MagicMock:
    """Mock ChromaDB client."""
    client = MagicMock()
    client.get_or_create_collection.return_value = mock_chroma_collection
    client.create_collection.return_value = mock_chroma_collection
    client.delete_collection = MagicMock()
    return client


class TestChromaRetriever:
    """Tests for ChromaRetriever."""

    @pytest.mark.asyncio
    async def test_initialization(self, mock_embedder: MagicMock) -> None:
        """Test retriever initialization."""
        retriever = ChromaRetriever(
            embedder=mock_embedder,
            collection_name="test_collection",
            distance_metric="cosine",
        )

        assert retriever.collection_name == "test_collection"
        assert retriever.distance_metric == "cosine"
        assert not retriever._loaded

    @pytest.mark.asyncio
    async def test_load(self, mock_embedder: MagicMock, mock_chroma_client: MagicMock) -> None:
        """Test loading the retriever."""
        with patch(
            "engram_benchmark.longmemeval.retriever.chromadb.Client",
            return_value=mock_chroma_client,
        ):
            retriever = ChromaRetriever(embedder=mock_embedder)
            await retriever.load()

            assert retriever._loaded
            mock_embedder.load.assert_called_once()
            mock_chroma_client.get_or_create_collection.assert_called_once()

    @pytest.mark.asyncio
    async def test_load_only_once(
        self, mock_embedder: MagicMock, mock_chroma_client: MagicMock
    ) -> None:
        """Test that load only initializes once."""
        with patch(
            "engram_benchmark.longmemeval.retriever.chromadb.Client",
            return_value=mock_chroma_client,
        ):
            retriever = ChromaRetriever(embedder=mock_embedder)

            # Load twice
            await retriever.load()
            await retriever.load()

            # Should only load embedder and create client once
            assert mock_embedder.load.call_count == 1
            assert mock_chroma_client.get_or_create_collection.call_count == 1

    @pytest.mark.asyncio
    async def test_index_instance(
        self,
        mock_embedder: MagicMock,
        mock_chroma_client: MagicMock,
        mock_chroma_collection: MagicMock,
        sample_parsed_instance: ParsedInstance,
    ) -> None:
        """Test indexing an instance."""
        with patch(
            "engram_benchmark.longmemeval.retriever.chromadb.Client",
            return_value=mock_chroma_client,
        ):
            retriever = ChromaRetriever(embedder=mock_embedder)
            await retriever.index_instance(sample_parsed_instance)

            # Verify embedder was called with batch
            mock_embedder.embed_batch.assert_called_once()
            texts = mock_embedder.embed_batch.call_args[0][0]
            assert len(texts) == 3  # 3 turns in sample instance

            # Verify collection.add was called
            mock_chroma_collection.add.assert_called_once()
            call_args = mock_chroma_collection.add.call_args
            assert len(call_args[1]["documents"]) == 3
            assert len(call_args[1]["ids"]) == 3
            assert len(call_args[1]["metadatas"]) == 3

    @pytest.mark.asyncio
    async def test_retrieve(
        self,
        mock_embedder: MagicMock,
        mock_chroma_client: MagicMock,
        mock_chroma_collection: MagicMock,
        sample_parsed_instance: ParsedInstance,
    ) -> None:
        """Test retrieving contexts."""
        with patch(
            "engram_benchmark.longmemeval.retriever.chromadb.Client",
            return_value=mock_chroma_client,
        ):
            retriever = ChromaRetriever(embedder=mock_embedder)
            result = await retriever.retrieve(sample_parsed_instance, top_k=5)

            assert isinstance(result, RetrievalResult)
            assert result.question_id == "test_001"
            assert len(result.contexts) == 2
            assert result.total_retrieved == 2

            # Check first context
            context = result.contexts[0]
            assert isinstance(context, RetrievedContext)
            assert context.content == "User: I love Paris."
            assert context.session_id == "session_001"
            assert context.has_answer is True
            assert 0.0 <= context.score <= 1.0

            # Verify query was called
            mock_chroma_collection.query.assert_called_once()

    @pytest.mark.asyncio
    async def test_retrieve_calculates_recall(
        self,
        mock_embedder: MagicMock,
        mock_chroma_client: MagicMock,
        sample_parsed_instance: ParsedInstance,
    ) -> None:
        """Test that retrieve calculates turn and session recall."""
        with patch(
            "engram_benchmark.longmemeval.retriever.chromadb.Client",
            return_value=mock_chroma_client,
        ):
            retriever = ChromaRetriever(embedder=mock_embedder)
            result = await retriever.retrieve(sample_parsed_instance, top_k=5)

            # Sample instance has 2 answer turns in 1 session
            # Mock returns 2 answer turns from 1 session
            assert result.turn_recall == 1.0  # 2/2
            assert result.session_recall == 1.0  # 1/1

    @pytest.mark.asyncio
    async def test_clear_collection(
        self, mock_embedder: MagicMock, mock_chroma_client: MagicMock
    ) -> None:
        """Test clearing the collection."""
        with patch(
            "engram_benchmark.longmemeval.retriever.chromadb.Client",
            return_value=mock_chroma_client,
        ):
            retriever = ChromaRetriever(embedder=mock_embedder)
            await retriever.load()
            await retriever.clear()

            mock_chroma_client.delete_collection.assert_called_once()
            mock_chroma_client.create_collection.assert_called_once()


class TestEngramRetriever:
    """Tests for EngramRetriever."""

    @pytest.fixture
    def mock_search_client(self) -> MagicMock:
        """Mock EngramSearchClient."""
        client = MagicMock(spec=EngramSearchClient)

        # Mock search response
        client.search = AsyncMock(
            return_value=SearchResponse(
                results=[
                    SearchResult(
                        id="result_1",
                        score=0.95,
                        rrf_score=0.92,
                        reranker_score=0.98,
                        rerank_tier="accurate",
                        payload={
                            "content": "User: I love Paris.",
                            "session_id": "session_001",
                            "turn_index": 0,
                            "has_answer": True,
                        },
                        degraded=False,
                    ),
                    SearchResult(
                        id="result_2",
                        score=0.87,
                        rrf_score=None,
                        reranker_score=None,
                        rerank_tier=None,
                        payload={
                            "content": "User: It's the capital of France.",
                            "session_id": "session_001",
                            "turn_index": 2,
                            "has_answer": True,
                        },
                        degraded=False,
                    ),
                ],
                total=2,
                took_ms=125,
            )
        )

        return client

    def test_initialization(self, mock_search_client: MagicMock) -> None:
        """Test retriever initialization."""
        retriever = EngramRetriever(
            client=mock_search_client,
            strategy="hybrid",
            rerank=True,
            rerank_tier="accurate",
        )

        assert retriever.strategy == "hybrid"
        assert retriever.rerank is True
        assert retriever.rerank_tier == "accurate"

    @pytest.mark.asyncio
    async def test_retrieve(
        self,
        mock_search_client: MagicMock,
        sample_parsed_instance: ParsedInstance,
    ) -> None:
        """Test retrieving contexts via Engram service."""
        retriever = EngramRetriever(
            client=mock_search_client,
            strategy="hybrid",
            rerank=True,
        )

        result = await retriever.retrieve(sample_parsed_instance, top_k=5)

        assert isinstance(result, RetrievalResult)
        assert result.question_id == "test_001"
        assert len(result.contexts) == 2
        assert result.total_retrieved == 2

        # Check first context
        context = result.contexts[0]
        assert context.content == "User: I love Paris."
        assert context.score == 0.98  # Should use reranker score
        assert context.has_answer is True

        # Verify search was called with correct parameters
        mock_search_client.search.assert_called_once()
        call_args = mock_search_client.search.call_args
        assert call_args[1]["text"] == "What is the capital of France?"
        assert call_args[1]["limit"] == 5
        assert call_args[1]["strategy"] == "hybrid"
        assert call_args[1]["rerank"] is True

    @pytest.mark.asyncio
    async def test_retrieve_uses_primary_score_when_no_reranker(
        self,
        mock_search_client: MagicMock,
        sample_parsed_instance: ParsedInstance,
    ) -> None:
        """Test that primary score is used when reranker score is None."""
        # Modify mock to return results without reranker scores
        mock_search_client.search = AsyncMock(
            return_value=SearchResponse(
                results=[
                    SearchResult(
                        id="result_1",
                        score=0.95,
                        rrf_score=None,
                        reranker_score=None,
                        rerank_tier=None,
                        payload={
                            "content": "Test content",
                            "session_id": "session_001",
                            "turn_index": 0,
                            "has_answer": False,
                        },
                        degraded=False,
                    ),
                ],
                total=1,
                took_ms=100,
            )
        )

        retriever = EngramRetriever(client=mock_search_client)
        result = await retriever.retrieve(sample_parsed_instance, top_k=5)

        # Should use primary score
        assert result.contexts[0].score == 0.95

    @pytest.mark.asyncio
    async def test_retrieve_calculates_recall(
        self,
        mock_search_client: MagicMock,
        sample_parsed_instance: ParsedInstance,
    ) -> None:
        """Test that retrieve calculates recall metrics."""
        retriever = EngramRetriever(client=mock_search_client)
        result = await retriever.retrieve(sample_parsed_instance, top_k=5)

        # Sample instance has 2 answer turns in 1 session
        # Mock returns 2 answer turns from 1 session
        assert result.turn_recall == 1.0  # 2/2
        assert result.session_recall == 1.0  # 1/1
