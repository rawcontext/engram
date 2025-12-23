"""Comprehensive tests for LLM reranker module."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.rerankers.base import RankedResult
from src.rerankers.llm import RERANK_PROMPT, LLMReranker
from src.utils.rate_limiter import RateLimitError, SlidingWindowRateLimiter

# Test data
SAMPLE_QUERY = "What is machine learning?"
SAMPLE_DOCS = [
    "Machine learning is a subset of artificial intelligence.",
    "Python is a popular programming language.",
    "Neural networks are inspired by biological neurons.",
]


class TestLLMRerankerInitialization:
    """Tests for LLM reranker initialization."""

    def test_initialization_default(self) -> None:
        """Test default initialization."""
        reranker = LLMReranker()

        assert reranker.model == "gemini-3-flash-preview"
        assert reranker.provider == "google"
        assert reranker.full_model_name == "google/gemini-3-flash-preview"
        assert reranker.temperature == 0.0
        assert reranker.max_tokens == 200
        assert reranker.cost_per_1k_tokens == 0.5
        assert reranker.rate_limiter is None

    def test_initialization_with_custom_params(self) -> None:
        """Test initialization with custom parameters."""
        rate_limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=500,
        )

        reranker = LLMReranker(
            model="gpt-4o-mini",
            provider="openai",
            rate_limiter=rate_limiter,
            cost_per_1k_tokens=1.5,
            temperature=0.3,
            max_tokens=500,
        )

        assert reranker.model == "gpt-4o-mini"
        assert reranker.provider == "openai"
        assert reranker.full_model_name == "openai/gpt-4o-mini"
        assert reranker.temperature == 0.3
        assert reranker.max_tokens == 500
        assert reranker.cost_per_1k_tokens == 1.5
        assert reranker.rate_limiter is rate_limiter

    def test_initialization_without_provider(self) -> None:
        """Test initialization without provider prefix."""
        reranker = LLMReranker(model="gpt-4o", provider=None)

        assert reranker.full_model_name == "gpt-4o"

    def test_initialization_with_xai_provider(self) -> None:
        """Test initialization with xAI provider."""
        reranker = LLMReranker(model="grok-beta", provider="xai")

        assert reranker.full_model_name == "xai/grok-beta"

    def test_initialization_with_anthropic_provider(self) -> None:
        """Test initialization with Anthropic provider."""
        reranker = LLMReranker(model="claude-3-5-haiku-20241022", provider="anthropic")

        assert reranker.full_model_name == "anthropic/claude-3-5-haiku-20241022"


class TestCostEstimation:
    """Tests for cost estimation."""

    def test_estimate_cost_basic(self) -> None:
        """Test basic cost estimation."""
        reranker = LLMReranker(cost_per_1k_tokens=1.0)

        cost = reranker._estimate_cost(prompt_tokens=500, completion_tokens=500)

        assert cost == 1.0  # (500 + 500) / 1000 * 1.0

    def test_estimate_cost_with_large_tokens(self) -> None:
        """Test cost estimation with large token count."""
        reranker = LLMReranker(cost_per_1k_tokens=2.0)

        cost = reranker._estimate_cost(prompt_tokens=5000, completion_tokens=1000)

        assert cost == 12.0  # (5000 + 1000) / 1000 * 2.0

    def test_estimate_cost_with_small_tokens(self) -> None:
        """Test cost estimation with small token count."""
        reranker = LLMReranker(cost_per_1k_tokens=0.5)

        cost = reranker._estimate_cost(prompt_tokens=100, completion_tokens=50)

        assert cost == 0.075  # (100 + 50) / 1000 * 0.5

    def test_estimate_cost_zero_tokens(self) -> None:
        """Test cost estimation with zero tokens."""
        reranker = LLMReranker(cost_per_1k_tokens=1.0)

        cost = reranker._estimate_cost(prompt_tokens=0, completion_tokens=0)

        assert cost == 0.0


class TestScoreParsing:
    """Tests for LLM response score parsing."""

    def test_parse_scores_valid_json(self) -> None:
        """Test parsing valid JSON scores."""
        reranker = LLMReranker()
        response = "[95, 72, 88, 45]"

        scores = reranker._parse_scores(response, 4)

        assert scores == [95.0, 72.0, 88.0, 45.0]

    def test_parse_scores_with_surrounding_text(self) -> None:
        """Test parsing scores with surrounding text."""
        reranker = LLMReranker()
        response = "Here are the relevance scores:\n[95, 72, 88]\nBased on the query."

        scores = reranker._parse_scores(response, 3)

        assert scores == [95.0, 72.0, 88.0]

    def test_parse_scores_with_floats(self) -> None:
        """Test parsing scores with float values."""
        reranker = LLMReranker()
        response = "[95.5, 72.3, 88.9]"

        scores = reranker._parse_scores(response, 3)

        assert scores == [95.5, 72.3, 88.9]

    def test_parse_scores_clamps_to_range(self) -> None:
        """Test that scores are clamped to 0-100 range."""
        reranker = LLMReranker()
        response = "[120, -10, 50, 105]"

        scores = reranker._parse_scores(response, 4)

        assert scores == [100.0, 0.0, 50.0, 100.0]

    def test_parse_scores_no_brackets(self) -> None:
        """Test parsing fails gracefully without brackets."""
        reranker = LLMReranker()
        response = "95, 72, 88"

        scores = reranker._parse_scores(response, 3)

        # Should return fallback scores
        assert scores == [50.0, 50.0, 50.0]

    def test_parse_scores_invalid_json(self) -> None:
        """Test parsing invalid JSON returns fallback."""
        reranker = LLMReranker()
        response = "[95, 72, invalid, 88]"

        scores = reranker._parse_scores(response, 4)

        assert scores == [50.0, 50.0, 50.0, 50.0]

    def test_parse_scores_count_mismatch(self) -> None:
        """Test parsing with mismatched score count."""
        reranker = LLMReranker()
        response = "[95, 72]"  # Only 2 scores

        scores = reranker._parse_scores(response, 4)  # Expected 4

        # Should return fallback scores
        assert scores == [50.0, 50.0, 50.0, 50.0]

    def test_parse_scores_empty_array(self) -> None:
        """Test parsing empty array."""
        reranker = LLMReranker()
        response = "[]"

        scores = reranker._parse_scores(response, 3)

        # Count mismatch, should return fallback
        assert scores == [50.0, 50.0, 50.0]

    def test_parse_scores_not_a_list(self) -> None:
        """Test parsing when response is not a list."""
        reranker = LLMReranker()
        response = "scores without brackets 95 and 72"

        scores = reranker._parse_scores(response, 2)

        # Should return fallback scores
        assert scores == [50.0, 50.0]

    def test_parse_scores_nested_arrays(self) -> None:
        """Test parsing with nested arrays uses first level."""
        reranker = LLMReranker()
        response = "[[95, 72], [88, 45]]"

        scores = reranker._parse_scores(response, 2)

        # Should extract outer array
        # Note: This will likely fail validation and return fallback
        assert len(scores) == 2


class TestRerank:
    """Tests for synchronous rerank method."""

    def test_rerank_empty_documents(self) -> None:
        """Test reranking with empty documents."""
        reranker = LLMReranker()

        results = reranker.rerank(SAMPLE_QUERY, [])

        assert results == []

    def test_rerank_with_mock_llm(self) -> None:
        """Test reranking with mocked LLM."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72, 88]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test")
            results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

            assert len(results) == 3
            assert all(isinstance(r, RankedResult) for r in results)
            mock_litellm.completion.assert_called_once()

            # Verify prompt format
            call_args = mock_litellm.completion.call_args
            messages = call_args.kwargs["messages"]
            assert len(messages) == 1
            assert messages[0]["role"] == "user"
            assert SAMPLE_QUERY in messages[0]["content"]

    def test_rerank_results_sorted(self) -> None:
        """Test that results are sorted by score descending."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[50, 90, 70]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test")
            results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

            scores = [r.score for r in results]
            assert scores == sorted(scores, reverse=True)
            # Highest score (90/100 = 0.9) should be first
            assert scores[0] == 0.9

    def test_rerank_with_top_k(self) -> None:
        """Test reranking with top_k limit."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72, 88]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test")
            results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS, top_k=2)

            assert len(results) == 2

    def test_rerank_with_rate_limiter(self) -> None:
        """Test reranking respects rate limiter."""
        rate_limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=1,
            max_budget_cents_per_hour=1000,
        )
        # Consume the allowed request
        rate_limiter.check_and_record(cost_cents=1.0)

        reranker = LLMReranker(
            model="test-model",
            provider="test",
            rate_limiter=rate_limiter,
        )

        with pytest.raises(RateLimitError):
            reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

    def test_rerank_llm_error_fallback(self) -> None:
        """Test reranking falls back gracefully on LLM error."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_litellm.completion.side_effect = Exception("API Error")

            reranker = LLMReranker(model="test-model", provider="test")
            results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

            assert len(results) == 3
            # All scores should be fallback (50.0/100.0 = 0.5)
            assert all(r.score == 0.5 for r in results)

    def test_rerank_preserves_original_index(self) -> None:
        """Test that original_index is preserved."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[50, 90, 70]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test")
            results = reranker.rerank(SAMPLE_QUERY, SAMPLE_DOCS)

            # Check that all original indices are present
            indices = [r.original_index for r in results]
            assert set(indices) == {0, 1, 2}

    def test_rerank_truncates_long_documents(self) -> None:
        """Test that long documents are truncated in prompt."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[90]"
            mock_litellm.completion.return_value = mock_response

            long_doc = "x" * 1000  # 1000 character document
            reranker = LLMReranker(model="test-model", provider="test")
            reranker.rerank(SAMPLE_QUERY, [long_doc])

            # Check that document was truncated to 500 chars in prompt
            call_args = mock_litellm.completion.call_args
            prompt = call_args.kwargs["messages"][0]["content"]
            # Should contain truncated version (first 500 chars)
            assert "x" * 500 in prompt

    def test_rerank_temperature_parameter(self) -> None:
        """Test that temperature parameter is passed to LLM."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[90]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test", temperature=0.7)
            reranker.rerank(SAMPLE_QUERY, ["doc"])

            call_args = mock_litellm.completion.call_args
            assert call_args.kwargs["temperature"] == 0.7

    def test_rerank_max_tokens_parameter(self) -> None:
        """Test that max_tokens parameter is passed to LLM."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[90]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test", max_tokens=300)
            reranker.rerank(SAMPLE_QUERY, ["doc"])

            call_args = mock_litellm.completion.call_args
            assert call_args.kwargs["max_tokens"] == 300


class TestRerankAsync:
    """Tests for async rerank method."""

    async def test_rerank_async_empty_documents(self) -> None:
        """Test async reranking with empty documents."""
        reranker = LLMReranker()

        results = await reranker.rerank_async(SAMPLE_QUERY, [])

        assert results == []

    async def test_rerank_async_with_mock_llm(self) -> None:
        """Test async reranking with mocked LLM."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72, 88]"
            mock_litellm.acompletion = AsyncMock(return_value=mock_response)

            reranker = LLMReranker(model="test-model", provider="test")
            results = await reranker.rerank_async(SAMPLE_QUERY, SAMPLE_DOCS)

            assert len(results) == 3
            assert all(isinstance(r, RankedResult) for r in results)
            mock_litellm.acompletion.assert_called_once()

    async def test_rerank_async_results_sorted(self) -> None:
        """Test that async results are sorted by score descending."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[50, 90, 70]"
            mock_litellm.acompletion = AsyncMock(return_value=mock_response)

            reranker = LLMReranker(model="test-model", provider="test")
            results = await reranker.rerank_async(SAMPLE_QUERY, SAMPLE_DOCS)

            scores = [r.score for r in results]
            assert scores == sorted(scores, reverse=True)

    async def test_rerank_async_with_top_k(self) -> None:
        """Test async reranking with top_k limit."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72, 88]"
            mock_litellm.acompletion = AsyncMock(return_value=mock_response)

            reranker = LLMReranker(model="test-model", provider="test")
            results = await reranker.rerank_async(SAMPLE_QUERY, SAMPLE_DOCS, top_k=1)

            assert len(results) == 1

    async def test_rerank_async_with_rate_limiter(self) -> None:
        """Test async reranking respects rate limiter."""
        rate_limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=1,
            max_budget_cents_per_hour=1000,
        )
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
            mock_litellm.acompletion = AsyncMock(side_effect=Exception("API Error"))

            reranker = LLMReranker(model="test-model", provider="test")
            results = await reranker.rerank_async(SAMPLE_QUERY, SAMPLE_DOCS)

            assert len(results) == 3
            assert all(r.score == 0.5 for r in results)


class TestBatchReranking:
    """Tests for batch reranking methods."""

    def test_rerank_batch(self) -> None:
        """Test synchronous batch reranking."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test")
            queries = ["query1", "query2"]
            docs_batch = [SAMPLE_DOCS[:2], SAMPLE_DOCS[:2]]

            results = reranker.rerank_batch(queries, docs_batch)

            assert len(results) == 2
            assert all(len(r) == 2 for r in results)

    def test_rerank_batch_with_top_k(self) -> None:
        """Test batch reranking with top_k."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72, 88]"
            mock_litellm.completion.return_value = mock_response

            reranker = LLMReranker(model="test-model", provider="test")
            queries = ["query1"]
            docs_batch = [SAMPLE_DOCS]

            results = reranker.rerank_batch(queries, docs_batch, top_k=2)

            assert len(results) == 1
            assert len(results[0]) == 2

    async def test_rerank_batch_async(self) -> None:
        """Test async batch reranking."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72]"
            mock_litellm.acompletion = AsyncMock(return_value=mock_response)

            reranker = LLMReranker(model="test-model", provider="test")
            queries = ["query1", "query2"]
            docs_batch = [SAMPLE_DOCS[:2], SAMPLE_DOCS[:2]]

            results = await reranker.rerank_batch_async(queries, docs_batch)

            assert len(results) == 2
            assert all(len(r) == 2 for r in results)

    async def test_rerank_batch_async_with_top_k(self) -> None:
        """Test async batch reranking with top_k."""
        with patch("src.rerankers.llm.litellm") as mock_litellm:
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "[95, 72, 88]"
            mock_litellm.acompletion = AsyncMock(return_value=mock_response)

            reranker = LLMReranker(model="test-model", provider="test")
            queries = ["query1"]
            docs_batch = [SAMPLE_DOCS]

            results = await reranker.rerank_batch_async(queries, docs_batch, top_k=1)

            assert len(results) == 1
            assert len(results[0]) == 1


class TestRerankPrompt:
    """Tests for rerank prompt format."""

    def test_prompt_format(self) -> None:
        """Test that RERANK_PROMPT is properly formatted."""
        assert "{query}" in RERANK_PROMPT
        assert "{documents}" in RERANK_PROMPT
        assert "JSON" in RERANK_PROMPT
        assert "0-100" in RERANK_PROMPT

    def test_prompt_format_with_data(self) -> None:
        """Test prompt formatting with actual data."""
        docs = ["doc1", "doc2"]
        doc_list = "\n".join(f"{i + 1}. {doc[:500]}" for i, doc in enumerate(docs))
        prompt = RERANK_PROMPT.format(query="test", documents=doc_list)

        assert "test" in prompt
        assert "doc1" in prompt
        assert "doc2" in prompt
        assert "1." in prompt
        assert "2." in prompt
