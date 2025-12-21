"""Chunking module for turn-level document processing.

This module provides chunking strategies for splitting long documents into
semantically coherent sub-chunks while preserving context.

Components:
    - SemanticChunker: Splits text at semantic boundaries using embedding similarity
    - ChunkingConfig: Configuration for chunking thresholds and sizes
    - Chunk: Data class representing a single chunk with metadata
    - LateChunker: Context-aware chunking using late pooling (Jina AI technique)
    - ChunkBoundary: Token boundary information for late chunking
    - LateChunkResult: Result object with text, embedding, and boundaries

Usage:
    from src.chunking import SemanticChunker, ChunkingConfig, LateChunker

    # Semantic chunking
    config = ChunkingConfig(min_chunk_chars=100, similarity_threshold=0.7)
    chunker = SemanticChunker(embedder, config)
    chunks = await chunker.chunk(long_text)

    # Late chunking for context-aware embeddings
    late_chunker = LateChunker(model)
    embeddings = late_chunker.embed_chunks(full_text, chunk_texts)
"""

from src.chunking.late import ChunkBoundary, LateChunker, LateChunkResult
from src.chunking.semantic import Chunk, ChunkingConfig, SemanticChunker

__all__ = [
    "Chunk",
    "ChunkBoundary",
    "ChunkingConfig",
    "LateChunker",
    "LateChunkResult",
    "SemanticChunker",
]
