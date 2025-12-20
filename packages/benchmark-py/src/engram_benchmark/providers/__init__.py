"""
LLM and embedding providers for the benchmark suite.

This module provides unified interfaces for:
- LLM providers (via LiteLLM)
- Embedding providers (via sentence-transformers)
- Engram search service client
- Answer generation with Chain-of-Note reasoning
- Structured output parsing
"""

from engram_benchmark.providers.embeddings import EmbeddingProvider
from engram_benchmark.providers.engram import EngramSearchClient, SearchResponse, SearchResult
from engram_benchmark.providers.llm import LiteLLMProvider
from engram_benchmark.providers.reader import ChainOfNoteReader, ReaderOutput

__all__ = [
    "EmbeddingProvider",
    "EngramSearchClient",
    "LiteLLMProvider",
    "ChainOfNoteReader",
    "ReaderOutput",
    "SearchResponse",
    "SearchResult",
]
