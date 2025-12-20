"""
Latency tracking and percentile computation.

Tracks request latencies and computes percentile statistics:
- p50 (median): Half of requests complete faster
- p90: 90% of requests complete faster
- p95: 95% of requests complete faster
- p99: 99% of requests complete faster

Useful for understanding performance characteristics and SLA compliance.
"""

from dataclasses import dataclass

import numpy as np


@dataclass
class LatencyMetrics:
    """Latency percentile metrics."""

    count: int
    mean_ms: float
    median_ms: float
    p50_ms: float
    p90_ms: float
    p95_ms: float
    p99_ms: float
    min_ms: float
    max_ms: float


def compute_latency_percentiles(latencies_ms: list[float]) -> LatencyMetrics:
    """
    Compute latency percentiles from a list of latencies.

    Args:
            latencies_ms: List of latencies in milliseconds

    Returns:
            LatencyMetrics with p50, p90, p95, p99, and other statistics

    Example:
            ```python
            latencies = [100, 150, 200, 250, 300, 350, 400, 450, 500, 1000]
            metrics = compute_latency_percentiles(latencies)
            print(f"p50: {metrics.p50_ms:.0f}ms")
            print(f"p95: {metrics.p95_ms:.0f}ms")
            print(f"p99: {metrics.p99_ms:.0f}ms")
            ```
    """
    if not latencies_ms:
        # Return zero metrics for empty input
        return LatencyMetrics(
            count=0,
            mean_ms=0.0,
            median_ms=0.0,
            p50_ms=0.0,
            p90_ms=0.0,
            p95_ms=0.0,
            p99_ms=0.0,
            min_ms=0.0,
            max_ms=0.0,
        )

    # Convert to numpy array for efficient computation
    latencies = np.array(latencies_ms, dtype=np.float64)

    # Compute percentiles
    p50 = float(np.percentile(latencies, 50))
    p90 = float(np.percentile(latencies, 90))
    p95 = float(np.percentile(latencies, 95))
    p99 = float(np.percentile(latencies, 99))

    # Compute statistics
    mean = float(np.mean(latencies))
    median = float(np.median(latencies))
    min_val = float(np.min(latencies))
    max_val = float(np.max(latencies))

    return LatencyMetrics(
        count=len(latencies_ms),
        mean_ms=mean,
        median_ms=median,
        p50_ms=p50,
        p90_ms=p90,
        p95_ms=p95,
        p99_ms=p99,
        min_ms=min_val,
        max_ms=max_val,
    )


def compute_custom_percentiles(
    latencies_ms: list[float], percentiles: list[float]
) -> dict[str, float]:
    """
    Compute custom percentiles from a list of latencies.

    Args:
            latencies_ms: List of latencies in milliseconds
            percentiles: List of percentiles to compute (0-100)
                                     Example: [50, 90, 95, 99, 99.9]

    Returns:
            Dictionary mapping percentile name to value in ms

    Example:
            ```python
            latencies = [100, 150, 200, 250, 300]
            metrics = compute_custom_percentiles(latencies, [25, 50, 75, 90])
            print(f"p25: {metrics['p25']:.0f}ms")
            print(f"p75: {metrics['p75']:.0f}ms")
            ```
    """
    if not latencies_ms:
        return {f"p{p}": 0.0 for p in percentiles}

    # Convert to numpy array
    latencies = np.array(latencies_ms, dtype=np.float64)

    # Compute percentiles
    results = {}
    for p in percentiles:
        if not 0 <= p <= 100:
            raise ValueError(f"Percentile must be between 0 and 100, got {p}")

        value = float(np.percentile(latencies, p))
        # Format percentile name (handle decimals)
        key = f"p{int(p)}" if p == int(p) else f"p{p}"
        results[key] = value

    return results


class LatencyTracker:
    """
    Track latencies and compute percentiles on-demand.

    Example:
            ```python
            tracker = LatencyTracker()

            # Track some latencies
            tracker.add(100)
            tracker.add(150)
            tracker.add(200)

            # Get metrics
            metrics = tracker.get_metrics()
            print(f"p95: {metrics.p95_ms:.0f}ms")

            # Reset for next benchmark
            tracker.reset()
            ```
    """

    def __init__(self) -> None:
        """Initialize empty latency tracker."""
        self._latencies: list[float] = []

    def add(self, latency_ms: float) -> None:
        """Add a latency measurement in milliseconds."""
        if latency_ms < 0:
            raise ValueError(f"Latency must be non-negative, got {latency_ms}")
        self._latencies.append(latency_ms)

    def add_multiple(self, latencies_ms: list[float]) -> None:
        """Add multiple latency measurements at once."""
        for latency in latencies_ms:
            self.add(latency)

    def get_metrics(self) -> LatencyMetrics:
        """Compute and return latency metrics."""
        return compute_latency_percentiles(self._latencies)

    def get_custom_percentiles(self, percentiles: list[float]) -> dict[str, float]:
        """Compute custom percentiles."""
        return compute_custom_percentiles(self._latencies, percentiles)

    def reset(self) -> None:
        """Clear all latency measurements."""
        self._latencies.clear()

    def __len__(self) -> int:
        """Return number of latency measurements."""
        return len(self._latencies)

    @property
    def latencies(self) -> list[float]:
        """Get copy of latency measurements."""
        return self._latencies.copy()
