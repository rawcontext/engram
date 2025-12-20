"""
Extended benchmarks for embedding and retrieval evaluation.

This module provides wrappers for industry-standard benchmarks:
- MTEB (Massive Text Embedding Benchmark)
- BEIR (Benchmarking Information Retrieval)
"""

from engram_benchmark.benchmarks.beir import BEIRBenchmark, BEIRConfig, BEIRResults
from engram_benchmark.benchmarks.mteb import MTEBBenchmark, MTEBConfig, MTEBResults

__all__ = [
    "MTEBBenchmark",
    "MTEBConfig",
    "MTEBResults",
    "BEIRBenchmark",
    "BEIRConfig",
    "BEIRResults",
]
