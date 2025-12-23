"""Tests for configuration module."""

import pytest

from src.config import Settings


class TestSettings:
    """Tests for Settings configuration."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        settings = Settings(
            _env_file=None,  # Don't load .env file
        )
        assert settings.search_host == "0.0.0.0"
        assert settings.search_port == 6176
        assert settings.qdrant_collection == "engram_turns"
        assert settings.embedder_backend == "local"

    def test_cors_origins_from_string(self) -> None:
        """Test parsing CORS origins from comma-separated string."""
        settings = Settings(
            _env_file=None,
            cors_origins="http://localhost:3000,http://localhost:5000",
        )
        assert settings.cors_origins == ["http://localhost:3000", "http://localhost:5000"]

    def test_cors_origins_from_json(self) -> None:
        """Test parsing CORS origins from JSON array string."""
        settings = Settings(
            _env_file=None,
            cors_origins='["http://localhost:3000", "http://localhost:5000"]',
        )
        assert settings.cors_origins == ["http://localhost:3000", "http://localhost:5000"]

    def test_cors_origins_from_list(self) -> None:
        """Test CORS origins from list directly."""
        settings = Settings(
            _env_file=None,
            cors_origins=["http://localhost:3000"],
        )
        assert settings.cors_origins == ["http://localhost:3000"]

    def test_cors_origins_invalid_json(self) -> None:
        """Test that invalid JSON for CORS origins raises an error."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="Unterminated string"):
            Settings(
                _env_file=None,
                cors_origins='["not closed',
            )

    def test_embedder_backend_invalid(self) -> None:
        """Test that invalid embedder backend raises an error."""
        with pytest.raises(ValueError, match="Backend must be"):
            Settings(
                _env_file=None,
                embedder_backend="invalid",
            )

    def test_reranker_backend_invalid(self) -> None:
        """Test that invalid reranker backend raises an error."""
        with pytest.raises(ValueError, match="Backend must be"):
            Settings(
                _env_file=None,
                reranker_backend="invalid",
            )

    def test_huggingface_backend_requires_token(self) -> None:
        """Test that huggingface backend requires API token."""
        with pytest.raises(ValueError, match="requires HF_API_TOKEN"):
            Settings(
                _env_file=None,
                embedder_backend="huggingface",
                hf_api_token="",
            )

    def test_huggingface_backend_with_token(self) -> None:
        """Test that huggingface backend works with API token."""
        settings = Settings(
            _env_file=None,
            embedder_backend="huggingface",
            hf_api_token="test-token",
        )
        assert settings.embedder_backend == "huggingface"
        assert settings.hf_api_token == "test-token"
