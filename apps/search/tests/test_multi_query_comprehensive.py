"""Comprehensive tests for multi-query retriever with LLM-based query expansion and RRF fusion.

This test suite provides comprehensive coverage of MultiQueryRetriever functionality:
- Query expansion with different strategies
- RRF fusion logic
- LLM integration and error handling
- Usage tracking
- Degradation scenarios
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from src.retrieval.multi_query import (
    EXPANSION_SYSTEM_PROMPT,
    MultiQueryConfig,
    MultiQueryRetriever,
)
from src.retrieval.types import SearchQuery, SearchResultItem


class MockRetriever:
    """Mock retriever for testing multi-query functionality."""

    async def search(self, query: SearchQuery) -> list[SearchResultItem]:
        """Return mock results based on query text."""
        # Return different results for different queries
        if "original" in query.text.lower():
            return [
                SearchResultItem(
                    id="doc1", score=0.9, payload={"content": "result from original query"}
                ),
                SearchResultItem(
                    id="doc2", score=0.8, payload={"content": "second result from original"}
                ),
            ]
        elif "paraphrase" in query.text.lower():
            return [
                SearchResultItem(
                    id="doc2", score=0.85, payload={"content": "result from paraphrased query"}
                ),
                SearchResultItem(
                    id="doc3", score=0.75, payload={"content": "another paraphrase result"}
                ),
            ]
        elif "keyword" in query.text.lower():
            return [
                SearchResultItem(
                    id="doc1", score=0.88, payload={"content": "result from keyword query"}
                ),
                SearchResultItem(id="doc4", score=0.70, payload={"content": "keyword result"}),
            ]
        else:
            return [
                SearchResultItem(id="doc5", score=0.65, payload={"content": "generic result"}),
            ]


class TestMultiQueryConfig:
    """Test MultiQueryConfig validation and defaults."""

    def test_config_defaults(self) -> None:
        """Test that MultiQueryConfig has correct defaults."""
        config = MultiQueryConfig()
        assert config.num_variations == 3
        assert config.strategies == ["paraphrase", "keyword", "stepback"]
        assert config.include_original is True
        assert config.rrf_k == 60

    def test_config_custom_values(self) -> None:
        """Test that MultiQueryConfig accepts custom values."""
        config = MultiQueryConfig(
            num_variations=5,
            strategies=["paraphrase", "decompose"],
            include_original=False,
            rrf_k=100,
        )
        assert config.num_variations == 5
        assert config.strategies == ["paraphrase", "decompose"]
        assert config.include_original is False
        assert config.rrf_k == 100

    def test_config_validation_num_variations(self) -> None:
        """Test num_variations validation."""
        # Valid range: 1-10
        config = MultiQueryConfig(num_variations=1)
        assert config.num_variations == 1

        config = MultiQueryConfig(num_variations=10)
        assert config.num_variations == 10

        # Outside range should raise validation error
        with pytest.raises(ValueError):
            MultiQueryConfig(num_variations=0)

        with pytest.raises(ValueError):
            MultiQueryConfig(num_variations=11)

    def test_config_validation_rrf_k(self) -> None:
        """Test rrf_k validation."""
        config = MultiQueryConfig(rrf_k=1)
        assert config.rrf_k == 1

        # Should accept positive values
        config = MultiQueryConfig(rrf_k=120)
        assert config.rrf_k == 120


class TestRRFFusion:
    """Test Reciprocal Rank Fusion logic."""

    def test_rrf_fusion_basic(self) -> None:
        """Test RRF fusion logic."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever, config=MultiQueryConfig(rrf_k=60)
        )

        # Create mock result sets with some overlap
        result_sets = [
            [
                SearchResultItem(id="doc1", score=0.9, payload={}),
                SearchResultItem(id="doc2", score=0.8, payload={}),
                SearchResultItem(id="doc3", score=0.7, payload={}),
            ],
            [
                SearchResultItem(id="doc2", score=0.85, payload={}),
                SearchResultItem(id="doc4", score=0.75, payload={}),
                SearchResultItem(id="doc1", score=0.70, payload={}),
            ],
        ]

        fused = multi_retriever.rrf_fusion(result_sets, top_k=3)

        # Check that results are fused and sorted by RRF score
        assert len(fused) == 3

        # doc1 and doc2 appear in both sets so should have higher RRF scores
        assert fused[0].id in ["doc1", "doc2"]
        assert fused[1].id in ["doc1", "doc2"]

        # All results should have rrf_score set
        for result in fused:
            assert result.rrf_score is not None
            assert result.rrf_score > 0

    def test_rrf_fusion_score_calculation(self) -> None:
        """Test RRF score calculation formula."""
        mock_retriever = MockRetriever()
        k = 60
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever, config=MultiQueryConfig(rrf_k=k)
        )

        # Single result set to verify calculation
        result_sets = [
            [
                SearchResultItem(id="doc1", score=0.9, payload={}),
                SearchResultItem(id="doc2", score=0.8, payload={}),
            ],
        ]

        fused = multi_retriever.rrf_fusion(result_sets, top_k=2)

        # RRF score = 1 / (k + rank + 1)
        # doc1 at rank 0: 1/(60+0+1) = 1/61 ≈ 0.01639
        # doc2 at rank 1: 1/(60+1+1) = 1/62 ≈ 0.01613
        expected_score_doc1 = 1 / (k + 0 + 1)
        expected_score_doc2 = 1 / (k + 1 + 1)

        assert abs(fused[0].rrf_score - expected_score_doc1) < 0.0001
        assert abs(fused[1].rrf_score - expected_score_doc2) < 0.0001

    def test_rrf_fusion_overlap_boost(self) -> None:
        """Test that overlapping documents get boosted RRF scores."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever, config=MultiQueryConfig(rrf_k=60)
        )

        result_sets = [
            [
                SearchResultItem(id="overlap", score=0.9, payload={}),
                SearchResultItem(id="unique1", score=0.8, payload={}),
            ],
            [
                SearchResultItem(id="overlap", score=0.85, payload={}),
                SearchResultItem(id="unique2", score=0.75, payload={}),
            ],
        ]

        fused = multi_retriever.rrf_fusion(result_sets, top_k=5)

        # "overlap" should have highest RRF score (appears in both sets)
        assert fused[0].id == "overlap"

        # Its RRF score should be sum of both rankings
        k = 60
        expected_score = (1 / (k + 0 + 1)) + (1 / (k + 0 + 1))
        assert abs(fused[0].rrf_score - expected_score) < 0.0001

    def test_rrf_fusion_single_set(self) -> None:
        """Test RRF fusion with a single result set."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        result_sets = [
            [
                SearchResultItem(id="doc1", score=0.9, payload={}),
                SearchResultItem(id="doc2", score=0.8, payload={}),
            ],
        ]

        fused = multi_retriever.rrf_fusion(result_sets, top_k=2)

        assert len(fused) == 2
        assert fused[0].id == "doc1"  # Higher rank = higher RRF score
        assert fused[1].id == "doc2"

    def test_rrf_fusion_empty_sets(self) -> None:
        """Test RRF fusion with empty result sets."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        fused = multi_retriever.rrf_fusion([], top_k=10)
        assert len(fused) == 0

        fused = multi_retriever.rrf_fusion([[]], top_k=10)
        assert len(fused) == 0

    def test_rrf_fusion_top_k_limit(self) -> None:
        """Test that RRF fusion respects top_k limit."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        result_sets = [
            [SearchResultItem(id=f"doc{i}", score=0.9 - i * 0.1, payload={}) for i in range(10)],
        ]

        fused = multi_retriever.rrf_fusion(result_sets, top_k=3)
        assert len(fused) == 3

    def test_rrf_fusion_preserves_metadata(self) -> None:
        """Test that RRF fusion preserves result metadata."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        result_sets = [
            [
                SearchResultItem(
                    id="doc1",
                    score=0.9,
                    payload={"content": "test"},
                    reranker_score=0.95,
                    rerank_tier="fast",
                    degraded=True,
                    degraded_reason="test reason",
                ),
            ],
        ]

        fused = multi_retriever.rrf_fusion(result_sets, top_k=1)

        # Verify metadata is preserved
        assert fused[0].payload == {"content": "test"}
        assert fused[0].reranker_score == 0.95
        assert fused[0].rerank_tier == "fast"
        assert fused[0].degraded is True
        assert fused[0].degraded_reason == "test reason"


class TestQueryExpansion:
    """Test query expansion functionality."""

    def test_build_expansion_prompt_paraphrase(self) -> None:
        """Test expansion prompt building with paraphrase strategy."""
        mock_retriever = MockRetriever()
        config = MultiQueryConfig(num_variations=3, strategies=["paraphrase"])
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever, config=config)

        prompt = multi_retriever._build_expansion_prompt("test query")

        assert "test query" in prompt
        assert "3" in prompt
        assert "Paraphrase" in prompt

    def test_build_expansion_prompt_all_strategies(self) -> None:
        """Test expansion prompt with all strategies."""
        mock_retriever = MockRetriever()
        config = MultiQueryConfig(
            num_variations=4, strategies=["paraphrase", "keyword", "stepback", "decompose"]
        )
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever, config=config)

        prompt = multi_retriever._build_expansion_prompt("complex query")

        assert "complex query" in prompt
        assert "4" in prompt
        assert "Paraphrase" in prompt
        assert "Keyword" in prompt
        assert "Step-back" in prompt
        assert "Decompose" in prompt

    @pytest.mark.asyncio
    async def test_expand_query_llm_success(self) -> None:
        """Test successful query expansion with LLM."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever,
            config=MultiQueryConfig(include_original=True, num_variations=3),
        )

        # Mock LLM response
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps(
                        {
                            "queries": [
                                "rephrased query 1",
                                "rephrased query 2",
                                "rephrased query 3",
                            ]
                        }
                    )
                )
            )
        ]
        mock_response.usage = MagicMock(total_tokens=100, prompt_tokens=50, completion_tokens=50)

        with patch("src.retrieval.multi_query.litellm.acompletion", return_value=mock_response):
            variations = await multi_retriever.expand_query("original query")

        # Should include original + 3 variations
        assert len(variations) == 4
        assert "original query" in variations
        assert "rephrased query 1" in variations

    @pytest.mark.asyncio
    async def test_expand_query_without_original(self) -> None:
        """Test query expansion without including original."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever,
            config=MultiQueryConfig(include_original=False, num_variations=2),
        )

        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({"queries": ["query 1", "query 2"]})))
        ]
        mock_response.usage = MagicMock(total_tokens=100, prompt_tokens=50, completion_tokens=50)

        with patch("src.retrieval.multi_query.litellm.acompletion", return_value=mock_response):
            variations = await multi_retriever.expand_query("original query")

        # Should NOT include original
        assert len(variations) == 2
        assert "original query" not in variations

    @pytest.mark.asyncio
    async def test_expand_query_llm_invalid_json(self) -> None:
        """Test query expansion with invalid JSON response."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever, config=MultiQueryConfig(include_original=True)
        )

        # Mock LLM response with invalid JSON
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="not valid json"))]
        mock_response.usage = MagicMock(total_tokens=50, prompt_tokens=25, completion_tokens=25)

        with patch("src.retrieval.multi_query.litellm.acompletion", return_value=mock_response):
            variations = await multi_retriever.expand_query("test query")

        # Should fall back to just original query
        assert variations == ["test query"]

    @pytest.mark.asyncio
    async def test_expand_query_llm_failure(self) -> None:
        """Test query expansion with LLM failure."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        with patch(
            "src.retrieval.multi_query.litellm.acompletion", side_effect=Exception("LLM API failed")
        ):
            variations = await multi_retriever.expand_query("test query")

        # Should return original query only
        assert variations == ["test query"]

    @pytest.mark.asyncio
    async def test_expand_query_filters_duplicates(self) -> None:
        """Test that expansion filters out duplicate queries."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever, config=MultiQueryConfig(include_original=True)
        )

        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps(
                        {
                            "queries": [
                                "original query",  # Duplicate of original
                                "different query",
                                "another query",
                            ]
                        }
                    )
                )
            )
        ]
        mock_response.usage = MagicMock(total_tokens=100, prompt_tokens=50, completion_tokens=50)

        with patch("src.retrieval.multi_query.litellm.acompletion", return_value=mock_response):
            variations = await multi_retriever.expand_query("original query")

        # Should filter out duplicate
        assert variations.count("original query") == 1

    @pytest.mark.asyncio
    async def test_expand_query_respects_num_variations(self) -> None:
        """Test that expansion respects num_variations limit."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever,
            config=MultiQueryConfig(include_original=False, num_variations=2),
        )

        # Return more queries than num_variations
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps(
                        {"queries": ["query 1", "query 2", "query 3", "query 4", "query 5"]}
                    )
                )
            )
        ]
        mock_response.usage = MagicMock(total_tokens=100, prompt_tokens=50, completion_tokens=50)

        with patch("src.retrieval.multi_query.litellm.acompletion", return_value=mock_response):
            variations = await multi_retriever.expand_query("test query")

        # Should limit to num_variations
        assert len(variations) <= 2


class TestMultiQuerySearch:
    """Test multi-query search integration."""

    @pytest.mark.asyncio
    async def test_search_basic(self) -> None:
        """Test basic multi-query search."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever,
            config=MultiQueryConfig(include_original=True, num_variations=2),
        )

        # Mock query expansion
        async def mock_expand(query: str) -> list[str]:
            return ["original query", "paraphrase query", "keyword query"]

        with patch.object(multi_retriever, "expand_query", mock_expand):
            query = SearchQuery(text="original query", limit=5)
            results = await multi_retriever.search(query)

        # Should have fused results
        assert len(results) > 0
        assert all(isinstance(r, SearchResultItem) for r in results)

    @pytest.mark.asyncio
    async def test_search_parallel_execution(self) -> None:
        """Test that searches are executed in parallel."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        call_count = 0

        async def mock_search(query: SearchQuery) -> list[SearchResultItem]:
            nonlocal call_count
            call_count += 1
            return [SearchResultItem(id=f"doc{call_count}", score=0.9, payload={})]

        mock_retriever.search = mock_search

        async def mock_expand(query: str) -> list[str]:
            return ["query1", "query2", "query3"]

        with patch.object(multi_retriever, "expand_query", mock_expand):
            query = SearchQuery(text="test", limit=5)
            await multi_retriever.search(query)

        # All 3 queries should have been executed
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_search_per_query_limit(self) -> None:
        """Test that per-query limit is correctly calculated."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        search_limits = []

        async def mock_search(query: SearchQuery) -> list[SearchResultItem]:
            search_limits.append(query.limit)
            return []

        mock_retriever.search = mock_search

        async def mock_expand(query: str) -> list[str]:
            return ["query1", "query2"]

        with patch.object(multi_retriever, "expand_query", mock_expand):
            query = SearchQuery(text="test", limit=10)
            await multi_retriever.search(query)

        # Per-query limit should be max(limit*2, 20) = 20
        assert all(limit == 20 for limit in search_limits)

    @pytest.mark.asyncio
    async def test_search_preserves_query_params(self) -> None:
        """Test that query parameters are preserved for each variation."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        captured_queries = []

        async def mock_search(query: SearchQuery) -> list[SearchResultItem]:
            captured_queries.append(query)
            return []

        mock_retriever.search = mock_search

        async def mock_expand(query: str) -> list[str]:
            return ["query1", "query2"]

        with patch.object(multi_retriever, "expand_query", mock_expand):
            from src.retrieval.types import SearchFilters, SearchStrategy

            query = SearchQuery(
                text="test",
                limit=5,
                threshold=0.7,
                filters=SearchFilters(session_id="session-123"),
                strategy=SearchStrategy.HYBRID,
                rerank=True,
                rerank_tier="accurate",
                rerank_depth=30,
            )
            await multi_retriever.search(query)

        # All variations should preserve original query params
        for captured in captured_queries:
            assert captured.threshold == 0.7
            assert captured.filters.session_id == "session-123"
            assert captured.strategy == SearchStrategy.HYBRID
            assert captured.rerank is True
            assert captured.rerank_tier == "accurate"
            assert captured.rerank_depth == 30

    @pytest.mark.asyncio
    async def test_search_fallback_on_expansion_failure(self) -> None:
        """Test that search falls back to single query on expansion failure."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        async def mock_expand_error(query: str) -> list[str]:
            raise Exception("Expansion failed")

        with patch.object(multi_retriever, "expand_query", mock_expand_error):
            query = SearchQuery(text="original query", limit=5)
            results = await multi_retriever.search(query)

        # Should have results from fallback
        assert len(results) > 0
        # All results should be marked as degraded
        for result in results:
            assert result.degraded is True
            assert "expansion failed" in result.degraded_reason.lower()


class TestUsageTracking:
    """Test usage tracking functionality."""

    def test_usage_tracking_initial_state(self) -> None:
        """Test that usage statistics start at zero."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        usage = multi_retriever.get_usage()
        assert usage["total_cost_cents"] == 0.0
        assert usage["total_tokens"] == 0

    @pytest.mark.asyncio
    async def test_usage_tracking_accumulation(self) -> None:
        """Test that usage statistics accumulate correctly."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        # Mock LLM response with usage
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({"queries": ["q1", "q2"]})))
        ]
        mock_response.usage = MagicMock(total_tokens=1000, prompt_tokens=500, completion_tokens=500)

        with patch("src.retrieval.multi_query.litellm.acompletion", return_value=mock_response):
            await multi_retriever.expand_query("test query")

        usage = multi_retriever.get_usage()
        assert usage["total_tokens"] == 1000
        assert usage["total_cost_cents"] > 0

    def test_usage_tracking_reset(self) -> None:
        """Test that usage statistics can be reset."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        # Manually set usage
        multi_retriever.total_tokens = 1000
        multi_retriever.total_cost_cents = 0.5

        usage = multi_retriever.get_usage()
        assert usage["total_cost_cents"] == 0.5
        assert usage["total_tokens"] == 1000

        # Reset
        multi_retriever.reset_usage()
        usage = multi_retriever.get_usage()
        assert usage["total_cost_cents"] == 0.0
        assert usage["total_tokens"] == 0

    @pytest.mark.asyncio
    async def test_usage_tracking_multiple_calls(self) -> None:
        """Test that usage accumulates across multiple expansion calls."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({"queries": ["q1"]})))
        ]
        mock_response.usage = MagicMock(total_tokens=500, prompt_tokens=250, completion_tokens=250)

        with patch("src.retrieval.multi_query.litellm.acompletion", return_value=mock_response):
            await multi_retriever.expand_query("query 1")
            await multi_retriever.expand_query("query 2")

        usage = multi_retriever.get_usage()
        assert usage["total_tokens"] == 1000  # 500 * 2


class TestMultiQueryRetrieverInit:
    """Test MultiQueryRetriever initialization."""

    def test_init_default_config(self) -> None:
        """Test initialization with default config."""
        mock_retriever = MockRetriever()
        multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

        assert multi_retriever.config.num_variations == 3
        assert multi_retriever.model == "gemini-3-flash-preview"
        assert multi_retriever.total_tokens == 0

    def test_init_custom_config(self) -> None:
        """Test initialization with custom config."""
        mock_retriever = MockRetriever()
        config = MultiQueryConfig(num_variations=5, strategies=["paraphrase"])
        multi_retriever = MultiQueryRetriever(
            base_retriever=mock_retriever, config=config, model="gpt-4"
        )

        assert multi_retriever.config.num_variations == 5
        assert multi_retriever.model == "gpt-4"

    def test_init_system_prompt(self) -> None:
        """Test that EXPANSION_SYSTEM_PROMPT is properly defined."""
        assert "search query expansion" in EXPANSION_SYSTEM_PROMPT.lower()
        assert "json" in EXPANSION_SYSTEM_PROMPT.lower()
