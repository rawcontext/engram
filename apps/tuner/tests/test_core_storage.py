"""Tests for Optuna storage management."""

from unittest.mock import MagicMock, patch

from tuner.core.storage import get_storage, reset_storage


class TestGetStorage:
    """Tests for get_storage function."""

    def test_get_storage_returns_rdb_storage(self) -> None:
        """Test that get_storage returns RDBStorage instance."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            mock_settings.return_value.database_url = "postgresql://localhost:5432/optuna"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage_instance = MagicMock()
                mock_rdb_storage.return_value = mock_storage_instance

                reset_storage()  # Clear cache
                result = get_storage()

                assert result is mock_storage_instance
                mock_rdb_storage.assert_called_once()

    def test_get_storage_creates_with_correct_url(self) -> None:
        """Test that storage is created with correct database URL."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            mock_settings.return_value.database_url = "postgresql://user:pass@host:5432/db"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage_instance = MagicMock()
                mock_rdb_storage.return_value = mock_storage_instance

                reset_storage()
                get_storage()

                # Check that RDBStorage was called with correct URL
                call_args = mock_rdb_storage.call_args
                assert call_args[1]["url"] == "postgresql://user:pass@host:5432/db"

    def test_get_storage_creates_with_engine_kwargs(self) -> None:
        """Test that storage is created with correct engine kwargs."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            mock_settings.return_value.database_url = "postgresql://localhost:5432/optuna"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage_instance = MagicMock()
                mock_rdb_storage.return_value = mock_storage_instance

                reset_storage()
                get_storage()

                # Check engine kwargs
                call_args = mock_rdb_storage.call_args
                engine_kwargs = call_args[1]["engine_kwargs"]

                assert engine_kwargs["pool_size"] == 20
                assert engine_kwargs["max_overflow"] == 40
                assert engine_kwargs["pool_pre_ping"] is True
                assert engine_kwargs["pool_recycle"] == 3600

    def test_get_storage_is_cached(self) -> None:
        """Test that get_storage returns cached instance."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            mock_settings.return_value.database_url = "postgresql://localhost:5432/optuna"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage_instance = MagicMock()
                mock_rdb_storage.return_value = mock_storage_instance

                reset_storage()
                storage1 = get_storage()
                storage2 = get_storage()

                # Should return same instance
                assert storage1 is storage2

                # RDBStorage should only be called once
                assert mock_rdb_storage.call_count == 1

    def test_get_storage_converts_pydantic_dsn_to_string(self) -> None:
        """Test that Pydantic PostgresDsn is converted to string."""
        from pydantic import PostgresDsn

        with patch("tuner.core.storage.get_settings") as mock_settings:
            # Create a PostgresDsn object
            dsn = PostgresDsn("postgresql://localhost:5432/optuna")
            mock_settings.return_value.database_url = dsn

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage_instance = MagicMock()
                mock_rdb_storage.return_value = mock_storage_instance

                reset_storage()
                get_storage()

                # URL should be converted to string
                call_args = mock_rdb_storage.call_args
                url = call_args[1]["url"]
                assert isinstance(url, str)
                assert url == "postgresql://localhost:5432/optuna"

    def test_get_storage_lru_cache_maxsize_one(self) -> None:
        """Test that lru_cache has maxsize=1."""
        # This test verifies the cache behavior
        with patch("tuner.core.storage.get_settings") as mock_settings:
            mock_settings.return_value.database_url = "postgresql://localhost:5432/optuna"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage_instance = MagicMock()
                mock_rdb_storage.return_value = mock_storage_instance

                reset_storage()

                # Call multiple times
                for _ in range(5):
                    get_storage()

                # Should only create storage once due to cache
                assert mock_rdb_storage.call_count == 1

    def test_get_storage_handles_special_chars_in_url(self) -> None:
        """Test that URLs with special characters are handled correctly."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            # URL with special characters in password
            mock_settings.return_value.database_url = "postgresql://user:p@ssw0rd%21@host:5432/db"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage_instance = MagicMock()
                mock_rdb_storage.return_value = mock_storage_instance

                reset_storage()
                get_storage()

                call_args = mock_rdb_storage.call_args
                assert call_args[1]["url"] == "postgresql://user:p@ssw0rd%21@host:5432/db"


class TestResetStorage:
    """Tests for reset_storage function."""

    def test_reset_storage_clears_cache(self) -> None:
        """Test that reset_storage clears the lru_cache."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            mock_settings.return_value.database_url = "postgresql://localhost:5432/optuna"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage_instance1 = MagicMock()
                mock_storage_instance2 = MagicMock()

                # First call will return instance1, second will return instance2
                mock_rdb_storage.side_effect = [mock_storage_instance1, mock_storage_instance2]

                reset_storage()
                storage1 = get_storage()

                reset_storage()  # Clear cache
                storage2 = get_storage()

                # Should be different instances because cache was cleared
                assert storage1 is not storage2
                assert mock_rdb_storage.call_count == 2

    def test_reset_storage_multiple_calls(self) -> None:
        """Test that reset_storage can be called multiple times."""
        reset_storage()
        reset_storage()
        reset_storage()
        # Should not raise

    def test_reset_storage_before_first_get(self) -> None:
        """Test that reset_storage works before get_storage is called."""
        reset_storage()  # Should not raise even if cache is empty


class TestStorageIntegration:
    """Integration tests for storage with real Optuna (mocked DB)."""

    def test_storage_creation_flow(self) -> None:
        """Test the complete flow of creating storage."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            from pydantic import PostgresDsn

            mock_settings.return_value.database_url = PostgresDsn(
                "postgresql://optuna:optuna@localhost:5432/optuna"
            )

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage = MagicMock()
                mock_rdb_storage.return_value = mock_storage

                reset_storage()
                storage = get_storage()

                # Verify storage was created correctly
                assert storage is mock_storage

                # Verify it used the settings
                mock_settings.assert_called()

                # Verify RDBStorage was called with correct params
                assert mock_rdb_storage.called
                call_kwargs = mock_rdb_storage.call_args[1]
                assert "url" in call_kwargs
                assert "engine_kwargs" in call_kwargs

    def test_storage_reuse_across_modules(self) -> None:
        """Test that storage can be reused across module imports."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            mock_settings.return_value.database_url = "postgresql://localhost:5432/optuna"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage = MagicMock()
                mock_rdb_storage.return_value = mock_storage

                reset_storage()

                # Simulate multiple imports getting storage
                storage1 = get_storage()
                storage2 = get_storage()
                storage3 = get_storage()

                # All should be same instance
                assert storage1 is storage2 is storage3

                # RDBStorage created only once
                assert mock_rdb_storage.call_count == 1

    def test_storage_engine_kwargs_support_pooling(self) -> None:
        """Test that engine kwargs support distributed optimization."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            mock_settings.return_value.database_url = "postgresql://localhost:5432/optuna"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                reset_storage()
                get_storage()

                # Get the engine_kwargs that were passed
                call_kwargs = mock_rdb_storage.call_args[1]
                engine_kwargs = call_kwargs["engine_kwargs"]

                # Verify pooling configuration for distributed workloads
                assert engine_kwargs["pool_size"] > 0
                assert engine_kwargs["max_overflow"] > 0
                assert engine_kwargs["pool_pre_ping"] is True
                assert engine_kwargs["pool_recycle"] > 0

    def test_storage_settings_change_after_cache(self) -> None:
        """Test behavior when settings change after storage is cached."""
        with patch("tuner.core.storage.get_settings") as mock_settings:
            # First settings
            mock_settings.return_value.database_url = "postgresql://localhost:5432/db1"

            with patch("optuna.storages.RDBStorage") as mock_rdb_storage:
                mock_storage1 = MagicMock()
                mock_storage2 = MagicMock()
                mock_rdb_storage.side_effect = [mock_storage1, mock_storage2]

                reset_storage()
                storage1 = get_storage()

                # Change settings
                mock_settings.return_value.database_url = "postgresql://localhost:5432/db2"

                # Without reset, still returns cached storage
                storage2 = get_storage()
                assert storage1 is storage2

                # After reset, uses new settings
                reset_storage()
                storage3 = get_storage()
                assert storage1 is not storage3
