"""Search quality benchmark for comparing fragment-level vs turn-level retrieval.

Measures:
- Average retrieval scores
- Reranking success rate (non-zero reranker scores)
- Relevant results in top-5
- Search latency
- Index size efficiency
"""

import logging
import time
from dataclasses import dataclass

from pydantic import BaseModel, Field

from src.clients.qdrant import QdrantClientWrapper
from src.config import Settings
from src.embedders.factory import EmbedderFactory
from src.retrieval.retriever import SearchRetriever
from src.retrieval.types import SearchResultItem

logger = logging.getLogger(__name__)


# Default test queries for evaluation
DEFAULT_TEST_QUERIES = [
    "How do I implement authentication?",
    "Fix the bug in the API endpoint",
    "Add error handling to the function",
    "What files were modified recently?",
    "Explain the codebase architecture",
    "How to run tests in this project?",
    "Database connection configuration",
    "API rate limiting implementation",
    "File upload functionality",
    "User session management",
]


@dataclass
class SearchQualityMetrics:
    """Metrics for search quality evaluation."""

    # Core metrics
    avg_retrieval_score: float = 0.0
    """Average similarity score across all results."""

    reranking_success_rate: float = 0.0
    """Percentage of results with non-zero reranker scores."""

    relevant_in_top_5: float = 0.0
    """Average number of relevant results in top 5."""

    # Score distribution
    min_score: float = 0.0
    max_score: float = 0.0
    score_std_dev: float = 0.0

    # Latency
    avg_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0

    # Index stats
    document_count: int = 0
    avg_content_length: int = 0

    # Per-query breakdown
    query_count: int = 0
    queries_with_results: int = 0
    total_results: int = 0


@dataclass
class CollectionComparison:
    """Comparison results between two collections."""

    fragment_metrics: SearchQualityMetrics
    turn_metrics: SearchQualityMetrics

    # Improvement metrics
    score_improvement: float = 0.0
    """Percentage improvement in avg retrieval score."""

    reranking_improvement: float = 0.0
    """Percentage improvement in reranking success rate."""

    latency_difference_ms: float = 0.0
    """Latency difference (turn - fragment) in ms."""

    summary: str = ""
    """Human-readable summary of comparison."""


class BenchmarkConfig(BaseModel):
    """Configuration for search quality benchmark."""

    fragment_collection: str = Field(
        default="engram_memory", description="Fragment-level collection name"
    )
    turn_collection: str = Field(
        default="engram_turns", description="Turn-level collection name"
    )
    test_queries: list[str] = Field(
        default_factory=lambda: DEFAULT_TEST_QUERIES,
        description="Test queries for evaluation",
    )
    limit: int = Field(default=10, description="Number of results per query")
    min_score_threshold: float = Field(
        default=0.1, description="Minimum score to consider a result relevant"
    )
    enable_reranking: bool = Field(default=True, description="Enable reranking in tests")
    rerank_tier: str = Field(default="fast", description="Reranker tier to use")


class SearchQualityBenchmark:
    """Benchmark for comparing search quality between collections.

    Runs test queries against fragment-level (engram_memory) and turn-level
    (engram_turns) collections and compares retrieval quality metrics.

    Example:
        >>> benchmark = SearchQualityBenchmark(settings, qdrant, embedders)
        >>> comparison = await benchmark.run_comparison()
        >>> print(f"Score improvement: {comparison.score_improvement:.1%}")
    """

    def __init__(
        self,
        settings: Settings,
        qdrant_client: QdrantClientWrapper,
        embedder_factory: EmbedderFactory,
        config: BenchmarkConfig | None = None,
    ) -> None:
        """Initialize the benchmark.

        Args:
            settings: Application settings.
            qdrant_client: Qdrant client wrapper.
            embedder_factory: Factory for embedder instances.
            config: Benchmark configuration.
        """
        self.settings = settings
        self.qdrant = qdrant_client
        self.embedders = embedder_factory
        self.config = config or BenchmarkConfig()
        self._retriever: SearchRetriever | None = None

    async def _get_retriever(self) -> SearchRetriever:
        """Get or create retriever instance."""
        if self._retriever is None:
            self._retriever = SearchRetriever(
                qdrant_client=self.qdrant,
                embedder_factory=self.embedders,
            )
        return self._retriever

    async def evaluate_collection(
        self,
        collection_name: str,
    ) -> SearchQualityMetrics:
        """Evaluate search quality for a single collection.

        Args:
            collection_name: Name of the collection to evaluate.

        Returns:
            SearchQualityMetrics for the collection.
        """
        retriever = await self._get_retriever()
        metrics = SearchQualityMetrics()

        all_scores: list[float] = []
        all_latencies: list[float] = []
        rerank_successes = 0
        relevant_count = 0
        total_content_length = 0

        for query in self.config.test_queries:
            start_time = time.perf_counter()

            try:
                # Run search on the specified collection
                results = await self._search_collection(
                    retriever, collection_name, query
                )
                latency_ms = (time.perf_counter() - start_time) * 1000
                all_latencies.append(latency_ms)

                if results:
                    metrics.queries_with_results += 1
                    metrics.total_results += len(results)

                    for result in results:
                        score = result.score
                        all_scores.append(score)

                        # Track content length from payload
                        content = result.payload.get("content", "")
                        if content:
                            total_content_length += len(content)

                        # Check if relevant (above threshold)
                        if score >= self.config.min_score_threshold:
                            relevant_count += 1

                        # Check reranking success (has rerank_score)
                        if (
                            hasattr(result, "rerank_score")
                            and result.rerank_score
                            and result.rerank_score > 0
                        ):
                            rerank_successes += 1

                    # Count relevant in top 5
                    top_5 = results[: min(5, len(results))]
                    top_5_relevant = sum(
                        1 for r in top_5 if r.score >= self.config.min_score_threshold
                    )
                    metrics.relevant_in_top_5 += top_5_relevant

            except Exception as e:
                logger.warning(f"Error evaluating query '{query}': {e}")
                continue

            metrics.query_count += 1

        # Compute aggregate metrics
        if all_scores:
            import statistics

            metrics.avg_retrieval_score = statistics.mean(all_scores)
            metrics.min_score = min(all_scores)
            metrics.max_score = max(all_scores)
            if len(all_scores) > 1:
                metrics.score_std_dev = statistics.stdev(all_scores)

        if all_latencies:
            import statistics

            metrics.avg_latency_ms = statistics.mean(all_latencies)
            sorted_latencies = sorted(all_latencies)
            p95_index = int(len(sorted_latencies) * 0.95)
            metrics.p95_latency_ms = sorted_latencies[min(p95_index, len(sorted_latencies) - 1)]

        if metrics.total_results > 0:
            metrics.reranking_success_rate = rerank_successes / metrics.total_results
            metrics.avg_content_length = total_content_length // metrics.total_results

        if metrics.query_count > 0:
            metrics.relevant_in_top_5 /= metrics.query_count

        # Get collection stats
        try:
            collection_info = await self.qdrant.client.get_collection(collection_name)
            metrics.document_count = collection_info.points_count
        except Exception:
            pass

        return metrics

    async def _search_collection(
        self,
        retriever: SearchRetriever,
        collection_name: str,
        query: str,
    ) -> list[SearchResultItem]:
        """Execute search on a specific collection.

        Args:
            retriever: Search retriever instance.
            collection_name: Collection to search.
            query: Search query.

        Returns:
            List of search results.
        """
        # Use collection-specific search based on name
        if collection_name == self.config.turn_collection:
            return await retriever.search_turns(
                query=query,
                strategy="hybrid",
                limit=self.config.limit,
            )
        else:
            # Use standard search for fragment collection
            return await retriever.search(
                query=query,
                strategy="hybrid",
                limit=self.config.limit,
                rerank=self.config.enable_reranking,
                rerank_tier=self.config.rerank_tier,
            )

    async def run_comparison(self) -> CollectionComparison:
        """Run comparison between fragment and turn collections.

        Returns:
            CollectionComparison with metrics for both collections.
        """
        logger.info("Starting search quality benchmark...")

        # Evaluate fragment collection
        logger.info(f"Evaluating fragment collection: {self.config.fragment_collection}")
        fragment_metrics = await self.evaluate_collection(self.config.fragment_collection)

        # Evaluate turn collection
        logger.info(f"Evaluating turn collection: {self.config.turn_collection}")
        turn_metrics = await self.evaluate_collection(self.config.turn_collection)

        # Compute improvements
        score_improvement = 0.0
        if fragment_metrics.avg_retrieval_score > 0:
            score_improvement = (
                (turn_metrics.avg_retrieval_score - fragment_metrics.avg_retrieval_score)
                / fragment_metrics.avg_retrieval_score
            )

        reranking_improvement = 0.0
        if fragment_metrics.reranking_success_rate > 0:
            reranking_improvement = (
                turn_metrics.reranking_success_rate - fragment_metrics.reranking_success_rate
            ) / fragment_metrics.reranking_success_rate

        latency_diff = turn_metrics.avg_latency_ms - fragment_metrics.avg_latency_ms

        # Build summary
        summary = self._build_summary(
            fragment_metrics, turn_metrics, score_improvement, reranking_improvement
        )

        return CollectionComparison(
            fragment_metrics=fragment_metrics,
            turn_metrics=turn_metrics,
            score_improvement=score_improvement,
            reranking_improvement=reranking_improvement,
            latency_difference_ms=latency_diff,
            summary=summary,
        )

    def _build_summary(
        self,
        fragment: SearchQualityMetrics,
        turn: SearchQualityMetrics,
        score_imp: float,
        rerank_imp: float,
    ) -> str:
        """Build human-readable summary of comparison."""
        lines = [
            "=== Search Quality Benchmark Results ===",
            "",
            "Fragment Collection (engram_memory):",
            f"  - Avg Score: {fragment.avg_retrieval_score:.3f}",
            f"  - Rerank Success: {fragment.reranking_success_rate:.1%}",
            f"  - Relevant in Top-5: {fragment.relevant_in_top_5:.1f}",
            f"  - Avg Latency: {fragment.avg_latency_ms:.1f}ms",
            f"  - Document Count: {fragment.document_count}",
            "",
            "Turn Collection (engram_turns):",
            f"  - Avg Score: {turn.avg_retrieval_score:.3f}",
            f"  - Rerank Success: {turn.reranking_success_rate:.1%}",
            f"  - Relevant in Top-5: {turn.relevant_in_top_5:.1f}",
            f"  - Avg Latency: {turn.avg_latency_ms:.1f}ms",
            f"  - Document Count: {turn.document_count}",
            "",
            "Improvements:",
            f"  - Score: {score_imp:+.1%}",
            f"  - Reranking: {rerank_imp:+.1%}",
            "",
        ]

        # Add verdict
        if turn.avg_retrieval_score > fragment.avg_retrieval_score:
            lines.append("✓ Turn-level indexing shows improved retrieval scores")
        if turn.reranking_success_rate > fragment.reranking_success_rate:
            lines.append("✓ Turn-level indexing shows improved reranking success")
        if turn.relevant_in_top_5 > fragment.relevant_in_top_5:
            lines.append("✓ Turn-level indexing shows more relevant results in top-5")

        return "\n".join(lines)

    async def get_collection_stats(self, collection_name: str) -> dict:
        """Get statistics for a collection.

        Args:
            collection_name: Name of the collection.

        Returns:
            Dictionary of collection statistics.
        """
        try:
            info = await self.qdrant.client.get_collection(collection_name)
            return {
                "name": collection_name,
                "points_count": info.points_count,
                "vectors_count": info.vectors_count,
                "indexed_vectors_count": info.indexed_vectors_count,
                "status": info.status.value,
            }
        except Exception as e:
            logger.warning(f"Could not get stats for {collection_name}: {e}")
            return {"name": collection_name, "error": str(e)}
