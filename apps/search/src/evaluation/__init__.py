"""Search quality evaluation module.

This module provides benchmarks for comparing fragment-level vs turn-level
retrieval quality, measuring retrieval scores, reranking success, and
overall search quality.

Components:
    - SearchQualityMetrics: Metrics for search quality evaluation
    - CollectionComparison: Compare results between collections
    - SearchQualityBenchmark: Run search quality evaluations
"""

from src.evaluation.benchmark import (
    BenchmarkConfig,
    CollectionComparison,
    SearchQualityBenchmark,
    SearchQualityMetrics,
)

__all__ = [
    "BenchmarkConfig",
    "CollectionComparison",
    "SearchQualityBenchmark",
    "SearchQualityMetrics",
]
