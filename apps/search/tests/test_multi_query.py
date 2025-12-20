"""Tests for multi-query retriever with LLM-based query expansion and RRF fusion."""

import pytest

from src.retrieval.multi_query import (
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


def test_multi_query_config_defaults():
    """Test that MultiQueryConfig has correct defaults."""
    config = MultiQueryConfig()
    assert config.num_variations == 3
    assert config.strategies == ["paraphrase", "keyword", "stepback"]
    assert config.include_original is True
    assert config.rrf_k == 60


def test_multi_query_config_custom():
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


def test_rrf_fusion():
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


def test_rrf_fusion_single_set():
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


def test_rrf_fusion_empty_sets():
    """Test RRF fusion with empty result sets."""
    mock_retriever = MockRetriever()
    multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

    fused = multi_retriever.rrf_fusion([], top_k=10)
    assert len(fused) == 0

    fused = multi_retriever.rrf_fusion([[]], top_k=10)
    assert len(fused) == 0


def test_rrf_fusion_top_k_limit():
    """Test that RRF fusion respects top_k limit."""
    mock_retriever = MockRetriever()
    multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

    result_sets = [
        [SearchResultItem(id=f"doc{i}", score=0.9 - i * 0.1, payload={}) for i in range(10)],
    ]

    fused = multi_retriever.rrf_fusion(result_sets, top_k=3)
    assert len(fused) == 3


def test_usage_tracking():
    """Test that usage statistics are tracked and can be reset."""
    mock_retriever = MockRetriever()
    multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

    # Initial state
    usage = multi_retriever.get_usage()
    assert usage["total_cost_cents"] == 0.0
    assert usage["total_tokens"] == 0

    # Manually simulate usage
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


def test_build_expansion_prompt():
    """Test expansion prompt building."""
    mock_retriever = MockRetriever()
    config = MultiQueryConfig(num_variations=3, strategies=["paraphrase", "keyword", "stepback"])
    multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever, config=config)

    prompt = multi_retriever._build_expansion_prompt("test query")

    assert "test query" in prompt
    assert "3" in prompt
    assert "Paraphrase" in prompt
    assert "Keyword" in prompt
    assert "Step-back" in prompt


@pytest.mark.asyncio
async def test_search_fallback_on_expansion_failure(monkeypatch):
    """Test that search falls back to single query on expansion failure."""
    mock_retriever = MockRetriever()
    multi_retriever = MultiQueryRetriever(base_retriever=mock_retriever)

    # Mock expand_query to raise an exception
    async def mock_expand_error(query: str):
        raise Exception("Expansion failed")

    monkeypatch.setattr(multi_retriever, "expand_query", mock_expand_error)

    # Should fall back to single query
    query = SearchQuery(text="original query", limit=5)
    results = await multi_retriever.search(query)

    # Should have results from fallback
    assert len(results) > 0
    # All results should be marked as degraded
    for result in results:
        assert result.degraded is True
        assert "expansion failed" in result.degraded_reason.lower()
