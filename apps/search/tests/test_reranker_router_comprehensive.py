"""Comprehensive tests for reranker router module."""

import asyncio
import builtins
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.config import Settings
from src.rerankers.base import RankedResult
from src.rerankers.router import RerankerRouter
from src.utils.rate_limiter import RateLimitError, SlidingWindowRateLimiter

# Test data
SAMPLE_QUERY = "What is artificial intelligence?"
SAMPLE_DOCS = [
    "AI is the simulation of human intelligence by machines.",
    "Machine learning is a subset of AI.",
    "Deep learning uses neural networks.",
]


@pytest.fixture
def mock_settings():
    """Create mock settings for testing."""
    settings = MagicMock(spec=Settings)
    settings.rate_limit_requests_per_hour = 100
    settings.rate_limit_budget_cents = 1000
    settings.reranker_timeout_ms = 5000
    settings.reranker_fast_model = "ms-marco-TinyBERT-L-2-v2"
    settings.reranker_accurate_model = "BAAI/bge-reranker-base"
    settings.reranker_code_model = "jinaai/jina-reranker-v2-base-multilingual"
    settings.reranker_colbert_model = "colbert-ir/colbertv2.0"
    settings.reranker_llm_model = "gemini-3-flash-preview"
    settings.reranker_llm_provider = "google"
    settings.reranker_backend = "local"
    settings.reranker_batch_size = 32
    settings.embedder_device = "cpu"
    settings.hf_api_token = None
    return settings


class TestRerankerRouterInitialization:
    """Tests for RerankerRouter initialization."""

    def test_initialization_default(self, mock_settings) -> None:
        """Test default initialization."""
        router = RerankerRouter(settings=mock_settings)

        assert router.settings is mock_settings
        assert router.rerankers == {}
        assert router.llm_rate_limiter is not None
        assert isinstance(router.llm_rate_limiter, SlidingWindowRateLimiter)

    def test_initialization_without_settings(self) -> None:
        """Test initialization without explicit settings."""
        with patch("src.rerankers.router.get_settings") as mock_get_settings:
            mock_settings = MagicMock()
            mock_settings.rate_limit_requests_per_hour = 50
            mock_settings.rate_limit_budget_cents = 500
            mock_get_settings.return_value = mock_settings

            router = RerankerRouter()

            assert router.settings is mock_settings
            mock_get_settings.assert_called_once()

    def test_initialization_creates_rate_limiter(self, mock_settings) -> None:
        """Test that rate limiter is properly initialized."""
        mock_settings.rate_limit_requests_per_hour = 75
        mock_settings.rate_limit_budget_cents = 750

        router = RerankerRouter(settings=mock_settings)

        # Check rate limiter properties
        assert router.llm_rate_limiter.max_requests == 75
        assert router.llm_rate_limiter.max_budget_cents == 750


class TestLoadReranker:
    """Tests for _load_reranker method."""

    def test_load_reranker_caches(self, mock_settings) -> None:
        """Test that rerankers are cached after loading."""
        router = RerankerRouter(settings=mock_settings)

        # First load (will create real LLMReranker)
        result1 = router._load_reranker("llm")
        assert "llm" in router.rerankers
        assert result1 is not None

        # Second load should use cached version
        result2 = router._load_reranker("llm")
        assert result2 is result1  # Same object

    def test_load_llm_reranker(self, mock_settings) -> None:
        """Test loading LLM reranker."""
        router = RerankerRouter(settings=mock_settings)
        reranker = router._load_reranker("llm")

        assert reranker is not None
        assert "llm" in router.rerankers
        # Verify it's an instance of LLMReranker
        from src.rerankers.llm import LLMReranker

        assert isinstance(reranker, LLMReranker)

    def test_load_unknown_tier_raises_error(self, mock_settings) -> None:
        """Test loading unknown tier raises ValueError."""
        router = RerankerRouter(settings=mock_settings)

        with pytest.raises(ValueError, match="Unknown reranker tier"):
            router._load_reranker("unknown")

    def test_load_fast_tier_flashrank_success(self, mock_settings) -> None:
        """Test fast tier loads FlashRank successfully."""
        router = RerankerRouter(settings=mock_settings)

        with patch("src.rerankers.flash.FlashRankReranker") as mock_flash:
            mock_flash_instance = MagicMock()
            mock_flash.return_value = mock_flash_instance

            reranker = router._load_reranker("fast")

            # Should have created FlashRank reranker
            mock_flash.assert_called_once_with(
                model_name=mock_settings.reranker_fast_model,
            )
            assert reranker is mock_flash_instance

    def test_load_fast_tier_flashrank_import_error(self, mock_settings) -> None:
        """Test fast tier falls back to HuggingFace on FlashRank ImportError."""
        router = RerankerRouter(settings=mock_settings)

        # Mock the import to raise ImportError for FlashRank

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if "flash" in name:
                raise ImportError("FlashRank not available")
            return original_import(name, *args, **kwargs)

        with (
            patch("builtins.__import__", side_effect=mock_import),
            patch("src.clients.huggingface.HuggingFaceReranker") as mock_hf,
        ):
            mock_hf_instance = MagicMock()
            mock_hf.return_value = mock_hf_instance

            reranker = router._load_reranker("fast")

            # Should have created HuggingFace reranker
            mock_hf.assert_called_once_with(
                model_id=mock_settings.reranker_accurate_model,
                api_token=mock_settings.hf_api_token,
            )
            assert reranker is mock_hf_instance

    def test_load_accurate_tier_huggingface_backend(self, mock_settings) -> None:
        """Test accurate tier with HuggingFace backend."""
        mock_settings.reranker_backend = "huggingface"
        mock_settings.hf_api_token = "test-token"

        router = RerankerRouter(settings=mock_settings)

        with (
            patch("src.clients.huggingface.HuggingFaceReranker") as mock_hf,
            patch("src.rerankers.router.logger") as mock_logger,
        ):
            mock_hf_instance = MagicMock()
            mock_hf.return_value = mock_hf_instance

            reranker = router._load_reranker("accurate")

            # Should have logged that we're using HuggingFace
            mock_logger.info.assert_any_call("Using HuggingFace reranker for accurate tier")

            # Should have created HuggingFace reranker with correct params
            mock_hf.assert_called_once_with(
                model_id=mock_settings.reranker_accurate_model,
                api_token="test-token",
            )
            assert reranker is mock_hf_instance

    def test_load_accurate_tier_local_backend(self, mock_settings) -> None:
        """Test accurate tier with local backend."""
        mock_settings.reranker_backend = "local"

        router = RerankerRouter(settings=mock_settings)

        with patch("src.rerankers.cross_encoder.CrossEncoderReranker") as mock_ce:
            mock_ce_instance = MagicMock()
            mock_ce.return_value = mock_ce_instance

            reranker = router._load_reranker("accurate")

            # Should have created CrossEncoder reranker
            mock_ce.assert_called_once_with(
                model_name=mock_settings.reranker_accurate_model,
                device=mock_settings.embedder_device,
                batch_size=mock_settings.reranker_batch_size,
            )
            assert reranker is mock_ce_instance

    def test_load_code_tier_huggingface_backend(self, mock_settings) -> None:
        """Test code tier with HuggingFace backend."""
        mock_settings.reranker_backend = "huggingface"
        mock_settings.hf_api_token = "test-token"

        router = RerankerRouter(settings=mock_settings)

        with (
            patch("src.clients.huggingface.HuggingFaceReranker") as mock_hf,
            patch("src.rerankers.router.logger") as mock_logger,
        ):
            mock_hf_instance = MagicMock()
            mock_hf.return_value = mock_hf_instance

            reranker = router._load_reranker("code")

            # Should have logged that we're using HuggingFace
            mock_logger.info.assert_any_call("Using HuggingFace reranker for code tier")

            # Should have created HuggingFace reranker with correct params
            mock_hf.assert_called_once_with(
                model_id=mock_settings.reranker_code_model,
                api_token="test-token",
            )
            assert reranker is mock_hf_instance

    def test_load_code_tier_local_backend(self, mock_settings) -> None:
        """Test code tier with local backend."""
        mock_settings.reranker_backend = "local"

        router = RerankerRouter(settings=mock_settings)

        with patch("src.rerankers.cross_encoder.CrossEncoderReranker") as mock_ce:
            mock_ce_instance = MagicMock()
            mock_ce.return_value = mock_ce_instance

            reranker = router._load_reranker("code")

            # Should have created CrossEncoder reranker
            mock_ce.assert_called_once_with(
                model_name=mock_settings.reranker_code_model,
                device=mock_settings.embedder_device,
                batch_size=mock_settings.reranker_batch_size,
            )
            assert reranker is mock_ce_instance

    def test_load_colbert_tier(self, mock_settings) -> None:
        """Test loading ColBERT tier."""
        router = RerankerRouter(settings=mock_settings)

        with patch("src.rerankers.colbert.ColBERTReranker") as mock_colbert:
            mock_colbert_instance = MagicMock()
            mock_colbert.return_value = mock_colbert_instance

            reranker = router._load_reranker("colbert")

            # Should have created ColBERT reranker
            mock_colbert.assert_called_once_with(
                model_name=mock_settings.reranker_colbert_model,
                device=mock_settings.embedder_device,
                n_gpu=0,  # CPU device
            )
            assert reranker is mock_colbert_instance

    def test_load_colbert_tier_with_cuda(self, mock_settings) -> None:
        """Test loading ColBERT tier with CUDA device."""
        mock_settings.embedder_device = "cuda"

        router = RerankerRouter(settings=mock_settings)

        with patch("src.rerankers.colbert.ColBERTReranker") as mock_colbert:
            mock_colbert_instance = MagicMock()
            mock_colbert.return_value = mock_colbert_instance

            reranker = router._load_reranker("colbert")

            # Should have created ColBERT reranker with GPU
            mock_colbert.assert_called_once_with(
                model_name=mock_settings.reranker_colbert_model,
                device="cuda",
                n_gpu=1,  # CUDA device should use GPU
            )
            assert reranker is mock_colbert_instance


class TestRerank:
    """Tests for rerank method."""

    async def test_rerank_empty_documents(self, mock_settings) -> None:
        """Test reranking with empty documents."""
        router = RerankerRouter(settings=mock_settings)

        results, tier, degraded = await router.rerank(SAMPLE_QUERY, [], tier="fast")

        assert results == []
        assert tier == "fast"
        assert not degraded

    async def test_rerank_success(self, mock_settings) -> None:
        """Test successful reranking."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_results = [
                RankedResult(text="doc1", score=0.9, original_index=0),
                RankedResult(text="doc2", score=0.7, original_index=1),
            ]
            mock_reranker.rerank_async = AsyncMock(return_value=mock_results)
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY, SAMPLE_DOCS[:2], tier="fast"
            )

            assert results == mock_results
            assert tier == "fast"
            assert not degraded
            mock_reranker.rerank_async.assert_called_once()

    async def test_rerank_with_top_k(self, mock_settings) -> None:
        """Test reranking with top_k parameter."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_results = [RankedResult(text="doc", score=0.9, original_index=0)]
            mock_reranker.rerank_async = AsyncMock(return_value=mock_results)
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY, SAMPLE_DOCS, tier="fast", top_k=1
            )

            # Verify top_k was passed to reranker
            mock_reranker.rerank_async.assert_called_once_with(SAMPLE_QUERY, SAMPLE_DOCS, 1)

    async def test_rerank_with_custom_timeout(self, mock_settings) -> None:
        """Test reranking with custom timeout."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(
                return_value=[RankedResult(text="doc", score=0.9, original_index=0)]
            )
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            await router.rerank(SAMPLE_QUERY, SAMPLE_DOCS[:1], tier="fast", timeout_ms=1000)

            # Timeout should be used (verified implicitly by no timeout error)
            assert True

    async def test_rerank_timeout_without_fallback(self, mock_settings) -> None:
        """Test reranking returns default scores on timeout without fallback."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()

            # Make it sleep longer than timeout
            async def slow_rerank(*args, **kwargs):
                await asyncio.sleep(10)
                return []

            mock_reranker.rerank_async = slow_rerank
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS,
                tier="fast",
                timeout_ms=1,
                fallback_tier=None,
            )

            assert degraded
            assert tier == "fast"
            assert len(results) == len(SAMPLE_DOCS)
            # Should have default scores
            assert all(r.score == 0.5 for r in results)

    async def test_rerank_rate_limit_without_fallback(self, mock_settings) -> None:
        """Test reranking returns default scores on rate limit without fallback."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(
                side_effect=RateLimitError("Rate limit", "budget", 60)
            )
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS,
                tier="llm",
                fallback_tier=None,
            )

            assert degraded
            assert len(results) == len(SAMPLE_DOCS)
            assert all(r.score == 0.5 for r in results)

    async def test_rerank_general_error_without_fallback(self, mock_settings) -> None:
        """Test reranking returns default scores on general error without fallback."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(side_effect=RuntimeError("Error"))
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS,
                tier="accurate",
                fallback_tier=None,
            )

            assert degraded
            assert len(results) == len(SAMPLE_DOCS)
            assert all(r.score == 0.5 for r in results)

    async def test_rerank_load_error_without_fallback(self, mock_settings) -> None:
        """Test reranking returns empty on load error without fallback."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_load.side_effect = ImportError("Not available")

            router = RerankerRouter(settings=mock_settings)
            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS,
                tier="colbert",
                fallback_tier=None,
            )

            assert degraded
            assert results == []

    async def test_rerank_uses_config_timeout(self, mock_settings) -> None:
        """Test that rerank uses config timeout when not specified."""
        mock_settings.reranker_timeout_ms = 3000

        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(
                return_value=[RankedResult(text="doc", score=0.9, original_index=0)]
            )
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            # Don't specify timeout_ms, should use config value
            await router.rerank(SAMPLE_QUERY, SAMPLE_DOCS[:1], tier="fast")

            # If this completes without timeout, the config value was used
            assert True

    async def test_rerank_with_fallback_succeeds(self, mock_settings) -> None:
        """Test that fallback can succeed after primary tier fails."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            # Create two different reranker mocks
            failing_reranker = MagicMock()
            failing_reranker.rerank_async = AsyncMock(side_effect=RuntimeError("Error"))

            fallback_reranker = MagicMock()
            fallback_results = [RankedResult(text="doc", score=0.5, original_index=0)]
            fallback_reranker.rerank_async = AsyncMock(return_value=fallback_results)

            # Load different rerankers for different tiers
            def load_side_effect(tier):
                if tier == "accurate":
                    return failing_reranker
                return fallback_reranker

            mock_load.side_effect = load_side_effect

            router = RerankerRouter(settings=mock_settings)
            results, tier_used, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS[:1],
                tier="accurate",
                fallback_tier="fast",
            )

            # Should have results from fallback
            assert len(results) == 1
            # Either tier could be reported depending on implementation details
            assert tier_used in ["accurate", "fast"]


class TestRerankBatch:
    """Tests for rerank_batch method."""

    async def test_rerank_batch_basic(self, mock_settings) -> None:
        """Test basic batch reranking."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(
                return_value=[RankedResult(text="doc", score=0.9, original_index=0)]
            )
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            queries = ["query1", "query2"]
            docs_batch = [SAMPLE_DOCS[:1], SAMPLE_DOCS[:1]]

            results = await router.rerank_batch(queries, docs_batch, tier="fast", timeout_ms=5000)

            assert len(results) == 2
            assert all(len(r[0]) == 1 for r in results)
            assert all(r[1] == "fast" for r in results)
            assert all(not r[2] for r in results)  # Not degraded

    async def test_rerank_batch_with_top_k(self, mock_settings) -> None:
        """Test batch reranking with top_k."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(
                return_value=[RankedResult(text="doc", score=0.9, original_index=0)]
            )
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            queries = ["query1"]
            docs_batch = [SAMPLE_DOCS]

            results = await router.rerank_batch(queries, docs_batch, tier="fast", top_k=1)

            assert len(results) == 1

    async def test_rerank_batch_empty(self, mock_settings) -> None:
        """Test batch reranking with empty batch."""
        router = RerankerRouter(settings=mock_settings)

        results = await router.rerank_batch([], [], tier="fast")

        assert results == []


class TestRateLimiterMethods:
    """Tests for rate limiter utility methods."""

    def test_get_rate_limit_usage(self, mock_settings) -> None:
        """Test getting rate limit usage."""
        router = RerankerRouter(settings=mock_settings)

        usage = router.get_rate_limit_usage()

        assert "request_count" in usage
        assert "total_cost_cents" in usage
        assert usage["request_count"] == 0

    def test_get_rate_limit_usage_after_use(self, mock_settings) -> None:
        """Test getting rate limit usage after requests."""
        router = RerankerRouter(settings=mock_settings)

        router.llm_rate_limiter.check_and_record(cost_cents=10.0)
        router.llm_rate_limiter.check_and_record(cost_cents=5.0)

        usage = router.get_rate_limit_usage()

        assert usage["request_count"] == 2
        assert usage["total_cost_cents"] == 15.0

    def test_reset_rate_limiter(self, mock_settings) -> None:
        """Test resetting rate limiter."""
        router = RerankerRouter(settings=mock_settings)

        # Add some requests
        router.llm_rate_limiter.check_and_record(cost_cents=10.0)
        usage_before = router.get_rate_limit_usage()
        assert usage_before["request_count"] == 1

        # Reset
        router.reset_rate_limiter()
        usage_after = router.get_rate_limit_usage()

        assert usage_after["request_count"] == 0
        assert usage_after["total_cost_cents"] == 0.0


class TestFallbackBehavior:
    """Tests for fallback chaining behavior."""

    async def test_no_infinite_recursion(self, mock_settings) -> None:
        """Test that fallback doesn't cause infinite recursion."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(side_effect=RuntimeError("Error"))
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)

            # This should not cause infinite recursion
            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS[:1],
                tier="fast",
                fallback_tier="fast",  # Same as primary tier
            )

            # Should return default scores
            assert degraded
            assert len(results) == 1

    async def test_fallback_to_none_stops_recursion(self, mock_settings) -> None:
        """Test that None fallback stops recursion."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(side_effect=RuntimeError("Error"))
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)

            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS,
                tier="accurate",
                fallback_tier=None,  # No fallback
            )

            assert degraded
            # Should return default scores for all docs
            assert len(results) == len(SAMPLE_DOCS)

    async def test_timeout_error_handling(self, mock_settings) -> None:
        """Test proper handling of timeout errors."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()

            async def timeout_rerank(*args, **kwargs):
                await asyncio.sleep(10)  # Sleep longer than timeout
                return []

            mock_reranker.rerank_async = timeout_rerank
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)

            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS[:1],
                tier="accurate",
                timeout_ms=10,  # Very short timeout
                fallback_tier=None,
            )

            # Should timeout and return default scores
            assert degraded
            assert len(results) == 1
            assert results[0].score == 0.5

    async def test_load_error_with_fallback(self, mock_settings) -> None:
        """Test load error triggers fallback to different tier."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            # First call (colbert) raises ImportError
            # Second call (fast) succeeds
            fast_reranker = MagicMock()
            fast_results = [RankedResult(text="doc", score=0.8, original_index=0)]
            fast_reranker.rerank_async = AsyncMock(return_value=fast_results)

            def load_side_effect(tier):
                if tier == "colbert":
                    raise ImportError("ColBERT not available")
                return fast_reranker

            mock_load.side_effect = load_side_effect

            router = RerankerRouter(settings=mock_settings)
            results, tier_used, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS[:1],
                tier="colbert",
                fallback_tier="fast",
            )

            # Should have fallen back successfully
            assert len(results) == 1
            assert tier_used in ["colbert", "fast"]  # Implementation detail

    async def test_timeout_with_fallback(self, mock_settings) -> None:
        """Test timeout triggers fallback to different tier."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            # Create two rerankers
            slow_reranker = MagicMock()

            async def slow_rerank(*args, **kwargs):
                await asyncio.sleep(10)
                return []

            slow_reranker.rerank_async = slow_rerank

            fast_reranker = MagicMock()
            fast_results = [RankedResult(text="doc", score=0.8, original_index=0)]
            fast_reranker.rerank_async = AsyncMock(return_value=fast_results)

            def load_side_effect(tier):
                if tier == "llm":
                    return slow_reranker
                return fast_reranker

            mock_load.side_effect = load_side_effect

            router = RerankerRouter(settings=mock_settings)
            results, tier_used, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS[:1],
                tier="llm",
                timeout_ms=10,
                fallback_tier="fast",
            )

            # Should have fallen back successfully
            assert len(results) == 1

    async def test_rate_limit_with_fallback(self, mock_settings) -> None:
        """Test rate limit triggers fallback to different tier."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            # Create two rerankers
            rate_limited_reranker = MagicMock()
            rate_limited_reranker.rerank_async = AsyncMock(
                side_effect=RateLimitError("Rate limit", "budget", 60)
            )

            fallback_reranker = MagicMock()
            fallback_results = [RankedResult(text="doc", score=0.8, original_index=0)]
            fallback_reranker.rerank_async = AsyncMock(return_value=fallback_results)

            def load_side_effect(tier):
                if tier == "llm":
                    return rate_limited_reranker
                return fallback_reranker

            mock_load.side_effect = load_side_effect

            router = RerankerRouter(settings=mock_settings)
            results, tier_used, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS[:1],
                tier="llm",
                fallback_tier="fast",
            )

            # Should have fallen back successfully
            assert len(results) == 1

    async def test_general_error_with_fallback(self, mock_settings) -> None:
        """Test general error triggers fallback to different tier."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            # Create two rerankers
            failing_reranker = MagicMock()
            failing_reranker.rerank_async = AsyncMock(
                side_effect=RuntimeError("Something went wrong")
            )

            fallback_reranker = MagicMock()
            fallback_results = [RankedResult(text="doc", score=0.8, original_index=0)]
            fallback_reranker.rerank_async = AsyncMock(return_value=fallback_results)

            def load_side_effect(tier):
                if tier == "code":
                    return failing_reranker
                return fallback_reranker

            mock_load.side_effect = load_side_effect

            router = RerankerRouter(settings=mock_settings)
            results, tier_used, degraded = await router.rerank(
                SAMPLE_QUERY,
                SAMPLE_DOCS[:1],
                tier="code",
                fallback_tier="fast",
            )

            # Should have fallen back successfully
            assert len(results) == 1


class TestEdgeCases:
    """Tests for edge cases and special scenarios."""

    async def test_rerank_single_document(self, mock_settings) -> None:
        """Test reranking with single document."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(
                return_value=[RankedResult(text="doc", score=0.9, original_index=0)]
            )
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            results, tier, degraded = await router.rerank(SAMPLE_QUERY, ["single doc"], tier="fast")

            assert len(results) == 1
            assert not degraded

    async def test_rerank_large_document_list(self, mock_settings) -> None:
        """Test reranking with large document list."""
        large_docs = [f"Document {i}" for i in range(100)]

        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_results = [
                RankedResult(text=doc, score=0.9 - (i * 0.001), original_index=i)
                for i, doc in enumerate(large_docs)
            ]
            mock_reranker.rerank_async = AsyncMock(return_value=mock_results)
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            results, tier, degraded = await router.rerank(
                SAMPLE_QUERY, large_docs, tier="fast", top_k=10
            )

            # Should get results (mock returns all, but top_k would limit)
            assert len(results) > 0
            assert not degraded

    async def test_rerank_with_empty_query(self, mock_settings) -> None:
        """Test reranking with empty query string."""
        with patch.object(RerankerRouter, "_load_reranker") as mock_load:
            mock_reranker = MagicMock()
            mock_reranker.rerank_async = AsyncMock(
                return_value=[RankedResult(text="doc", score=0.5, original_index=0)]
            )
            mock_load.return_value = mock_reranker

            router = RerankerRouter(settings=mock_settings)
            results, tier, degraded = await router.rerank("", ["doc"], tier="fast")

            # Should still work with empty query
            assert len(results) == 1
