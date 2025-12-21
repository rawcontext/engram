"""Embedder implementations for Engram search service."""

from src.embedders.base import BaseEmbedder
from src.embedders.factory import EmbedderFactory, EmbedderType

__all__ = [
    "BaseEmbedder",
    "EmbedderFactory",
    "EmbedderType",
]

# Optional local model imports (require sentence-transformers, torch, etc.)
try:
    from src.embedders.code import CodeEmbedder
    from src.embedders.colbert import ColBERTEmbedder
    from src.embedders.sparse import SparseEmbedder
    from src.embedders.text import TextEmbedder

    __all__.extend(["TextEmbedder", "CodeEmbedder", "SparseEmbedder", "ColBERTEmbedder"])
except ImportError:
    # Local ML dependencies not installed - using HuggingFace API only
    pass
