"""Retrieval module for intelligent search with embeddings and reranking.

This module provides the core retrieval pipeline for Engram's search service,
including:
- Multiple search strategies (dense, sparse, hybrid)
- Reciprocal Rank Fusion for hybrid search
- Multi-tier reranking (fast, accurate, code, ColBERT, LLM)
- Graceful degradation and fallback handling
- Query complexity analysis for automatic tier selection
- Session-aware hierarchical retrieval

Example usage:
    >>> from src.retrieval import SearchQuery, SearchStrategy, RerankerTier
    >>> query = SearchQuery(
    ...     text="How do I implement bitemporal state?",
    ...     limit=10,
    ...     strategy=SearchStrategy.HYBRID,
    ...     rerank=True,
    ...     rerank_tier=RerankerTier.ACCURATE,
    ... )
"""

from src.retrieval.classifier import (
    ClassificationResult,
    QueryClassifier,
    QueryFeatures,
)
from src.retrieval.constants import (
    CODE_DENSE_FIELD,
    DEFAULT_RERANK_DEPTH,
    MIN_SCORE_DENSE,
    MIN_SCORE_HYBRID,
    MIN_SCORE_SPARSE,
    RERANK_TIMEOUT_MS,
    RRF_K,
    SPARSE_FIELD,
    TEXT_DENSE_FIELD,
)
from src.retrieval.multi_query import (
    MultiQueryConfig,
    MultiQueryRetriever,
    QueryExpansionStrategy,
)
from src.retrieval.retriever import SearchRetriever
from src.retrieval.session import (
    SessionAwareRetriever,
    SessionAwareSearchResult,
    SessionResult,
    SessionRetrieverConfig,
)
from src.retrieval.types import (
    QueryComplexity,
    RerankerTier,
    SearchFilters,
    SearchQuery,
    SearchResultItem,
    SearchStrategy,
    TimeRange,
)

__all__ = [
    # Retriever
    "SearchRetriever",
    "MultiQueryRetriever",
    # Session Retriever
    "SessionAwareRetriever",
    "SessionAwareSearchResult",
    "SessionResult",
    "SessionRetrieverConfig",
    # Classifier
    "QueryClassifier",
    "ClassificationResult",
    "QueryFeatures",
    # Types
    "SearchStrategy",
    "RerankerTier",
    "QueryComplexity",
    "SearchQuery",
    "SearchResultItem",
    "SearchFilters",
    "TimeRange",
    "QueryExpansionStrategy",
    "MultiQueryConfig",
    # Constants
    "MIN_SCORE_DENSE",
    "MIN_SCORE_SPARSE",
    "MIN_SCORE_HYBRID",
    "DEFAULT_RERANK_DEPTH",
    "RERANK_TIMEOUT_MS",
    "RRF_K",
    "TEXT_DENSE_FIELD",
    "CODE_DENSE_FIELD",
    "SPARSE_FIELD",
]
