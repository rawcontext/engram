"""Rate limiter for LLM reranking tier.

Implements sliding window rate limiting with both request count
and cost budget constraints.
"""

import time
from collections import deque
from dataclasses import dataclass
from threading import Lock
from typing import Literal


@dataclass
class RateLimitConfig:
    """Rate limiter configuration.

    Attributes:
        max_requests_per_hour: Maximum requests allowed per hour.
        max_budget_cents_per_hour: Maximum cost budget in cents per hour.
    """

    max_requests_per_hour: int
    max_budget_cents_per_hour: int


@dataclass
class RequestRecord:
    """Record of a rate-limited request.

    Attributes:
        timestamp: Unix timestamp when request was made.
        cost_cents: Cost of the request in cents.
    """

    timestamp: float
    cost_cents: float


class RateLimitError(Exception):
    """Raised when rate limit is exceeded."""

    def __init__(
        self,
        message: str,
        limit_type: Literal["requests", "budget"],
        retry_after_seconds: float,
    ) -> None:
        """Initialize rate limit error.

        Args:
            message: Error message.
            limit_type: Type of limit exceeded (requests or budget).
            retry_after_seconds: Seconds until limit resets.
        """
        super().__init__(message)
        self.limit_type = limit_type
        self.retry_after_seconds = retry_after_seconds


class SlidingWindowRateLimiter:
    """Sliding window rate limiter with request count and cost budget.

    Thread-safe implementation using a sliding window of 1 hour.
    Tracks both request counts and cumulative costs.

    Example:
        >>> limiter = SlidingWindowRateLimiter(
        ...     max_requests_per_hour=100,
        ...     max_budget_cents_per_hour=1000
        ... )
        >>> limiter.check_and_record(cost_cents=10)  # OK
        >>> limiter.check_and_record(cost_cents=5000)  # Raises RateLimitError
    """

    def __init__(
        self,
        max_requests_per_hour: int,
        max_budget_cents_per_hour: int,
        window_seconds: int = 3600,  # 1 hour
    ) -> None:
        """Initialize rate limiter.

        Args:
            max_requests_per_hour: Maximum requests per hour.
            max_budget_cents_per_hour: Maximum cost budget in cents per hour.
            window_seconds: Size of sliding window in seconds (default: 3600 = 1h).
        """
        self.max_requests = max_requests_per_hour
        self.max_budget_cents = max_budget_cents_per_hour
        self.window_seconds = window_seconds

        self._requests: deque[RequestRecord] = deque()
        self._lock = Lock()

    def _clean_old_requests(self, current_time: float) -> None:
        """Remove requests outside the sliding window.

        Args:
            current_time: Current Unix timestamp.
        """
        cutoff_time = current_time - self.window_seconds

        while self._requests and self._requests[0].timestamp < cutoff_time:
            self._requests.popleft()

    def _get_current_stats(self, current_time: float) -> tuple[int, float]:
        """Get current request count and total cost.

        Args:
            current_time: Current Unix timestamp.

        Returns:
            Tuple of (request_count, total_cost_cents).
        """
        self._clean_old_requests(current_time)

        request_count = len(self._requests)
        total_cost = sum(req.cost_cents for req in self._requests)

        return request_count, total_cost

    def check_and_record(self, cost_cents: float = 0.0) -> None:
        """Check rate limits and record request if allowed.

        Args:
            cost_cents: Cost of this request in cents.

        Raises:
            RateLimitError: If rate limit would be exceeded.
        """
        current_time = time.time()

        with self._lock:
            request_count, total_cost = self._get_current_stats(current_time)

            # Check request count limit
            if request_count >= self.max_requests:
                oldest_timestamp = self._requests[0].timestamp
                retry_after = oldest_timestamp + self.window_seconds - current_time

                raise RateLimitError(
                    f"Request rate limit exceeded: {request_count}/{self.max_requests} "
                    f"requests in past hour",
                    limit_type="requests",
                    retry_after_seconds=max(0, retry_after),
                )

            # Check budget limit
            if total_cost + cost_cents > self.max_budget_cents:
                # If the single request alone exceeds the budget, it can never succeed
                if cost_cents > self.max_budget_cents:
                    raise RateLimitError(
                        f"Request cost ({cost_cents:.2f} cents) exceeds maximum budget "
                        f"({self.max_budget_cents:.2f} cents per hour)",
                        limit_type="budget",
                        retry_after_seconds=0,  # Cannot retry - request is too expensive
                    )

                # Calculate when enough budget will be freed
                # Find how much we need to free up
                needed_budget = total_cost + cost_cents - self.max_budget_cents
                freed_budget = 0.0
                retry_after = 0.0

                for req in self._requests:
                    freed_budget += req.cost_cents
                    if freed_budget >= needed_budget:
                        retry_after = req.timestamp + self.window_seconds - current_time
                        break

                raise RateLimitError(
                    f"Budget limit exceeded: {total_cost + cost_cents:.2f}/"
                    f"{self.max_budget_cents:.2f} cents in past hour",
                    limit_type="budget",
                    retry_after_seconds=max(0, retry_after),
                )

            # Record request
            self._requests.append(RequestRecord(timestamp=current_time, cost_cents=cost_cents))

    def get_usage(self) -> dict[str, float]:
        """Get current usage statistics.

        Returns:
            Dict with request_count, total_cost_cents, and utilization percentages.
        """
        current_time = time.time()

        with self._lock:
            request_count, total_cost = self._get_current_stats(current_time)

            return {
                "request_count": request_count,
                "max_requests": self.max_requests,
                "request_utilization": (request_count / self.max_requests) * 100,
                "total_cost_cents": total_cost,
                "max_budget_cents": self.max_budget_cents,
                "budget_utilization": (total_cost / self.max_budget_cents) * 100,
            }

    def reset(self) -> None:
        """Clear all request records. Useful for testing."""
        with self._lock:
            self._requests.clear()
