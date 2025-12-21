"""Reranker router for tier selection and graceful degradation.

Routes reranking requests to appropriate tier based on:
- Explicit tier selection (fast, accurate, code, colbert, llm)
- Automatic fallback on errors or timeouts
- Rate limit handling for LLM tier
- Backend selection (local vs huggingface) for accurate/code tiers
"""

import asyncio
import logging
from typing import Literal

from src.config import Settings, get_settings
from src.rerankers.base import BaseReranker, RankedResult
from src.rerankers.llm import LLMReranker
from src.utils.rate_limiter import RateLimitError, SlidingWindowRateLimiter

logger = logging.getLogger(__name__)

RerankerTier = Literal["fast", "accurate", "code", "colbert", "llm"]


class RerankerRouter:
    """Router for selecting and managing reranker tiers.

    Manages multiple reranker instances and routes requests based on
    tier selection. Implements graceful degradation on failures.

    Attributes:
        settings: Application settings.
        rerankers: Dict of loaded reranker instances by tier.
        llm_rate_limiter: Rate limiter for LLM tier.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        """Initialize reranker router.

        Args:
            settings: Application settings. Uses get_settings() if None.
        """
        self.settings = settings or get_settings()
        self.rerankers: dict[RerankerTier, BaseReranker] = {}

        # Initialize rate limiter for LLM tier
        self.llm_rate_limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=self.settings.rate_limit_requests_per_hour,
            max_budget_cents_per_hour=self.settings.rate_limit_budget_cents,
        )

        logger.info("Reranker router initialized")

    def _load_reranker(self, tier: RerankerTier) -> BaseReranker:
        """Load a reranker for the specified tier.

        Args:
            tier: Reranker tier to load.

        Returns:
            Loaded reranker instance.
        """
        if tier in self.rerankers:
            return self.rerankers[tier]

        logger.info(f"Loading reranker for tier: {tier}")

        reranker: BaseReranker
        if tier == "fast":
            # Fast tier uses FlashRank (requires local dependencies)
            # Fall back to HuggingFace accurate tier if not available
            try:
                from src.rerankers.flash import FlashRankReranker

                reranker = FlashRankReranker(
                    model_name=self.settings.reranker_fast_model,
                )
            except ImportError:
                logger.warning("FlashRank not available, using HuggingFace for fast tier")
                from src.clients.huggingface import HuggingFaceReranker

                reranker = HuggingFaceReranker(
                    model_id=self.settings.reranker_accurate_model,
                    api_token=self.settings.hf_api_token,
                )
        elif tier == "accurate":
            # Accurate tier supports HuggingFace backend
            if self.settings.reranker_backend == "huggingface":
                from src.clients.huggingface import HuggingFaceReranker

                logger.info("Using HuggingFace reranker for accurate tier")
                reranker = HuggingFaceReranker(
                    model_id=self.settings.reranker_accurate_model,
                    api_token=self.settings.hf_api_token,
                )
            else:
                from src.rerankers.cross_encoder import CrossEncoderReranker

                reranker = CrossEncoderReranker(
                    model_name=self.settings.reranker_accurate_model,
                    device=self.settings.embedder_device,
                    batch_size=self.settings.reranker_batch_size,
                )
        elif tier == "code":
            # Code tier supports HuggingFace backend
            if self.settings.reranker_backend == "huggingface":
                from src.clients.huggingface import HuggingFaceReranker

                logger.info("Using HuggingFace reranker for code tier")
                reranker = HuggingFaceReranker(
                    model_id=self.settings.reranker_code_model,
                    api_token=self.settings.hf_api_token,
                )
            else:
                from src.rerankers.cross_encoder import CrossEncoderReranker

                reranker = CrossEncoderReranker(
                    model_name=self.settings.reranker_code_model,
                    device=self.settings.embedder_device,
                    batch_size=self.settings.reranker_batch_size,
                )
        elif tier == "colbert":
            from src.rerankers.colbert import ColBERTReranker

            reranker = ColBERTReranker(
                model_name=self.settings.reranker_colbert_model,
                device=self.settings.embedder_device,
                n_gpu=1 if self.settings.embedder_device == "cuda" else 0,
            )
        elif tier == "llm":
            reranker = LLMReranker(
                model=self.settings.reranker_llm_model,
                provider=self.settings.reranker_llm_provider,
                rate_limiter=self.llm_rate_limiter,
            )
        else:
            raise ValueError(f"Unknown reranker tier: {tier}")

        self.rerankers[tier] = reranker
        logger.info(f"Reranker loaded for tier: {tier}")

        return reranker

    async def rerank(
        self,
        query: str,
        documents: list[str],
        tier: RerankerTier = "fast",
        top_k: int | None = None,
        timeout_ms: int | None = None,
        fallback_tier: RerankerTier | None = "fast",
    ) -> tuple[list[RankedResult], RerankerTier, bool]:
        """Rerank documents with tier selection and graceful degradation.

        Args:
            query: Search query.
            documents: List of candidate documents.
            tier: Requested reranker tier.
            top_k: Optional number of top results to return.
            timeout_ms: Optional timeout in milliseconds. Uses config default if None.
            fallback_tier: Tier to use on failure. None disables fallback.

        Returns:
            Tuple of (ranked_results, actual_tier_used, degraded).
            degraded=True indicates fallback was used.
        """
        if not documents:
            return [], tier, False

        # Use configured timeout if not specified
        if timeout_ms is None:
            timeout_ms = self.settings.reranker_timeout_ms

        timeout_seconds = timeout_ms / 1000.0

        # Load reranker for requested tier
        try:
            reranker = self._load_reranker(tier)
        except Exception as e:
            logger.error(f"Failed to load reranker for tier {tier}: {e}")
            if fallback_tier and fallback_tier != tier:
                logger.info(f"Falling back to tier: {fallback_tier}")
                return await self.rerank(query, documents, fallback_tier, top_k, timeout_ms, None)
            # No fallback, return empty results
            return [], tier, True

        # Execute reranking with timeout
        try:
            results = await asyncio.wait_for(
                reranker.rerank_async(query, documents, top_k),
                timeout=timeout_seconds,
            )
            return results, tier, False

        except TimeoutError:
            logger.warning(f"Reranking timeout ({timeout_ms}ms) for tier: {tier}")
            if fallback_tier and fallback_tier != tier:
                logger.info(f"Falling back to tier: {fallback_tier}")
                return await self.rerank(query, documents, fallback_tier, top_k, timeout_ms, None)
            # No fallback, return documents with default scores
            return (
                [
                    RankedResult(text=doc, score=0.5, original_index=idx)
                    for idx, doc in enumerate(documents)
                ],
                tier,
                True,
            )

        except RateLimitError as e:
            logger.warning(f"Rate limit exceeded for tier {tier}: {e}")
            if fallback_tier and fallback_tier != tier:
                logger.info(f"Falling back to tier: {fallback_tier}")
                return await self.rerank(query, documents, fallback_tier, top_k, timeout_ms, None)
            # No fallback, return documents with default scores
            return (
                [
                    RankedResult(text=doc, score=0.5, original_index=idx)
                    for idx, doc in enumerate(documents)
                ],
                tier,
                True,
            )

        except Exception as e:
            logger.error(f"Reranking failed for tier {tier}: {e}", exc_info=True)
            if fallback_tier and fallback_tier != tier:
                logger.info(f"Falling back to tier: {fallback_tier}")
                return await self.rerank(query, documents, fallback_tier, top_k, timeout_ms, None)
            # No fallback, return documents with default scores
            return (
                [
                    RankedResult(text=doc, score=0.5, original_index=idx)
                    for idx, doc in enumerate(documents)
                ],
                tier,
                True,
            )

    async def rerank_batch(
        self,
        queries: list[str],
        documents_batch: list[list[str]],
        tier: RerankerTier = "fast",
        top_k: int | None = None,
        timeout_ms: int | None = None,
    ) -> list[tuple[list[RankedResult], RerankerTier, bool]]:
        """Rerank multiple query-document pairs.

        Processes each query independently with timeout and fallback.

        Args:
            queries: List of search queries.
            documents_batch: List of document lists (one per query).
            tier: Requested reranker tier.
            top_k: Optional number of top results per query.
            timeout_ms: Optional timeout in milliseconds per query.

        Returns:
            List of (ranked_results, actual_tier, degraded) tuples.
        """
        tasks = [
            self.rerank(query, documents, tier, top_k, timeout_ms)
            for query, documents in zip(queries, documents_batch, strict=True)
        ]
        return await asyncio.gather(*tasks)

    def get_rate_limit_usage(self) -> dict[str, float]:
        """Get current LLM rate limiter usage stats.

        Returns:
            Dict with usage statistics.
        """
        return self.llm_rate_limiter.get_usage()

    def reset_rate_limiter(self) -> None:
        """Reset LLM rate limiter. Useful for testing."""
        self.llm_rate_limiter.reset()
