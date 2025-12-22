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
    from src.embedders.code import CodeEmbedder  # noqa: F401
    from src.embedders.colbert import ColBERTEmbedder  # noqa: F401
    from src.embedders.sparse import SparseEmbedder  # noqa: F401
    from src.embedders.text import TextEmbedder  # noqa: F401

    __all__.extend(["TextEmbedder", "CodeEmbedder", "SparseEmbedder", "ColBERTEmbedder"])
except ImportError:
    # Local ML dependencies not installed - using HuggingFace API only
    pass
