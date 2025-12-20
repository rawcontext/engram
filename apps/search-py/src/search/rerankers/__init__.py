"""Reranking implementations for search results.

This module provides multiple reranking tiers:
- Fast: FlashRank for low-latency reranking (~10ms)
- Accurate: Cross-encoder with BGE for higher quality (~50ms)
- Code: Specialized cross-encoder for code snippets
- ColBERT: Late interaction MaxSim reranking (~30ms)
- LLM: Listwise reranking with LLMs (~500ms, rate-limited)
"""

from search.rerankers.base import BaseReranker, RankedResult

__all__ = [
    "BaseReranker",
    "RankedResult",
]
