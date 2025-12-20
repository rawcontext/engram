"""
Retrieval interface for LongMemEval benchmark.

Provides retrieval implementations for:
- In-memory ChromaDB for testing and oracle evaluation
- Engram search-py service for production retrieval
- Configurable embedding models
- Retrieval metrics tracking
"""

import logging
from typing import Any, Literal

import chromadb  # type: ignore
from chromadb.config import Settings  # type: ignore
from pydantic import BaseModel, Field

from engram_benchmark.longmemeval.types import ParsedInstance
from engram_benchmark.providers.embeddings import EmbeddingProvider
from engram_benchmark.providers.engram import EngramSearchClient

logger = logging.getLogger(__name__)


class RetrievedContext(BaseModel):
    """A single retrieved context with metadata."""

    content: str
    score: float
    session_id: str
    turn_index: int
    has_answer: bool = False


class RetrievalResult(BaseModel):
    """Result from retrieval operation."""

    question_id: str
    contexts: list[RetrievedContext]
    total_retrieved: int = Field(ge=0)
    turn_recall: float = Field(ge=0.0, le=1.0, description="Fraction of evidence turns retrieved")
    session_recall: float = Field(
        ge=0.0, le=1.0, description="Fraction of evidence sessions retrieved"
    )


class BaseRetriever:
    """
    Base retriever interface.

    All retriever implementations should inherit from this and implement
    the retrieve() method.
    """

    async def retrieve(
        self,
        instance: ParsedInstance,
        top_k: int = 10,
    ) -> RetrievalResult:
        """
        Retrieve relevant contexts for a question.

        Args:
            instance: Parsed instance with question and metadata
            top_k: Number of contexts to retrieve

        Returns:
            RetrievalResult with contexts and metrics
        """
        raise NotImplementedError


class ChromaRetriever(BaseRetriever):
    """
    In-memory ChromaDB retriever for testing and oracle evaluation.

    Examples:
        >>> embedder = EmbeddingProvider(model_name="BAAI/bge-base-en-v1.5")
        >>> retriever = ChromaRetriever(embedder=embedder)
        >>> await retriever.load()
        >>> await retriever.index_instance(instance)
        >>> result = await retriever.retrieve(instance, top_k=5)
        >>> len(result.contexts)
        5
    """

    def __init__(
        self,
        embedder: EmbeddingProvider,
        collection_name: str = "longmemeval",
        distance_metric: Literal["cosine", "l2", "ip"] = "cosine",
    ) -> None:
        """
        Initialize ChromaDB retriever.

        Args:
            embedder: Embedding provider for vectorization
            collection_name: Name of the Chroma collection
            distance_metric: Distance metric (cosine, l2, ip)
        """
        self.embedder = embedder
        self.collection_name = collection_name
        self.distance_metric = distance_metric
        self._client: chromadb.Client | None = None
        self._collection: Any = None
        self._loaded = False

        logger.info(
            f"Initialized ChromaRetriever with collection='{collection_name}', "
            f"metric='{distance_metric}'"
        )

    async def load(self) -> None:
        """Initialize ChromaDB client and collection."""
        if self._loaded:
            logger.debug("ChromaRetriever already loaded")
            return

        # Load embedder first
        await self.embedder.load()

        # Create in-memory Chroma client
        self._client = chromadb.Client(
            Settings(
                is_persistent=False,
                anonymized_telemetry=False,
            )
        )

        # Create or get collection
        self._collection = self._client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": self.distance_metric},
        )

        self._loaded = True
        logger.info("ChromaRetriever loaded successfully")

    async def index_instance(self, instance: ParsedInstance) -> None:
        """
        Index all turns from an instance into ChromaDB.

        Args:
            instance: Parsed instance with sessions to index
        """
        if not self._loaded:
            await self.load()

        documents = []
        metadatas = []
        ids = []

        # Flatten all turns from all sessions
        for session in instance.sessions:
            for turn in session.turns:
                doc_id = f"{instance.question_id}_{session.session_id}_{turn.sequence_index}"
                content = f"{turn.role.capitalize()}: {turn.content}"

                documents.append(content)
                metadatas.append(
                    {
                        "question_id": instance.question_id,
                        "session_id": session.session_id,
                        "turn_index": turn.sequence_index,
                        "role": turn.role,
                        "has_answer": turn.has_answer,
                        "timestamp": session.timestamp.isoformat(),
                    }
                )
                ids.append(doc_id)

        # Embed and add to collection
        if documents:
            embeddings = await self.embedder.embed_batch(documents)

            self._collection.add(
                documents=documents,
                embeddings=embeddings,
                metadatas=metadatas,
                ids=ids,
            )

            logger.debug(f"Indexed {len(documents)} turns for instance {instance.question_id}")

    async def retrieve(
        self,
        instance: ParsedInstance,
        top_k: int = 10,
    ) -> RetrievalResult:
        """
        Retrieve relevant contexts for a question using semantic search.

        Args:
            instance: Parsed instance with question
            top_k: Number of contexts to retrieve

        Returns:
            RetrievalResult with contexts and metrics
        """
        if not self._loaded:
            await self.load()

        # Embed the question
        question_embedding = await self.embedder.embed(instance.question)

        # Query ChromaDB
        results = self._collection.query(
            query_embeddings=[question_embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )

        # Parse results
        contexts: list[RetrievedContext] = []
        retrieved_session_ids = set()
        retrieved_answer_turns = 0
        total_answer_turns = 0

        # Count total evidence turns in the instance
        for session in instance.sessions:
            for turn in session.turns:
                if turn.has_answer:
                    total_answer_turns += 1

        # Process retrieved results
        if results["ids"] and results["ids"][0]:
            documents = results["documents"][0]
            metadatas = results["metadatas"][0] if results["metadatas"] else []
            distances = results["distances"][0] if results["distances"] else []

            for doc, meta, distance in zip(documents, metadatas, distances, strict=True):
                # Convert distance to score (cosine similarity)
                score = 1.0 - distance if self.distance_metric == "cosine" else distance

                has_answer = meta.get("has_answer", False)
                session_id = meta.get("session_id", "")

                if has_answer:
                    retrieved_answer_turns += 1
                    retrieved_session_ids.add(session_id)

                contexts.append(
                    RetrievedContext(
                        content=doc,
                        score=score,
                        session_id=session_id,
                        turn_index=meta.get("turn_index", 0),
                        has_answer=has_answer,
                    )
                )

        # Calculate recall metrics
        turn_recall = retrieved_answer_turns / total_answer_turns if total_answer_turns > 0 else 0.0

        total_answer_sessions = len(set(instance.answer_session_ids))
        session_recall = (
            len(retrieved_session_ids) / total_answer_sessions if total_answer_sessions > 0 else 0.0
        )

        logger.debug(
            f"Retrieved {len(contexts)} contexts for {instance.question_id}, "
            f"turn_recall={turn_recall:.2f}, session_recall={session_recall:.2f}"
        )

        return RetrievalResult(
            question_id=instance.question_id,
            contexts=contexts,
            total_retrieved=len(contexts),
            turn_recall=turn_recall,
            session_recall=session_recall,
        )

    async def clear(self) -> None:
        """Clear the collection."""
        if self._collection is not None:
            self._client.delete_collection(name=self.collection_name)
            self._collection = self._client.create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": self.distance_metric},
            )
            logger.debug("ChromaDB collection cleared")


class EngramRetriever(BaseRetriever):
    """
    Engram search-py service retriever for production evaluation.

    Uses the Engram search service with hybrid search and reranking.

    Examples:
        >>> client = EngramSearchClient(base_url="http://localhost:5002")
        >>> retriever = EngramRetriever(client=client)
        >>> result = await retriever.retrieve(instance, top_k=5)
        >>> len(result.contexts)
        5
    """

    def __init__(
        self,
        client: EngramSearchClient,
        strategy: Literal["hybrid", "dense", "sparse"] = "hybrid",
        rerank: bool = True,
        rerank_tier: Literal["fast", "accurate", "code", "llm"] = "accurate",
    ) -> None:
        """
        Initialize Engram retriever.

        Args:
            client: Engram search client
            strategy: Search strategy (hybrid, dense, sparse)
            rerank: Whether to apply reranking
            rerank_tier: Reranking tier (fast, accurate, code, llm)
        """
        self.client = client
        self.strategy = strategy
        self.rerank = rerank
        self.rerank_tier = rerank_tier

        logger.info(
            f"Initialized EngramRetriever with strategy='{strategy}', "
            f"rerank={rerank}, tier='{rerank_tier}'"
        )

    async def retrieve(
        self,
        instance: ParsedInstance,
        top_k: int = 10,
    ) -> RetrievalResult:
        """
        Retrieve relevant contexts using Engram search service.

        Args:
            instance: Parsed instance with question
            top_k: Number of contexts to retrieve

        Returns:
            RetrievalResult with contexts and metrics
        """
        # Execute search via Engram service
        response = await self.client.search(
            text=instance.question,
            limit=top_k,
            strategy=self.strategy,
            rerank=self.rerank,
            rerank_tier=self.rerank_tier,
        )

        # Parse results into contexts
        contexts: list[RetrievedContext] = []
        retrieved_session_ids = set()
        retrieved_answer_turns = 0
        total_answer_turns = 0

        # Count total evidence turns
        for session in instance.sessions:
            for turn in session.turns:
                if turn.has_answer:
                    total_answer_turns += 1

        # Process search results
        for result in response.results:
            # Extract metadata from payload
            session_id = result.payload.get("session_id", "")
            turn_index = result.payload.get("turn_index", 0)
            has_answer = result.payload.get("has_answer", False)
            content = result.payload.get("content", "")

            # Use reranker score if available, otherwise use primary score
            score = result.reranker_score if result.reranker_score is not None else result.score

            if has_answer:
                retrieved_answer_turns += 1
                retrieved_session_ids.add(session_id)

            contexts.append(
                RetrievedContext(
                    content=content,
                    score=score,
                    session_id=session_id,
                    turn_index=turn_index,
                    has_answer=has_answer,
                )
            )

        # Calculate recall metrics
        turn_recall = retrieved_answer_turns / total_answer_turns if total_answer_turns > 0 else 0.0

        total_answer_sessions = len(set(instance.answer_session_ids))
        session_recall = (
            len(retrieved_session_ids) / total_answer_sessions if total_answer_sessions > 0 else 0.0
        )

        logger.debug(
            f"Retrieved {len(contexts)} contexts for {instance.question_id}, "
            f"turn_recall={turn_recall:.2f}, session_recall={session_recall:.2f}"
        )

        return RetrievalResult(
            question_id=instance.question_id,
            contexts=contexts,
            total_retrieved=len(contexts),
            turn_recall=turn_recall,
            session_recall=session_recall,
        )
