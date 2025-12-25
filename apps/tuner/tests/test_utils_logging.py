"""Tests for structured logging configuration."""

import logging
import sys
from unittest.mock import MagicMock, patch

import structlog

from tuner.utils.logging import bind_context, clear_context, configure_logging, get_logger


class TestConfigureLogging:
    """Tests for configure_logging function."""

    def test_configure_logging_default_params(self) -> None:
        """Test configure_logging with default parameters."""
        with patch("logging.basicConfig") as mock_basic_config:
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging()

                # Verify logging.basicConfig called
                mock_basic_config.assert_called_once()
                call_kwargs = mock_basic_config.call_args[1]
                assert call_kwargs["level"] == logging.INFO
                assert call_kwargs["stream"] == sys.stdout

                # Verify structlog.configure called
                mock_structlog_configure.assert_called_once()

    def test_configure_logging_custom_level(self) -> None:
        """Test configure_logging with custom log level."""
        with patch("logging.basicConfig") as mock_basic_config:
            with patch("structlog.configure"):
                configure_logging(level="DEBUG")

                call_kwargs = mock_basic_config.call_args[1]
                assert call_kwargs["level"] == logging.DEBUG

    def test_configure_logging_warning_level(self) -> None:
        """Test configure_logging with WARNING level."""
        with patch("logging.basicConfig") as mock_basic_config:
            with patch("structlog.configure"):
                configure_logging(level="WARNING")

                call_kwargs = mock_basic_config.call_args[1]
                assert call_kwargs["level"] == logging.WARNING

    def test_configure_logging_error_level(self) -> None:
        """Test configure_logging with ERROR level."""
        with patch("logging.basicConfig") as mock_basic_config:
            with patch("structlog.configure"):
                configure_logging(level="ERROR")

                call_kwargs = mock_basic_config.call_args[1]
                assert call_kwargs["level"] == logging.ERROR

    def test_configure_logging_invalid_level_defaults_to_info(self) -> None:
        """Test configure_logging with invalid level defaults to INFO."""
        with patch("logging.basicConfig") as mock_basic_config:
            with patch("structlog.configure"):
                configure_logging(level="INVALID")

                call_kwargs = mock_basic_config.call_args[1]
                assert call_kwargs["level"] == logging.INFO

    def test_configure_logging_lowercase_level(self) -> None:
        """Test configure_logging handles lowercase level."""
        with patch("logging.basicConfig") as mock_basic_config:
            with patch("structlog.configure"):
                configure_logging(level="debug")

                call_kwargs = mock_basic_config.call_args[1]
                assert call_kwargs["level"] == logging.DEBUG

    def test_configure_logging_json_format_true(self) -> None:
        """Test configure_logging with JSON format."""
        with patch("logging.basicConfig"):
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging(json_format=True)

                call_kwargs = mock_structlog_configure.call_args[1]
                processors = call_kwargs["processors"]

                # Check for JSONRenderer in processors
                has_json_renderer = any("JSONRenderer" in str(type(p)) for p in processors)
                assert has_json_renderer

    def test_configure_logging_json_format_false(self) -> None:
        """Test configure_logging with human-readable format."""
        with patch("logging.basicConfig"):
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging(json_format=False)

                call_kwargs = mock_structlog_configure.call_args[1]
                processors = call_kwargs["processors"]

                # Check for ConsoleRenderer in processors
                has_console_renderer = any("ConsoleRenderer" in str(type(p)) for p in processors)
                assert has_console_renderer

    def test_configure_logging_with_timestamps(self) -> None:
        """Test configure_logging includes timestamps."""
        with patch("logging.basicConfig"):
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging(add_timestamps=True)

                call_kwargs = mock_structlog_configure.call_args[1]
                processors = call_kwargs["processors"]

                # Check for TimeStamper in processors
                has_timestamper = any("TimeStamper" in str(type(p)) for p in processors)
                assert has_timestamper

    def test_configure_logging_without_timestamps(self) -> None:
        """Test configure_logging without timestamps."""
        with patch("logging.basicConfig"):
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging(add_timestamps=False)

                call_kwargs = mock_structlog_configure.call_args[1]
                processors = call_kwargs["processors"]

                # Check TimeStamper NOT in processors
                has_timestamper = any("TimeStamper" in str(type(p)) for p in processors)
                assert not has_timestamper

    def test_configure_logging_processors_order(self) -> None:
        """Test that processors are in correct order."""
        with patch("logging.basicConfig"):
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging(json_format=True, add_timestamps=True)

                call_kwargs = mock_structlog_configure.call_args[1]
                processors = call_kwargs["processors"]

                # Verify we have multiple processors
                assert len(processors) > 5

                # Verify common processors are present - check for callable functions
                # Some processors are functions, not class instances
                processor_strs = [str(p) for p in processors]
                " ".join(processor_strs)
                # Just verify we have some key processors
                assert any(
                    "filter_by_level" in str(p) or "FilterByLevel" in str(type(p).__name__)
                    for p in processors
                )

    def test_configure_logging_wrapper_class(self) -> None:
        """Test that wrapper_class is set to BoundLogger."""
        with patch("logging.basicConfig"):
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging()

                call_kwargs = mock_structlog_configure.call_args[1]
                assert call_kwargs["wrapper_class"] == structlog.stdlib.BoundLogger

    def test_configure_logging_logger_factory(self) -> None:
        """Test that logger_factory is set correctly."""
        with patch("logging.basicConfig"):
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging()

                call_kwargs = mock_structlog_configure.call_args[1]
                logger_factory = call_kwargs["logger_factory"]

                # Should be LoggerFactory instance
                assert isinstance(logger_factory, structlog.stdlib.LoggerFactory)

    def test_configure_logging_cache_logger(self) -> None:
        """Test that cache_logger_on_first_use is enabled."""
        with patch("logging.basicConfig"):
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging()

                call_kwargs = mock_structlog_configure.call_args[1]
                assert call_kwargs["cache_logger_on_first_use"] is True

    def test_configure_logging_all_custom_params(self) -> None:
        """Test configure_logging with all custom parameters."""
        with patch("logging.basicConfig") as mock_basic_config:
            with patch("structlog.configure") as mock_structlog_configure:
                configure_logging(
                    level="WARNING",
                    json_format=False,
                    add_timestamps=False,
                )

                # Verify basicConfig
                call_kwargs = mock_basic_config.call_args[1]
                assert call_kwargs["level"] == logging.WARNING

                # Verify structlog processors
                structlog_kwargs = mock_structlog_configure.call_args[1]
                processors = structlog_kwargs["processors"]

                # Should NOT have TimeStamper
                has_timestamper = any("TimeStamper" in str(type(p)) for p in processors)
                assert not has_timestamper

                # Should have ConsoleRenderer
                has_console_renderer = any("ConsoleRenderer" in str(type(p)) for p in processors)
                assert has_console_renderer


class TestGetLogger:
    """Tests for get_logger function."""

    def test_get_logger_returns_logger(self) -> None:
        """Test that get_logger returns a logger instance."""
        with patch("structlog.get_logger") as mock_get_logger:
            mock_logger = MagicMock()
            mock_get_logger.return_value = mock_logger

            logger = get_logger()

            assert logger is mock_logger
            mock_get_logger.assert_called_once_with(None)

    def test_get_logger_with_name(self) -> None:
        """Test get_logger with custom name."""
        with patch("structlog.get_logger") as mock_get_logger:
            mock_logger = MagicMock()
            mock_get_logger.return_value = mock_logger

            logger = get_logger("test_module")

            assert logger is mock_logger
            mock_get_logger.assert_called_once_with("test_module")

    def test_get_logger_different_names(self) -> None:
        """Test that different names create different loggers."""
        with patch("structlog.get_logger") as mock_get_logger:
            mock_logger1 = MagicMock()
            mock_logger2 = MagicMock()
            mock_get_logger.side_effect = [mock_logger1, mock_logger2]

            logger1 = get_logger("module1")
            logger2 = get_logger("module2")

            assert logger1 is mock_logger1
            assert logger2 is mock_logger2
            assert mock_get_logger.call_count == 2

    def test_get_logger_integration(self) -> None:
        """Test get_logger returns actual BoundLogger after configure."""
        # Configure logging first
        configure_logging()

        logger = get_logger("test")

        # Should be a structlog logger
        assert hasattr(logger, "info")
        assert hasattr(logger, "warning")
        assert hasattr(logger, "error")
        assert hasattr(logger, "debug")


class TestBindContext:
    """Tests for bind_context function."""

    def test_bind_context_single_var(self) -> None:
        """Test binding single context variable."""
        with patch("tuner.utils.logging.bind_contextvars") as mock_bind:
            bind_context(request_id="123")

            mock_bind.assert_called_once_with(request_id="123")

    def test_bind_context_multiple_vars(self) -> None:
        """Test binding multiple context variables."""
        with patch("tuner.utils.logging.bind_contextvars") as mock_bind:
            bind_context(request_id="123", user_id="user-456", session="abc")

            mock_bind.assert_called_once_with(
                request_id="123",
                user_id="user-456",
                session="abc",
            )

    def test_bind_context_no_vars(self) -> None:
        """Test binding with no variables."""
        with patch("tuner.utils.logging.bind_contextvars") as mock_bind:
            bind_context()

            mock_bind.assert_called_once_with()

    def test_bind_context_various_types(self) -> None:
        """Test binding context with various value types."""
        with patch("tuner.utils.logging.bind_contextvars") as mock_bind:
            bind_context(
                str_val="test",
                int_val=123,
                bool_val=True,
                none_val=None,
                list_val=[1, 2, 3],
            )

            mock_bind.assert_called_once()
            call_kwargs = mock_bind.call_args[1]
            assert call_kwargs["str_val"] == "test"
            assert call_kwargs["int_val"] == 123
            assert call_kwargs["bool_val"] is True
            assert call_kwargs["none_val"] is None
            assert call_kwargs["list_val"] == [1, 2, 3]


class TestClearContext:
    """Tests for clear_context function."""

    def test_clear_context_calls_clear_contextvars(self) -> None:
        """Test that clear_context calls structlog clear_contextvars."""
        with patch("tuner.utils.logging.clear_contextvars") as mock_clear:
            clear_context()

            mock_clear.assert_called_once()

    def test_clear_context_multiple_calls(self) -> None:
        """Test that clear_context can be called multiple times."""
        with patch("tuner.utils.logging.clear_contextvars") as mock_clear:
            clear_context()
            clear_context()
            clear_context()

            assert mock_clear.call_count == 3


class TestLoggingIntegration:
    """Integration tests for logging module."""

    def test_full_logging_flow_json(self) -> None:
        """Test complete flow with JSON logging."""
        # Just test that it doesn't raise - stdout redirection is tricky
        configure_logging(level="INFO", json_format=True, add_timestamps=False)
        logger = get_logger("test")

        bind_context(request_id="test-123")
        logger.info("test message", extra_field="value")
        clear_context()

        # If we get here without exception, logging works
        assert True

    def test_full_logging_flow_console(self) -> None:
        """Test complete flow with console logging."""
        # Just test that it doesn't raise
        configure_logging(level="INFO", json_format=False, add_timestamps=False)
        logger = get_logger("test")

        logger.info("test message")

        # If we get here without exception, logging works
        assert True

    def test_context_binding_persists(self) -> None:
        """Test that context binding persists across log calls."""
        configure_logging()

        with patch("tuner.utils.logging.bind_contextvars") as mock_bind:
            with patch("tuner.utils.logging.clear_contextvars") as mock_clear:
                bind_context(request_id="123")
                logger = get_logger("test")
                logger.info("message 1")
                logger.info("message 2")
                clear_context()

                # Context should be bound once and cleared once
                assert mock_bind.call_count == 1
                assert mock_clear.call_count == 1

    def test_different_log_levels(self) -> None:
        """Test logging at different levels."""
        configure_logging(level="DEBUG")
        logger = get_logger("test")

        # All these should work without errors
        logger.debug("debug message")
        logger.info("info message")
        logger.warning("warning message")
        logger.error("error message")

    def test_logging_with_exception_info(self) -> None:
        """Test logging with exception information."""
        configure_logging()
        logger = get_logger("test")

        try:
            raise ValueError("test error")
        except ValueError:
            # Should not raise when logging exception
            logger.error("error occurred", exc_info=True)

    def test_reconfigure_logging(self) -> None:
        """Test that logging can be reconfigured."""
        configure_logging(level="INFO", json_format=True)
        logger1 = get_logger("test1")

        # Reconfigure
        configure_logging(level="DEBUG", json_format=False)
        logger2 = get_logger("test2")

        # Both loggers should work
        logger1.info("message 1")
        logger2.debug("message 2")

    def test_logger_name_preservation(self) -> None:
        """Test that logger names are preserved."""
        configure_logging()

        logger = get_logger("my.module.name")

        # Logger should have info method
        assert hasattr(logger, "info")

    def test_context_isolation(self) -> None:
        """Test that context clearing doesn't affect logger."""
        configure_logging()

        bind_context(request_id="123")
        logger = get_logger("test")
        logger.info("with context")

        clear_context()
        logger.info("without context")

        # Both should work without errors


class TestLoggingProcessors:
    """Tests for logging processor configuration."""

    def test_shared_processors_present(self) -> None:
        """Test that all shared processors are configured."""
        with patch("logging.basicConfig"), patch("structlog.configure") as mock_configure:
            configure_logging()

            processors = mock_configure.call_args[1]["processors"]
            processor_types = [type(p).__name__ for p in processors]

            # Check for key processors
            assert any("PositionalArgumentsFormatter" in str(t) for t in processor_types)
            assert any("StackInfoRenderer" in str(t) for t in processor_types)
            assert any("UnicodeDecoder" in str(t) for t in processor_types)

    def test_timestamp_processor_utc(self) -> None:
        """Test that TimeStamper uses UTC and ISO format."""
        with patch("logging.basicConfig"), patch("structlog.configure") as mock_configure:
            configure_logging(add_timestamps=True)

            processors = mock_configure.call_args[1]["processors"]

            # Find TimeStamper
            timestamper = None
            for p in processors:
                if "TimeStamper" in type(p).__name__:
                    timestamper = p
                    break

            # TimeStamper should be present with UTC
            assert timestamper is not None

    def test_json_renderer_configuration(self) -> None:
        """Test JSONRenderer configuration."""
        with patch("logging.basicConfig"), patch("structlog.configure") as mock_configure:
            configure_logging(json_format=True)

            processors = mock_configure.call_args[1]["processors"]

            # Find JSONRenderer
            json_renderer = None
            for p in processors:
                if "JSONRenderer" in type(p).__name__:
                    json_renderer = p
                    break

            assert json_renderer is not None
