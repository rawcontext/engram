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
