"""Tests for structured logging utilities."""

import io
import json
import logging

import pytest
import structlog

from search.utils.logging import bind_context, clear_context, configure_logging, get_logger


@pytest.fixture(autouse=True)
def reset_logging():
    """Reset logging configuration before each test."""
    # Reset structlog
    structlog.reset_defaults()
    # Reset standard logging
    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)
    yield
    # Cleanup after test
    structlog.reset_defaults()
    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)


@pytest.fixture
def capture_logs():
    """Fixture to capture log output to a StringIO buffer."""
    # Create string buffer
    log_buffer = io.StringIO()

    # Create handler - will use the level set by configure_logging
    handler = logging.StreamHandler(log_buffer)

    # Add to root logger
    logging.root.addHandler(handler)

    yield log_buffer

    # Cleanup
    logging.root.removeHandler(handler)


def test_configure_logging_json(capture_logs):
    """Test JSON logging configuration."""
    configure_logging(level="INFO", json_format=True, add_timestamps=True)
    logger = get_logger("test")

    logger.info("test message", key="value")

    # Parse output
    output = capture_logs.getvalue()
    assert output, "No log output captured"

    log_entry = json.loads(output.strip())
    assert log_entry["event"] == "test message"
    assert log_entry["key"] == "value"
    assert log_entry["level"] == "info"
    assert "timestamp" in log_entry
    assert log_entry["logger"] == "test"


def test_configure_logging_levels(capture_logs):
    """Test different log levels are respected."""
    configure_logging(level="WARNING", json_format=True)
    logger = get_logger("test")

    # At WARNING level, warnings and errors should be logged
    logger.warning("warning message")
    logger.error("error message")

    output = capture_logs.getvalue()
    assert "warning message" in output
    assert "error message" in output

    # Verify JSON structure for one of the messages
    lines = output.strip().split("\n")
    first_entry = json.loads(lines[0])
    assert first_entry["level"] == "warning"
    assert first_entry["event"] == "warning message"


def test_bind_context(capture_logs):
    """Test binding context variables."""
    configure_logging(level="INFO", json_format=True)
    logger = get_logger("test")

    bind_context(request_id="123", user_id="456")
    logger.info("test message")

    output = capture_logs.getvalue()
    log_entry = json.loads(output.strip())

    assert log_entry["request_id"] == "123"
    assert log_entry["user_id"] == "456"


def test_clear_context(capture_logs):
    """Test clearing context variables."""
    configure_logging(level="INFO", json_format=True)
    logger = get_logger("test")

    # Bind context
    bind_context(request_id="123", user_id="456")
    logger.info("first message")

    # Clear and log again
    clear_context()
    logger.info("second message")

    output = capture_logs.getvalue()
    lines = output.strip().split("\n")

    first_entry = json.loads(lines[0])
    second_entry = json.loads(lines[1])

    assert first_entry["request_id"] == "123"
    assert "request_id" not in second_entry


def test_logger_with_exception(capture_logs):
    """Test logging exceptions with stack traces."""
    configure_logging(level="INFO", json_format=True)
    logger = get_logger("test")

    try:
        raise ValueError("test error")
    except ValueError:
        logger.error("error occurred", exc_info=True)

    output = capture_logs.getvalue()
    log_entry = json.loads(output.strip())

    assert log_entry["event"] == "error occurred"
    assert log_entry["level"] == "error"
    assert "exception" in log_entry
    assert "ValueError: test error" in log_entry["exception"]
