"""Multi-query retriever with LLM-based query expansion and RRF fusion.

Implements diverse multi-query rewriting for improved retrieval based on DMQR-RAG research.
Generates query variations using different expansion strategies and fuses results using
Reciprocal Rank Fusion (RRF).

Reference: https://arxiv.org/abs/2411.13154
"""

import json
import logging
from typing import Literal

import litellm
from pydantic import BaseModel, Field

from search.retrieval.retriever import SearchRetriever
from search.retrieval.types import SearchQuery, SearchResultItem

logger = logging.getLogger(__name__)

# Suppress litellm debug logs
litellm.suppress_debug_info = True

QueryExpansionStrategy = Literal["paraphrase", "keyword", "stepback", "decompose"]
"""Query expansion strategies based on DMQR-RAG research.

- paraphrase: Rephrase with synonyms (GQR in paper)
- keyword: Extract key entities and terms (KWR in paper)
- stepback: Generalize to broader concept
- decompose: Break into sub-questions (for complex queries)
"""


EXPANSION_SYSTEM_PROMPT = """You are a search query expansion expert. Given a user query, \
generate alternative search queries that will help retrieve relevant documents.

Rules:
- Generate queries that are semantically different but target the same information need
- Each query should emphasize different aspects or use different vocabulary
- Return ONLY a JSON object with a "queries" array of query strings
- Example: {"queries": ["query 1", "query 2", "query 3"]}
- Do not include numbering, bullets, or markdown formatting"""


class MultiQueryConfig(BaseModel):
    """Configuration for multi-query retrieval.

    Attributes:
        num_variations: Number of query variations to generate.
        strategies: Expansion strategies to use.
        include_original: Whether to include original query in retrieval.
        rrf_k: RRF fusion constant (typically 60).
    """

    num_variations: int = Field(
        default=3, ge=1, le=10, description="Number of query variations to generate"
    )
    strategies: list[QueryExpansionStrategy] = Field(
        default=["paraphrase", "keyword", "stepback"],
        description="Expansion strategies to use",
    )
    include_original: bool = Field(
        default=True, description="Whether to include original query in retrieval"
    )
    rrf_k: int = Field(default=60, ge=1, description="RRF fusion constant (typically 60)")


class MultiQueryRetriever:
    """Multi-query retriever that generates query variations using LLM and fuses results with RRF.

    Based on DMQR-RAG: Diverse Multi-Query Rewriting for RAG.
    Reference: https://arxiv.org/abs/2411.13154

    Key strategies:
    - Paraphrase: Rephrase with synonyms to capture vocabulary variance
    - Keyword: Extract key entities for precise matching
    - Step-back: Generalize to broader concepts for high-level documents
    - Decompose: Break complex queries into sub-questions

    Attributes:
        base_retriever: Base retriever to use for each query.
        config: Multi-query configuration.
        model: LLM model name for query expansion.
        total_tokens: Total tokens used for query expansion.
        total_cost_cents: Total cost in cents for query expansion.

    Example:
        >>> retriever = MultiQueryRetriever(
        ...     base_retriever=search_retriever,
        ...     config=MultiQueryConfig(
        ...         num_variations=3,
        ...         strategies=["paraphrase", "keyword", "stepback"]
        ...     )
        ... )
        >>> results = await retriever.search(
        ...     SearchQuery(text="How do I implement OAuth2 authentication?", limit=10)
        ... )
    """

    def __init__(
        self,
        base_retriever: SearchRetriever,
        config: MultiQueryConfig | None = None,
        model: str = "grok-4-1-fast-reasoning",
    ) -> None:
        """Initialize multi-query retriever.

        Args:
            base_retriever: Base retriever to use for each query variation.
            config: Multi-query configuration (uses defaults if None).
            model: LLM model name for query expansion.
        """
        self.base_retriever = base_retriever
        self.config = config or MultiQueryConfig()
        self.model = model
        self.total_tokens = 0
        self.total_cost_cents = 0.0

        logger.info(
            f"Initialized MultiQueryRetriever with model={model}, "
            f"num_variations={self.config.num_variations}, "
            f"strategies={self.config.strategies}"
        )

    async def search(self, query: SearchQuery) -> list[SearchResultItem]:
        """Search using multi-query expansion and RRF fusion.

        Performs the following steps:
        1. Generate query variations using LLM
        2. Execute parallel searches with base retriever
        3. Fuse results using Reciprocal Rank Fusion

        Falls back to single query on LLM failure.

        Args:
            query: The search query.

        Returns:
            Fused and ranked search results.
        """
        limit = query.limit
        query_text = query.text

        logger.info(
            f"Multi-query search started: query={query_text[:100]}, "
            f"num_variations={self.config.num_variations}, "
            f"strategies={self.config.strategies}, "
            f"include_original={self.config.include_original}, "
            f"limit={limit}"
        )

        try:
            # Step 1: Generate query variations using LLM
            variations = await self.expand_query(query_text)

            logger.debug(
                f"Query expansion completed: original_query={query_text}, variations={variations}"
            )

            # Step 2: Search with each variation in parallel
            # Fetch more results per query since we'll dedupe
            per_query_limit = max(limit * 2, 20)

            import asyncio

            search_tasks = [
                self.base_retriever.search(
                    SearchQuery(
                        text=var_query,
                        limit=per_query_limit,
                        threshold=query.threshold,
                        filters=query.filters,
                        strategy=query.strategy,
                        rerank=query.rerank,
                        rerank_tier=query.rerank_tier,
                        rerank_depth=query.rerank_depth,
                    )
                )
                for var_query in variations
            ]

            all_results = await asyncio.gather(*search_tasks)

            logger.debug(
                f"Parallel searches completed: queries_executed={len(variations)}, "
                f"result_counts={[len(r) for r in all_results]}"
            )

            # Step 3: Fuse results using RRF
            fused = self.rrf_fusion(all_results, limit)

            logger.info(
                f"Multi-query search completed: queries_executed={len(variations)}, "
                f"total_candidates={sum(len(r) for r in all_results)}, "
                f"unique_results={len(fused)}"
            )

            return fused

        except Exception as e:
            logger.error(
                f"Multi-query search failed - falling back to single query: error={e}",
                exc_info=True,
            )

            # Graceful degradation: fall back to single query
            fallback_results = await self.base_retriever.search(query)

            # Mark results as degraded
            for result in fallback_results:
                result.degraded = True
                result.degraded_reason = f"Multi-query expansion failed: {str(e)}"

            return fallback_results

    async def expand_query(self, query: str) -> list[str]:
        """Expand a query into multiple variations using LLM.

        Generates query variations using configured expansion strategies.
        Falls back to original query only on LLM failure.

        Args:
            query: Original query text.

        Returns:
            List of query variations (including original if configured).
        """
        variations: list[str] = []

        # Always include original query if configured
        if self.config.include_original:
            variations.append(query)

        prompt = self._build_expansion_prompt(query)

        try:
            response = await litellm.acompletion(
                model=self.model,
                messages=[
                    {"role": "system", "content": EXPANSION_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,  # Some creativity for diverse variations
                max_tokens=500,
                response_format={"type": "json_object"},  # Request JSON mode
            )

            # Extract response text
            response_text = response.choices[0].message.content or "{}"

            # Track LLM usage
            usage = response.usage
            if usage:
                total_tokens = getattr(usage, "total_tokens", 0)
                prompt_tokens = getattr(usage, "prompt_tokens", 0)
                completion_tokens = getattr(usage, "completion_tokens", 0)

                self.total_tokens += total_tokens

                # Cost estimation for grok-4-1-fast-reasoning
                # Rough estimate: $0.50/1M tokens (average of input/output)
                cost_cents = (total_tokens / 1_000_000) * 50
                self.total_cost_cents += cost_cents

                logger.debug(
                    f"LLM usage: prompt_tokens={prompt_tokens}, "
                    f"completion_tokens={completion_tokens}, "
                    f"total_tokens={total_tokens}, "
                    f"cost_cents={cost_cents:.4f}"
                )

            # Parse JSON response
            try:
                result_obj = json.loads(response_text)
                queries = result_obj.get("queries", [])

                # Filter and limit variations
                valid_variations = [
                    v.strip() for v in queries if isinstance(v, str) and v.strip() and v != query
                ]
                valid_variations = valid_variations[: self.config.num_variations]

                variations.extend(valid_variations)

                logger.debug(
                    f"Query expansion successful: generated {len(valid_variations)} variations"
                )

            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse LLM JSON response: {e}, response={response_text}")

            return variations if variations else [query]

        except Exception as e:
            logger.warning(f"Query expansion failed - using original query only: error={e}")
            # Return at least the original query
            return [query]

    def _build_expansion_prompt(self, query: str) -> str:
        """Build the user prompt for query expansion.

        Args:
            query: Original query text.

        Returns:
            Formatted prompt for LLM.
        """
        strategy_instructions = []
        for strategy in self.config.strategies:
            if strategy == "paraphrase":
                strategy_instructions.append(
                    "- Paraphrase: Rephrase the query using different words and synonyms"
                )
            elif strategy == "keyword":
                strategy_instructions.append(
                    "- Keyword: Focus on key entities, names, and technical terms"
                )
            elif strategy == "stepback":
                strategy_instructions.append(
                    "- Step-back: Generalize to a broader concept or category"
                )
            elif strategy == "decompose":
                strategy_instructions.append(
                    "- Decompose: Break into simpler sub-questions (if query is complex)"
                )

        strategy_text = "\n".join(strategy_instructions)

        return f"""Generate {self.config.num_variations} alternative search queries for:
"{query}"

Use these strategies:
{strategy_text}

Return ONLY a JSON object with a "queries" array. No explanations."""

    def rrf_fusion(
        self, result_sets: list[list[SearchResultItem]], top_k: int
    ) -> list[SearchResultItem]:
        """Fuse multiple result sets using Reciprocal Rank Fusion (RRF).

        RRF score = sum(1 / (k + rank_i)) across all result sets
        where k is typically 60 to dampen the impact of high rankings.

        Reference: https://dl.acm.org/doi/10.1145/1571941.1572114

        Args:
            result_sets: List of search result sets to fuse.
            top_k: Number of top results to return.

        Returns:
            Fused results sorted by RRF score (descending).
        """
        k = self.config.rrf_k
        score_map: dict[str | int, dict] = {}

        for results in result_sets:
            for rank, result in enumerate(results):
                rrf_score = 1 / (k + rank + 1)
                key = result.id

                if key in score_map:
                    # Sum RRF scores for documents appearing in multiple result sets
                    score_map[key]["rrf_score"] += rrf_score
                else:
                    score_map[key] = {
                        "result": result,
                        "rrf_score": rrf_score,
                    }

        # Sort by RRF score and return top K
        sorted_items = sorted(score_map.values(), key=lambda x: x["rrf_score"], reverse=True)
        fused_results = []

        for item in sorted_items[:top_k]:
            result = item["result"]
            rrf_score = item["rrf_score"]

            # Create new result with RRF score as final score
            fused_result = SearchResultItem(
                id=result.id,
                score=rrf_score,  # Use RRF score as final score
                rrf_score=rrf_score,  # Also store in rrf_score for transparency
                reranker_score=result.reranker_score,
                rerank_tier=result.rerank_tier,
                payload=result.payload,
                degraded=result.degraded,
                degraded_reason=result.degraded_reason,
            )
            fused_results.append(fused_result)

        return fused_results

    def get_usage(self) -> dict[str, float]:
        """Get usage statistics for this retriever instance.

        Returns:
            Dictionary with total_cost_cents and total_tokens.
        """
        return {
            "total_cost_cents": self.total_cost_cents,
            "total_tokens": self.total_tokens,
        }

    def reset_usage(self) -> None:
        """Reset usage counters."""
        self.total_cost_cents = 0.0
        self.total_tokens = 0
