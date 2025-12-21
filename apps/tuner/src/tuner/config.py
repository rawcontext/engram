"""Configuration management using Pydantic Settings."""

from functools import lru_cache

from pydantic import PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: PostgresDsn = PostgresDsn("postgresql://postgres:postgres@localhost:5432/optuna")

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8080"]

    # Optuna defaults
    default_sampler: str = "tpe"
    default_pruner: str = "hyperband"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            # Handle JSON-encoded list from env var
            if v.startswith("["):
                import json

                return json.loads(v)
            return [origin.strip() for origin in v.split(",")]
        return v


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
