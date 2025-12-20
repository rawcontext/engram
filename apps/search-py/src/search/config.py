"""Configuration management using Pydantic Settings."""

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server
    search_host: str = Field(default="0.0.0.0", description="Server host")
    search_port: int = Field(default=5002, description="Server port")
    search_workers: int = Field(default=1, description="Number of worker processes")
    debug: bool = Field(default=False, description="Enable debug mode")

    # Qdrant
    qdrant_url: str = Field(default="http://localhost:6333", description="Qdrant server URL")
    qdrant_collection: str = Field(
        default="engram_memory", description="Qdrant collection name"
    )
    qdrant_timeout: int = Field(default=30, description="Qdrant request timeout in seconds")
    qdrant_grpc_port: int | None = Field(default=None, description="Qdrant gRPC port (optional)")
    qdrant_prefer_grpc: bool = Field(
        default=False, description="Prefer gRPC over HTTP for better performance"
    )

    # Search defaults (to be used in Phase 4)
    search_default_limit: int = Field(default=10, description="Default search result limit")
    search_max_limit: int = Field(default=100, description="Maximum search result limit")
    search_min_score_dense: float = Field(
        default=0.75, description="Minimum score for dense retrieval"
    )
    search_min_score_sparse: float = Field(
        default=0.1, description="Minimum score for sparse retrieval"
    )
    search_min_score_hybrid: float = Field(
        default=0.5, description="Minimum score for hybrid retrieval"
    )
    search_rerank_depth: int = Field(default=30, description="Number of results to rerank")

    # Embedders
    embedder_device: str = Field(
        default="cpu", description="Device for embedder inference: cpu, cuda, mps"
    )
    embedder_text_model: str = Field(
        default="BAAI/bge-base-en-v1.5", description="Dense text embedding model"
    )
    embedder_code_model: str = Field(
        default="nomic-ai/nomic-embed-text-v1.5", description="Code-specific embedding model"
    )
    embedder_sparse_model: str = Field(
        default="naver/splade-cocondenser-ensembledistil",
        description="Sparse embedding model (SPLADE)",
    )
    embedder_colbert_model: str = Field(
        default="colbert-ir/colbertv2.0", description="ColBERT late interaction model"
    )
    embedder_batch_size: int = Field(default=32, description="Batch size for embedding")
    embedder_cache_size: int = Field(default=10000, description="Embedding cache size (LRU)")
    embedder_cache_ttl: int = Field(
        default=3600, description="Embedding cache TTL in seconds"
    )
    embedder_preload: bool = Field(
        default=True, description="Preload models during startup"
    )

    # Reranker settings (Phase 2b)
    reranker_fast_model: str = Field(
        default="ms-marco-TinyBERT-L-2-v2", description="FlashRank fast tier model"
    )
    reranker_accurate_model: str = Field(
        default="BAAI/bge-reranker-v2-m3", description="Accurate tier cross-encoder model"
    )
    reranker_code_model: str = Field(
        default="jinaai/jina-reranker-v2-base-multilingual",
        description="Code-specific reranker model",
    )
    reranker_colbert_model: str = Field(
        default="colbert-ir/colbertv2.0", description="ColBERT late interaction model"
    )
    reranker_llm_model: str = Field(
        default="grok-4-1-fast-reasoning", description="LLM model for listwise reranking"
    )
    reranker_llm_provider: str = Field(
        default="xai", description="LLM provider (openai, anthropic, xai, etc.)"
    )
    reranker_batch_size: int = Field(default=16, description="Batch size for reranking")
    reranker_timeout_ms: int = Field(
        default=500, description="Timeout for reranking in milliseconds"
    )

    # Rate limiting (Phase 2b)
    rate_limit_requests_per_hour: int = Field(
        default=100, description="Max LLM reranker requests per hour"
    )
    rate_limit_budget_cents: int = Field(
        default=1000, description="Max budget in cents per hour for LLM reranking"
    )

    # CORS
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://localhost:5000"],
        description="Allowed CORS origins",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        """Parse CORS origins from environment variable.

        Supports comma-separated strings or JSON arrays.
        """
        if isinstance(v, str):
            # Handle JSON-encoded list from env var
            if v.startswith("["):
                import json

                parsed = json.loads(v)
                if not isinstance(parsed, list):
                    raise ValueError("CORS origins must be a list")
                return parsed
            return [origin.strip() for origin in v.split(",")]
        return v


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance.

    Uses lru_cache to ensure settings are loaded only once.
    """
    return Settings()
