"""Tests for reranker implementations."""

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.rerankers import (
    CrossEncoderReranker,
    FlashRankReranker,
    LLMReranker,
    RankedResult,
    RerankerRouter,
)
from src.utils.rate_limiter import RateLimitError, SlidingWindowRateLimiter

# Test data
SAMPLE_QUERY = "What is the capital of France?"
SAMPLE_DOCS = [
    "Paris is the capital and most populous city of France.",
    "London is the capital of England and the United Kingdom.",
    "Berlin is the capital and largest city of Germany.",
    "The weather today is sunny with clear skies.",
]


@pytest.fixture
def mock_cross_encoder():
    """Mock CrossEncoder model to avoid loading real models in CI."""
    with patch("src.rerankers.cross_encoder.CrossEncoder") as mock_cls:
        mock_model = MagicMock()
        mock_model.device = "cpu"
        # Return scores that put Paris first (highest score)
        mock_model.predict = MagicMock(
            side_effect=lambda pairs, **kwargs: np.array(
                [0.9 - i * 0.1 for i in range(len(pairs))]
            )
        )
        mock_cls.return_value = mock_model
        yield mock_model


class TestFlashRankReranker:
    """Tests for FlashRank reranker."""

    def test_initialization(self) -> None:
        """Test FlashRank reranker initialization."""
        reranker = FlashRankReranker()
        assert reranker.model_name == "ms-marco-TinyBERT-L-2-v2"
        assert reranker.ranker is not None

    def test_rerank_returns_results(self) -> None:
        """Test that rerank returns ranked results."""
        reranker = FlashRankReranker()
        results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

        assert len(results) == len(SAMPLE_DOCS)
        assert all(isinstance(r, RankedResult) for r in results)
        assert all(hasattr(r, "text") and hasattr(r, "score") for r in results)

    def test_rerank_scores_are_sorted(self) -> None:
        """Test that results are sorted by score descending."""
        reranker = FlashRankReranker()
        results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_rerank_with_top_k(self) -> None:
        """Test reranking with top_k limit."""
        reranker = FlashRankReranker()
        results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS, top_k=2)

        assert len(results) == 2

    def test_rerank_empty_documents(self) -> None:
        """Test reranking with empty document list."""
        reranker = FlashRankReranker()
        results = reranker.rerank(SAMPLE_QUERY, [])

        assert results == []

    async def test_rerank_async(self) -> None:
        """Test async reranking."""
        reranker = FlashRankReranker()
        results = await reranker.rerank_async(SAMPLE_QUERY, SAMPLE_DOCS)

        assert len(results) == len(SAMPLE_DOCS)
        assert all(isinstance(r, RankedResult) for r in results)

    async def test_rerank_batch_async(self) -> None:
        """Test async batch reranking."""
        reranker = FlashRankReranker()
        queries = [SAMPLE_QUERY, "What is the capital of Germany?"]
        docs_batch = [SAMPLE_DOCS, SAMPLE_DOCS]

        results = await reranker.rerank_batch_async(queries, docs_batch)

        assert len(results) == 2
        assert all(len(r) == len(SAMPLE_DOCS) for r in results)


class TestCrossEncoderReranker:
    """Tests for CrossEncoder reranker."""

    def test_initialization(self, mock_cross_encoder: MagicMock) -> None:
        """Test CrossEncoder reranker initialization."""
        reranker = CrossEncoderReranker(
            model_name="cross-encoder/ms-marco-MiniLM-L-2-v2",
            device="cpu",
            batch_size=4,
        )
        assert reranker.model_name == "cross-encoder/ms-marco-MiniLM-L-2-v2"
        assert reranker.batch_size == 4
        assert reranker.model is not None

    def test_rerank_returns_results(self, mock_cross_encoder: MagicMock) -> None:
        """Test that rerank returns ranked results."""
        reranker = CrossEncoderReranker(
            model_name="cross-encoder/ms-marco-MiniLM-L-2-v2",
            device="cpu",
        )
        results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

        assert len(results) == len(SAMPLE_DOCS)
        assert all(isinstance(r, RankedResult) for r in results)
        assert all(r.original_index is not None for r in results)

    def test_rerank_scores_are_sorted(self, mock_cross_encoder: MagicMock) -> None:
        """Test that results are sorted by score descending."""
        reranker = CrossEncoderReranker(
            model_name="cross-encoder/ms-marco-MiniLM-L-2-v2",
            device="cpu",
        )
        results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_rerank_with_top_k(self, mock_cross_encoder: MagicMock) -> None:
        """Test reranking with top_k limit."""
        reranker = CrossEncoderReranker(
            model_name="cross-encoder/ms-marco-MiniLM-L-2-v2",
            device="cpu",
        )
        results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS, top_k=2)

        assert len(results) == 2

    async def test_rerank_async(self, mock_cross_encoder: MagicMock) -> None:
        """Test async reranking."""
        reranker = CrossEncoderReranker(
            model_name="cross-encoder/ms-marco-MiniLM-L-2-v2",
            device="cpu",
        )
        results = await reranker.rerank_async(SAMPLE_QUERY, SAMPLE_DOCS)

        assert len(results) == len(SAMPLE_DOCS)

    def test_rerank_batch(self, mock_cross_encoder: MagicMock) -> None:
        """Test batch reranking."""
        reranker = CrossEncoderReranker(
            model_name="cross-encoder/ms-marco-MiniLM-L-2-v2",
            device="cpu",
            batch_size=8,
        )
        queries = [SAMPLE_QUERY, "What is the capital of Germany?"]
        docs_batch = [SAMPLE_DOCS[:2], SAMPLE_DOCS[:2]]

        results = reranker.rerank_batch(queries, docs_batch)

        assert len(results) == 2
        assert all(len(r) == 2 for r in results)


class TestRateLimiter:
    """Tests for rate limiter."""

    def test_rate_limiter_allows_requests(self) -> None:
        """Test that rate limiter allows requests within limit."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=10,
            max_budget_cents_per_hour=100,
        )

        # Should allow first request
        limiter.check_and_record(cost_cents=5.0)

        # Should allow second request
        limiter.check_and_record(cost_cents=5.0)

        usage = limiter.get_usage()
        assert usage["request_count"] == 2
        assert usage["total_cost_cents"] == 10.0

    def test_rate_limiter_blocks_on_request_limit(self) -> None:
        """Test that rate limiter blocks on request count limit."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=2,
            max_budget_cents_per_hour=1000,
        )

        limiter.check_and_record(cost_cents=1.0)
        limiter.check_and_record(cost_cents=1.0)

        # Third request should fail
        with pytest.raises(RateLimitError) as exc_info:
            limiter.check_and_record(cost_cents=1.0)

        assert exc_info.value.limit_type == "requests"

    def test_rate_limiter_blocks_on_budget_limit(self) -> None:
        """Test that rate limiter blocks on budget limit."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=10,
        )

        limiter.check_and_record(cost_cents=5.0)

        # Second request would exceed budget
        with pytest.raises(RateLimitError) as exc_info:
            limiter.check_and_record(cost_cents=10.0)

        assert exc_info.value.limit_type == "budget"

    def test_rate_limiter_reset(self) -> None:
        """Test rate limiter reset."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=10,
            max_budget_cents_per_hour=100,
        )

        limiter.check_and_record(cost_cents=50.0)
        usage = limiter.get_usage()
        assert usage["request_count"] == 1

        limiter.reset()
        usage = limiter.get_usage()
        assert usage["request_count"] == 0
        assert usage["total_cost_cents"] == 0.0


class TestLLMReranker:
    """Tests for LLM reranker."""

    def test_initialization(self) -> None:
        """Test LLM reranker initialization."""
        reranker = LLMReranker(
            model="gpt-4o-mini",
            provider="openai",
        )
        assert reranker.model == "gpt-4o-mini"
        assert reranker.provider == "openai"
        assert reranker.full_model_name == "openai/gpt-4o-mini"

    def test_initialization_without_provider(self) -> None:
        """Test LLM reranker initialization without provider prefix."""
        reranker = LLMReranker(
            model="gpt-4o-mini",
            provider=None,
        )
        assert reranker.full_model_name == "gpt-4o-mini"

    def test_parse_scores_valid(self) -> None:
        """Test parsing valid scores from LLM response."""
        reranker = LLMReranker()
        response = "[95, 72, 88, 45]"
        scores = reranker._parse_scores(response, 4)

        assert scores == [95.0, 72.0, 88.0, 45.0]

    def test_parse_scores_with_text(self) -> None:
        """Test parsing scores with surrounding text."""
        reranker = LLMReranker()
        response = "Here are the scores:\n[95, 72, 88, 45]\nThese are based on relevance."
        scores = reranker._parse_scores(response, 4)

        assert scores == [95.0, 72.0, 88.0, 45.0]

    def test_parse_scores_invalid_fallback(self) -> None:
        """Test parsing invalid response returns fallback scores."""
        reranker = LLMReranker()
        response = "Invalid response without JSON array"
        scores = reranker._parse_scores(response, 4)

        # Should return uniform fallback scores
        assert scores == [50.0, 50.0, 50.0, 50.0]

    def test_parse_scores_clamps_to_range(self) -> None:
        """Test that scores are clamped to 0-100 range."""
        reranker = LLMReranker()
        response = "[120, -10, 50]"
        scores = reranker._parse_scores(response, 3)

        assert scores == [100.0, 0.0, 50.0]

    def test_rate_limiter_integration(self) -> None:
        """Test LLM reranker with rate limiter."""
        rate_limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=1,
            max_budget_cents_per_hour=1000,
        )
        reranker = LLMReranker(
            model="gpt-4o-mini",
            provider="openai",
            rate_limiter=rate_limiter,
        )

        # First request should work (but might fail due to API)
        # We just test that rate limiter is checked
        assert reranker.rate_limiter is rate_limiter

    def test_estimate_cost(self) -> None:
        """Test cost estimation."""
        reranker = LLMReranker(cost_per_1k_tokens=1.0)
        cost = reranker._estimate_cost(prompt_tokens=500, completion_tokens=500)
        assert cost == 1.0  # (500 + 500) / 1000 * 1.0

    def test_parse_scores_count_mismatch(self) -> None:
        """Test parsing scores with wrong count returns fallback."""
        reranker = LLMReranker()
        response = "[95, 72]"  # Only 2 scores but we expect 4
        scores = reranker._parse_scores(response, 4)
        # Should return uniform fallback scores
        assert scores == [50.0, 50.0, 50.0, 50.0]

    def test_parse_scores_not_a_list(self) -> None:
        """Test parsing scores when response is not a list."""
        reranker = LLMReranker()
        # No brackets at all - should fail
        response = "scores: 95, 72"
        scores = reranker._parse_scores(response, 2)
        # Should return uniform fallback scores
        assert scores == [50.0, 50.0]

    def test_rerank_with_mock_litellm(self) -> None:
        """Test reranking with mocked litellm."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72, 88, 45]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test")
            results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

            assert len(results) == 4
            mock_litellm.completion.assert_called_once()
            # Results should be sorted by score
            scores = [r.score for r in results]
            assert scores == sorted(scores, reverse=True)

    def test_rerank_empty_documents(self) -> None:
        """Test reranking with empty documents."""
        reranker = LLMReranker()
        results = reranker.rerank(SAMPLE_QUERY, [])
        assert results == []

    def test_rerank_with_top_k(self) -> None:
        """Test reranking with top_k limit."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72, 88, 45]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test")
            results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS, top_k=2)

            assert len(results) == 2

    def test_rerank_rate_limit_exceeded(self) -> None:
        """Test reranking when rate limit is exceeded."""
        rate_limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=1,
            max_budget_cents_per_hour=1000,
        )
        # Consume the one allowed request
        rate_limiter.check_and_record(cost_cents=1.0)

        reranker = LLMReranker(
            model="test-model",
            provider="test",
            rate_limiter=rate_limiter,
        )

        with pytest.raises(RateLimitError):
            reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

    def test_rerank_llm_error_fallback(self) -> None:
        """Test reranking falls back on LLM error."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_litellm.completion.side_effect = Exception("API Error")

            reranker = LLMReranker(model="test-model", provider="test")
            results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

            # Should return uniform fallback scores (50.0 each)
            assert len(results) == 4
            # All scores should be 0.5 (50.0/100.0)
            assert all(r.score == 0.5 for r in results)

    async def test_rerank_async_with_mock(self) -> None:
        """Test async reranking with mocked litellm."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72, 88, 45]"
            mock_litellm.acompletion = MagicMock(return_value=mock_response)

            reranker = LLMReranker(model="test-model", provider="test")
            results = await reranker.rerank_async(SAMPLE_QUERY, SAMPLE_DOCS)

            assert len(results) == 4

    async def test_rerank_async_empty(self) -> None:
        """Test async reranking with empty documents."""
        reranker = LLMReranker()
        results = await reranker.rerank_async(SAMPLE_QUERY, [])
        assert results == []

    async def test_rerank_async_rate_limit_exceeded(self) -> None:
        """Test async reranking when rate limit is exceeded."""
        rate_limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=1,
            max_budget_cents_per_hour=1000,
        )
        # Consume the one allowed request
        rate_limiter.check_and_record(cost_cents=1.0)

        reranker = LLMReranker(
            model="test-model",
            provider="test",
            rate_limiter=rate_limiter,
        )

        with pytest.raises(RateLimitError):
            await reranker.rerank_async(SAMPLE_QUERY, SAMPLE_DOCS)

    async def test_rerank_async_llm_error_fallback(self) -> None:
        """Test async reranking falls back on LLM error."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_litellm.acompletion = MagicMock(side_effect=Exception("API Error"))

            reranker = LLMReranker(model="test-model", provider="test")
            results = await reranker.rerank_async(SAMPLE_QUERY, SAMPLE_DOCS)

            assert len(results) == 4
            assert all(r.score == 0.5 for r in results)

    def test_rerank_batch(self) -> None:
        """Test batch reranking."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test")
            queries = [SAMPLE_QUERY, "Another query"]
            docs_batch = [SAMPLE_DOCS[:2], SAMPLE_DOCS[:2]]

            results = reranker.rerank_batch(queries, docs_batch)

            assert len(results) == 2
            assert all(len(r) == 2 for r in results)

    async def test_rerank_batch_async(self) -> None:
        """Test async batch reranking."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72]"
            mock_litellm.acompletion = MagicMock(return_value=mock_response)

            reranker = LLMReranker(model="test-model", provider="test")
            queries = [SAMPLE_QUERY, "Another query"]
            docs_batch = [SAMPLE_DOCS[:2], SAMPLE_DOCS[:2]]

            results = await reranker.rerank_batch_async(queries, docs_batch)

            assert len(results) == 2


class TestRerankerRouter:
    """Tests for reranker router."""

    def test_initialization(self) -> None:
        """Test router initialization."""
        router = RerankerRouter()
        assert router.settings is not None
        assert router.llm_rate_limiter is not None
        assert router.rerankers == {}

    async def test_rerank_loads_reranker(self) -> None:
        """Test that router loads reranker on first use."""
        router = RerankerRouter()
        assert "fast" not in router.rerankers

        # This will load the fast reranker
        results, tier, degraded = await router.rerank(
            SAMPLE_QUERY,
            SAMPLE_DOCS[:2],
            tier="fast",
            timeout_ms=5000,
        )

        assert "fast" in router.rerankers
        assert tier == "fast"
        assert not degraded
        assert len(results) == 2

    async def test_rerank_with_timeout_fallback(self) -> None:
        """Test fallback on timeout."""
        router = RerankerRouter()

        # Use very short timeout to trigger fallback
        results, tier, degraded = await router.rerank(
            SAMPLE_QUERY,
            SAMPLE_DOCS,
            tier="accurate",
            timeout_ms=1,  # 1ms - guaranteed to timeout
            fallback_tier="fast",
        )

        # Should have fallen back to fast tier
        assert degraded
        # Tier might be "fast" if fallback succeeded, or "accurate" if both failed
        assert len(results) > 0

    async def test_rerank_empty_documents(self) -> None:
        """Test reranking with empty documents."""
        router = RerankerRouter()
        results, tier, degraded = await router.rerank(
            SAMPLE_QUERY,
            [],
            tier="fast",
        )

        assert results == []
        assert tier == "fast"
        assert not degraded

    async def test_rerank_batch(self) -> None:
        """Test batch reranking."""
        router = RerankerRouter()

        queries = [SAMPLE_QUERY, "What is the capital of Germany?"]
        docs_batch = [SAMPLE_DOCS[:2], SAMPLE_DOCS[:2]]

        results = await router.rerank_batch(
            queries,
            docs_batch,
            tier="fast",
            timeout_ms=5000,
        )

        assert len(results) == 2
        assert all(len(r[0]) == 2 for r in results)
        assert all(r[1] == "fast" for r in results)

    def test_get_rate_limit_usage(self) -> None:
        """Test getting rate limit usage."""
        router = RerankerRouter()
        usage = router.get_rate_limit_usage()

        assert "request_count" in usage
        assert "total_cost_cents" in usage
        assert usage["request_count"] == 0

    def test_reset_rate_limiter(self) -> None:
        """Test resetting rate limiter."""
        router = RerankerRouter()

        # Add a request
        router.llm_rate_limiter.check_and_record(cost_cents=10.0)
        usage = router.get_rate_limit_usage()
        assert usage["request_count"] == 1

        # Reset
        router.reset_rate_limiter()
        usage = router.get_rate_limit_usage()
        assert usage["request_count"] == 0
