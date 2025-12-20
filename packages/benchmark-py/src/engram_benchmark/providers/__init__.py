"""
LLM and embedding providers for the benchmark suite.

This module provides unified interfaces for:
- LLM providers (via LiteLLM)
- Answer generation with Chain-of-Note reasoning
- Structured output parsing
"""

from engram_benchmark.providers.llm import LiteLLMProvider
from engram_benchmark.providers.reader import ChainOfNoteReader, ReaderOutput

__all__ = ["LiteLLMProvider", "ChainOfNoteReader", "ReaderOutput"]
