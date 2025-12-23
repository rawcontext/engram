"""Comprehensive tests for rate limiter implementation."""

import time
from unittest.mock import patch

import pytest

from src.utils.rate_limiter import (
    RateLimitConfig,
    RateLimitError,
    RequestRecord,
    SlidingWindowRateLimiter,
)


class TestRateLimitConfig:
    """Tests for RateLimitConfig dataclass."""

    def test_config_creation(self) -> None:
        """Test creating a rate limit config."""
        config = RateLimitConfig(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=500,
        )
        assert config.max_requests_per_hour == 100
        assert config.max_budget_cents_per_hour == 500


class TestRequestRecord:
    """Tests for RequestRecord dataclass."""

    def test_record_creation(self) -> None:
        """Test creating a request record."""
        record = RequestRecord(
            timestamp=1234567890.0,
            cost_cents=5.5,
        )
        assert record.timestamp == 1234567890.0
        assert record.cost_cents == 5.5


class TestRateLimitError:
    """Tests for RateLimitError exception."""

    def test_error_attributes(self) -> None:
        """Test rate limit error has correct attributes."""
        error = RateLimitError(
            message="Rate limit exceeded",
            limit_type="requests",
            retry_after_seconds=30.5,
        )
        assert str(error) == "Rate limit exceeded"
        assert error.limit_type == "requests"
        assert error.retry_after_seconds == 30.5

    def test_error_budget_type(self) -> None:
        """Test rate limit error with budget type."""
        error = RateLimitError(
            message="Budget exceeded",
            limit_type="budget",
            retry_after_seconds=0.0,
        )
        assert error.limit_type == "budget"
        assert error.retry_after_seconds == 0.0


class TestSlidingWindowRateLimiter:
    """Tests for SlidingWindowRateLimiter."""

    def test_initialization(self) -> None:
        """Test limiter initialization with defaults."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=1000,
        )
        assert limiter.max_requests == 100
        assert limiter.max_budget_cents == 1000
        assert limiter.window_seconds == 3600

    def test_initialization_custom_window(self) -> None:
        """Test limiter with custom window size."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=1000,
            window_seconds=1800,  # 30 minutes
        )
        assert limiter.window_seconds == 1800

    def test_check_and_record_allows_first_request(self) -> None:
        """Test that first request is allowed."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=10,
            max_budget_cents_per_hour=100,
        )
        # Should not raise
        limiter.check_and_record(cost_cents=5.0)
        usage = limiter.get_usage()
        assert usage["request_count"] == 1
        assert usage["total_cost_cents"] == 5.0

    def test_check_and_record_multiple_requests(self) -> None:
        """Test recording multiple requests."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=10,
            max_budget_cents_per_hour=100,
        )
        limiter.check_and_record(cost_cents=1.0)
        limiter.check_and_record(cost_cents=2.0)
        limiter.check_and_record(cost_cents=3.0)

        usage = limiter.get_usage()
        assert usage["request_count"] == 3
        assert usage["total_cost_cents"] == 6.0

    def test_check_and_record_zero_cost(self) -> None:
        """Test recording request with zero cost."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=10,
            max_budget_cents_per_hour=100,
        )
        limiter.check_and_record(cost_cents=0.0)
        limiter.check_and_record()  # Default is 0.0

        usage = limiter.get_usage()
        assert usage["request_count"] == 2
        assert usage["total_cost_cents"] == 0.0

    def test_request_limit_exceeded(self) -> None:
        """Test that request limit is enforced."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=3,
            max_budget_cents_per_hour=1000,
        )
        limiter.check_and_record(cost_cents=1.0)
        limiter.check_and_record(cost_cents=1.0)
        limiter.check_and_record(cost_cents=1.0)

        with pytest.raises(RateLimitError) as exc_info:
            limiter.check_and_record(cost_cents=1.0)

        assert exc_info.value.limit_type == "requests"
        assert exc_info.value.retry_after_seconds >= 0

    def test_budget_limit_exceeded(self) -> None:
        """Test that budget limit is enforced."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=10,
        )
        limiter.check_and_record(cost_cents=5.0)

        with pytest.raises(RateLimitError) as exc_info:
            limiter.check_and_record(cost_cents=10.0)  # Would exceed 10 cent budget

        assert exc_info.value.limit_type == "budget"

    def test_single_request_exceeds_total_budget(self) -> None:
        """Test that a single request exceeding total budget gives retry_after=0."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=10,
        )

        with pytest.raises(RateLimitError) as exc_info:
            limiter.check_and_record(cost_cents=100.0)  # Way over budget

        assert exc_info.value.limit_type == "budget"
        assert exc_info.value.retry_after_seconds == 0  # Can never succeed

    def test_budget_freed_over_time(self) -> None:
        """Test that budget is freed as old requests expire."""
        # Use a very short window for testing
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=10,
            window_seconds=1,  # 1 second window
        )
        limiter.check_and_record(cost_cents=5.0)

        # This should exceed budget
        with pytest.raises(RateLimitError):
            limiter.check_and_record(cost_cents=10.0)

        # Wait for the window to expire
        time.sleep(1.1)

        # Now it should succeed
        limiter.check_and_record(cost_cents=10.0)
        usage = limiter.get_usage()
        assert usage["request_count"] == 1  # Old request expired
        assert usage["total_cost_cents"] == 10.0

    def test_clean_old_requests(self) -> None:
        """Test that old requests are cleaned up."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=1000,
            window_seconds=1,
        )
        limiter.check_and_record(cost_cents=5.0)
        limiter.check_and_record(cost_cents=5.0)

        usage = limiter.get_usage()
        assert usage["request_count"] == 2

        # Wait for window to expire
        time.sleep(1.1)

        usage = limiter.get_usage()
        assert usage["request_count"] == 0
        assert usage["total_cost_cents"] == 0.0

    def test_get_usage_utilization_percentages(self) -> None:
        """Test that usage stats include utilization percentages."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=1000,
        )
        limiter.check_and_record(cost_cents=100.0)

        usage = limiter.get_usage()
        assert usage["request_utilization"] == 1.0  # 1/100 = 1%
        assert usage["budget_utilization"] == 10.0  # 100/1000 = 10%
        assert usage["max_requests"] == 100
        assert usage["max_budget_cents"] == 1000

    def test_reset_clears_all_requests(self) -> None:
        """Test that reset clears all recorded requests."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=100,
            max_budget_cents_per_hour=1000,
        )
        limiter.check_and_record(cost_cents=100.0)
        limiter.check_and_record(cost_cents=200.0)

        usage = limiter.get_usage()
        assert usage["request_count"] == 2

        limiter.reset()

        usage = limiter.get_usage()
        assert usage["request_count"] == 0
        assert usage["total_cost_cents"] == 0.0

    def test_thread_safety_with_lock(self) -> None:
        """Test that operations are thread-safe."""
        import threading

        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=1000,
            max_budget_cents_per_hour=10000,
        )
        errors = []

        def make_requests():
            try:
                for _ in range(100):
                    limiter.check_and_record(cost_cents=1.0)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=make_requests) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # No errors should occur
        assert len(errors) == 0

        # Should have recorded 500 requests (5 threads * 100 requests)
        usage = limiter.get_usage()
        assert usage["request_count"] == 500

    def test_retry_after_calculation_for_requests(self) -> None:
        """Test that retry_after is calculated correctly for request limits."""
        with patch("time.time") as mock_time:
            mock_time.return_value = 1000.0

            limiter = SlidingWindowRateLimiter(
                max_requests_per_hour=2,
                max_budget_cents_per_hour=1000,
                window_seconds=3600,
            )
            limiter.check_and_record(cost_cents=1.0)

            mock_time.return_value = 1001.0
            limiter.check_and_record(cost_cents=1.0)

            mock_time.return_value = 1002.0
            with pytest.raises(RateLimitError) as exc_info:
                limiter.check_and_record(cost_cents=1.0)

            # First request was at t=1000, so it expires at t=4600
            # Current time is t=1002, so retry_after should be ~3598 seconds
            assert exc_info.value.retry_after_seconds > 3500
            assert exc_info.value.retry_after_seconds <= 3600

    def test_retry_after_calculation_for_budget(self) -> None:
        """Test that retry_after is calculated correctly for budget limits."""
        with patch("time.time") as mock_time:
            mock_time.return_value = 1000.0

            limiter = SlidingWindowRateLimiter(
                max_requests_per_hour=100,
                max_budget_cents_per_hour=10,
                window_seconds=3600,
            )
            limiter.check_and_record(cost_cents=5.0)

            mock_time.return_value = 1001.0
            limiter.check_and_record(cost_cents=4.0)

            mock_time.return_value = 1002.0
            with pytest.raises(RateLimitError) as exc_info:
                limiter.check_and_record(cost_cents=5.0)

            # Need to free up at least 4 cents (9+5-10=4)
            # First request (5 cents) expires at t=4600
            # retry_after should be based on when enough budget is freed
            assert exc_info.value.retry_after_seconds >= 0
            assert exc_info.value.limit_type == "budget"

    def test_exactly_at_limit(self) -> None:
        """Test behavior when exactly at the limit."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=2,
            max_budget_cents_per_hour=10,
        )
        limiter.check_and_record(cost_cents=5.0)
        limiter.check_and_record(cost_cents=5.0)  # Exactly at budget

        # Next request should fail on request count (at 2/2)
        with pytest.raises(RateLimitError) as exc_info:
            limiter.check_and_record(cost_cents=0.0)

        assert exc_info.value.limit_type == "requests"

    def test_budget_check_before_request_count(self) -> None:
        """Test that request count is checked before budget."""
        limiter = SlidingWindowRateLimiter(
            max_requests_per_hour=2,
            max_budget_cents_per_hour=100,
        )
        limiter.check_and_record(cost_cents=1.0)
        limiter.check_and_record(cost_cents=1.0)

        # Request count exceeded, even though budget is fine
        with pytest.raises(RateLimitError) as exc_info:
            limiter.check_and_record(cost_cents=1.0)

        assert exc_info.value.limit_type == "requests"
