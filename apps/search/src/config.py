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
    qdrant_collection: str = Field(default="engram_memory", description="Qdrant collection name")
    qdrant_turns_collection: str = Field(
        default="engram_turns", description="Turn-level indexing collection name"
    )
    qdrant_timeout: int = Field(default=30, description="Qdrant request timeout in seconds")
    qdrant_grpc_port: int | None = Field(default=None, description="Qdrant gRPC port (optional)")
    qdrant_prefer_grpc: bool = Field(
        default=False, description="Prefer gRPC over HTTP for better performance"
    )

    # FalkorDB (for backfill scripts)
    falkordb_url: str = Field(
        default="redis://localhost:6379", description="FalkorDB connection URL"
    )

    # Kafka (for turn indexing consumer)
    kafka_bootstrap_servers: str = Field(
        default="localhost:19092", description="Kafka bootstrap servers (comma-separated)"
    )
    kafka_consumer_enabled: bool = Field(
        default=True, description="Enable Kafka consumer for turn indexing"
    )
    kafka_consumer_group: str = Field(
        default="search-turns-indexer", description="Kafka consumer group ID"
    )

    # Redis (for consumer status publishing)
    redis_url: str = Field(default="redis://localhost:6379", description="Redis URL for pub/sub")

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
    search_default_strategy: str = Field(
        default="hybrid",
        description="Default search strategy: 'dense', 'sparse', or 'hybrid'. Use 'dense' when sparse embeddings are unavailable (huggingface backend).",
    )

    # Embedders
    embedder_device: str = Field(
        default="cpu", description="Device for embedder inference: cpu, cuda, mps"
    )
    embedder_text_model: str = Field(
        default="BAAI/bge-small-en-v1.5", description="Dense text embedding model (384 dims)"
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
    embedder_cache_ttl: int = Field(default=3600, description="Embedding cache TTL in seconds")
    embedder_preload: bool = Field(default=True, description="Preload models during startup")

    # Hugging Face
    hf_api_token: str = Field(default="", description="Hugging Face API token")
    embedder_backend: str = Field(
        default="local", description="Embedder backend: local or huggingface"
    )
    reranker_backend: str = Field(
        default="local", description="Reranker backend: local or huggingface"
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
        default="gemini-3-flash-preview", description="LLM model for listwise reranking"
    )
    reranker_llm_provider: str = Field(
        default="google", description="LLM provider (openai, anthropic, google, etc.)"
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

    @field_validator("embedder_backend", "reranker_backend")
    @classmethod
    def validate_huggingface_backend(cls, v: str, info) -> str:
        """Validate Hugging Face backend configuration.

        Ensures HF_API_TOKEN is provided when using huggingface backend.
        """
        if v not in ["local", "huggingface"]:
            raise ValueError(f"Backend must be 'local' or 'huggingface', got '{v}'")

        # Check if HF_API_TOKEN is required
        if v == "huggingface":
            # Get the hf_api_token value from the values being set
            hf_token = info.data.get("hf_api_token", "")
            if not hf_token:
                raise ValueError(f"{info.field_name}=huggingface requires HF_API_TOKEN to be set")

        return v


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance.

    Uses lru_cache to ensure settings are loaded only once.
    """
    return Settings()
