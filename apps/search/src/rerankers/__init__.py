"""Reranking implementations for search results.

This module provides multiple reranking tiers:
- Fast: FlashRank for low-latency reranking (~10ms)
- Accurate: Cross-encoder with BGE for higher quality (~50ms)
- Code: Specialized cross-encoder for code snippets
- ColBERT: Late interaction MaxSim reranking (~30ms)
- LLM: Listwise reranking with LLMs (~500ms, rate-limited)
"""

from src.rerankers.base import BaseReranker, RankedResult
from src.rerankers.colbert import ColBERTReranker
from src.rerankers.cross_encoder import CrossEncoderReranker
from src.rerankers.flash import FlashRankReranker
from src.rerankers.llm import LLMReranker
from src.rerankers.router import RerankerRouter, RerankerTier

__all__ = [
    "BaseReranker",
    "RankedResult",
    "FlashRankReranker",
    "CrossEncoderReranker",
    "ColBERTReranker",
    "LLMReranker",
    "RerankerRouter",
    "RerankerTier",
]
