"""LLM-based listwise reranker using litellm.

Uses large language models to rerank documents by generating
relevance scores. Most accurate but also slowest and most expensive.

Expected latency: ~500ms per query.
Rate-limited to prevent budget overruns.
"""

import json
import logging

import litellm

from src.rerankers.base import BaseReranker, RankedResult
from src.utils.rate_limiter import RateLimitError, SlidingWindowRateLimiter

logger = logging.getLogger(__name__)

# Suppress litellm debug logs
litellm.suppress_debug_info = True


RERANK_PROMPT = """You are a relevance scoring assistant. Given a query and a list of documents, \
score each document's relevance to the query on a scale of 0-100.

Query: {query}

Documents:
{documents}

Return ONLY a JSON array of scores in the same order as the documents, like:
[95, 72, 88, 45, 91]

Scores only, no explanations."""


class LLMReranker(BaseReranker):
    """LLM-based reranker using litellm for provider abstraction.

    Uses large language models to perform listwise reranking by scoring
    all documents in context. Most accurate but expensive and slow.

    Includes rate limiting for cost control.

    Attributes:
        model: LLM model name (e.g., gpt-4o-mini, claude-3-haiku, gemini-3-flash-preview).
        provider: Optional provider prefix (openai, anthropic, xai, etc.).
        rate_limiter: Optional rate limiter instance.
        cost_per_1k_tokens: Estimated cost in cents per 1k tokens.
    """

    def __init__(
        self,
        model: str = "gemini-3-flash-preview",
        provider: str | None = "google",
        rate_limiter: SlidingWindowRateLimiter | None = None,
        cost_per_1k_tokens: float = 0.5,  # Rough estimate
        temperature: float = 0.0,
        max_tokens: int = 200,
    ) -> None:
        """Initialize LLM reranker.

        Args:
            model: LLM model name.
            provider: Provider prefix for litellm (e.g., 'xai', 'openai').
            rate_limiter: Optional rate limiter for cost control.
            cost_per_1k_tokens: Estimated cost in cents per 1000 tokens.
            temperature: LLM temperature (0.0 for deterministic).
            max_tokens: Maximum tokens in response.
        """
        self.model = model
        self.provider = provider
        self.rate_limiter = rate_limiter
        self.cost_per_1k_tokens = cost_per_1k_tokens
        self.temperature = temperature
        self.max_tokens = max_tokens

        # Construct full model name for litellm
        if provider:
            self.full_model_name = f"{provider}/{model}"
        else:
            self.full_model_name = model

        logger.info(f"Initializing LLM reranker with model: {self.full_model_name}")

    def _estimate_cost(self, prompt_tokens: int, completion_tokens: int = 100) -> float:
        """Estimate cost of a request in cents.

        Args:
            prompt_tokens: Estimated prompt tokens.
            completion_tokens: Estimated completion tokens.

        Returns:
            Estimated cost in cents.
        """
        total_tokens = prompt_tokens + completion_tokens
        return (total_tokens / 1000) * self.cost_per_1k_tokens

    def _parse_scores(self, response_text: str, num_documents: int) -> list[float]:
        """Parse scores from LLM response.

        Args:
            response_text: Raw LLM response text.
            num_documents: Expected number of scores.

        Returns:
            List of scores (0-100).

        Raises:
            ValueError: If parsing fails or score count doesn't match.
        """
        # Try to extract JSON array from response
        try:
            # Look for JSON array in response
            start_idx = response_text.find("[")
            end_idx = response_text.rfind("]")

            if start_idx == -1 or end_idx == -1:
                raise ValueError("No JSON array found in response")

            json_str = response_text[start_idx : end_idx + 1]
            scores = json.loads(json_str)

            if not isinstance(scores, list):
                raise ValueError("Parsed JSON is not a list")

            if len(scores) != num_documents:
                raise ValueError(
                    f"Score count mismatch: got {len(scores)}, expected {num_documents}"
                )

            # Convert to floats and validate range
            scores = [float(s) for s in scores]

            # Clamp to 0-100 range
            scores = [max(0.0, min(100.0, s)) for s in scores]

            return scores

        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.error(f"Failed to parse LLM scores: {e}")
            logger.debug(f"Raw response: {response_text}")
            # Fallback: return uniform scores
            return [50.0] * num_documents

    def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Rerank documents using LLM.

        Args:
            query: The search query.
            documents: List of candidate document texts.
            top_k: Optional number of top results to return.

        Returns:
            List of RankedResult objects sorted by score (descending).

        Raises:
            RateLimitError: If rate limit is exceeded.
        """
        if not documents:
            return []

        # Check rate limit before making expensive LLM call
        if self.rate_limiter:
            # Estimate cost based on input size
            estimated_tokens = len(query.split()) + sum(len(doc.split()) for doc in documents)
            estimated_cost = self._estimate_cost(estimated_tokens)

            try:
                self.rate_limiter.check_and_record(cost_cents=estimated_cost)
            except RateLimitError as e:
                logger.warning(f"LLM reranker rate limit exceeded: {e}")
                raise

        # Format documents for prompt
        doc_list = "\n".join(f"{i + 1}. {doc[:500]}" for i, doc in enumerate(documents))

        prompt = RERANK_PROMPT.format(query=query, documents=doc_list)

        # Call LLM
        try:
            response = litellm.completion(
                model=self.full_model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )

            response_text = response.choices[0].message.content or ""

            # Parse scores
            scores = self._parse_scores(response_text, len(documents))

        except Exception as e:
            logger.error(f"LLM reranking failed: {e}")
            # Fallback: return documents with uniform scores
            scores = [50.0] * len(documents)

        # Create results
        results = [
            RankedResult(text=doc, score=score / 100.0, original_index=idx)
            for idx, (doc, score) in enumerate(zip(documents, scores, strict=True))
        ]

        # Sort by score descending
        results.sort(key=lambda x: x.score, reverse=True)

        # Apply top_k if specified
        if top_k is not None:
            results = results[:top_k]

        return results

    async def rerank_async(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Async version of rerank.

        Uses litellm's async completion API.

        Args:
            query: The search query.
            documents: List of candidate document texts.
            top_k: Optional number of top results to return.

        Returns:
            List of RankedResult objects sorted by score (descending).

        Raises:
            RateLimitError: If rate limit is exceeded.
        """
        if not documents:
            return []

        # Check rate limit
        if self.rate_limiter:
            estimated_tokens = len(query.split()) + sum(len(doc.split()) for doc in documents)
            estimated_cost = self._estimate_cost(estimated_tokens)

            try:
                self.rate_limiter.check_and_record(cost_cents=estimated_cost)
            except RateLimitError as e:
                logger.warning(f"LLM reranker rate limit exceeded: {e}")
                raise

        # Format documents
        doc_list = "\n".join(f"{i + 1}. {doc[:500]}" for i, doc in enumerate(documents))
        prompt = RERANK_PROMPT.format(query=query, documents=doc_list)

        # Call LLM async
        try:
            response = await litellm.acompletion(
                model=self.full_model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )

            response_text = response.choices[0].message.content or ""
            scores = self._parse_scores(response_text, len(documents))

        except Exception as e:
            logger.error(f"LLM reranking failed: {e}")
            scores = [50.0] * len(documents)

        # Create results
        results = [
            RankedResult(text=doc, score=score / 100.0, original_index=idx)
            for idx, (doc, score) in enumerate(zip(documents, scores, strict=True))
        ]

        results.sort(key=lambda x: x.score, reverse=True)

        if top_k is not None:
            results = results[:top_k]

        return results

    def rerank_batch(
        self,
        queries: list[str],
        documents_batch: list[list[str]],
        top_k: int | None = None,
    ) -> list[list[RankedResult]]:
        """Rerank multiple query-document pairs.

        Processes sequentially to respect rate limits.

        Args:
            queries: List of search queries.
            documents_batch: List of document lists (one per query).
            top_k: Optional number of top results to return per query.

        Returns:
            List of ranked results lists (one per query).
        """
        return [
            self.rerank(query, documents, top_k)
            for query, documents in zip(queries, documents_batch, strict=True)
        ]

    async def rerank_batch_async(
        self,
        queries: list[str],
        documents_batch: list[list[str]],
        top_k: int | None = None,
    ) -> list[list[RankedResult]]:
        """Async version of rerank_batch.

        Processes sequentially to respect rate limits.

        Args:
            queries: List of search queries.
            documents_batch: List of document lists (one per query).
            top_k: Optional number of top results to return per query.

        Returns:
            List of ranked results lists (one per query).
        """
        results = []
        for query, documents in zip(queries, documents_batch, strict=True):
            result = await self.rerank_async(query, documents, top_k)
            results.append(result)
        return results
