"""Tests for configuration management."""

import os
from unittest.mock import patch

from tuner.config import Settings, get_settings


class TestSettings:
    """Tests for Settings class."""

    def test_default_settings(self) -> None:
        """Test default settings values."""
        settings = Settings()
        assert settings.host == "0.0.0.0"
        assert settings.port == 6177
        assert settings.debug is False
        assert settings.default_sampler == "tpe"
        assert settings.default_pruner == "hyperband"

    def test_cors_origins_default(self) -> None:
        """Test default CORS origins."""
        settings = Settings()
        assert "http://localhost:3000" in settings.cors_origins
        assert "http://localhost:8080" in settings.cors_origins

    def test_cors_origins_parses_comma_string(self) -> None:
        """Test field validator parses comma-separated string."""
        # Test the validator directly since pydantic-settings
        # may parse env vars differently
        result = Settings.parse_cors_origins("http://example.com, http://api.example.com")
        assert "http://example.com" in result
        assert "http://api.example.com" in result

    def test_cors_origins_from_json_string(self) -> None:
        """Test parsing CORS origins from JSON string."""
        with patch.dict(
            os.environ,
            {"CORS_ORIGINS": '["http://example.com", "http://api.example.com"]'},
        ):
            get_settings.cache_clear()
            settings = Settings()
            assert "http://example.com" in settings.cors_origins
            assert "http://api.example.com" in settings.cors_origins

    def test_database_url_default(self) -> None:
        """Test default database URL."""
        settings = Settings()
        assert "postgresql://" in str(settings.database_url)
        assert "localhost:6183" in str(settings.database_url)

    def test_settings_from_env(self) -> None:
        """Test loading settings from environment variables."""
        with patch.dict(
            os.environ,
            {
                "HOST": "127.0.0.1",
                "PORT": "9000",
                "DEBUG": "true",
            },
        ):
            get_settings.cache_clear()
            settings = Settings()
            assert settings.host == "127.0.0.1"
            assert settings.port == 9000
            assert settings.debug is True


class TestGetSettings:
    """Tests for get_settings function."""

    def test_get_settings_returns_settings(self) -> None:
        """Test get_settings returns a Settings instance."""
        get_settings.cache_clear()
        settings = get_settings()
        assert isinstance(settings, Settings)

    def test_get_settings_is_cached(self) -> None:
        """Test get_settings returns cached instance."""
        get_settings.cache_clear()
        settings1 = get_settings()
        settings2 = get_settings()
        assert settings1 is settings2

    def test_get_settings_cache_can_be_cleared(self) -> None:
        """Test settings cache can be cleared."""
        get_settings.cache_clear()
        settings1 = get_settings()

        # Modify env and clear cache
        with patch.dict(os.environ, {"PORT": "7777"}):
            get_settings.cache_clear()
            settings2 = get_settings()

        # Settings should be different objects
        # (though port might not differ if env wasn't picked up correctly)
        assert settings1 is not settings2
