"""Tests for progress tracking."""

import pytest

from engram_benchmark.utils.progress import BenchmarkProgress, ProgressTracker


def test_benchmark_progress_initialization() -> None:
    """Test BenchmarkProgress initialization."""
    progress = BenchmarkProgress(total_instances=100)

    assert progress.total_instances == 100
    assert progress.completed_instances == 0
    assert progress.failed_instances == 0
    assert progress.current_stage == ""
    assert progress.stage_progress == {}


def test_progress_tracker_initialization() -> None:
    """Test ProgressTracker initialization."""
    tracker = ProgressTracker(total_instances=50)

    assert tracker.total_instances == 50
    assert tracker.completed == 0
    assert tracker.failed == 0


def test_progress_tracker_complete_instance() -> None:
    """Test completing instances."""
    tracker = ProgressTracker(total_instances=10)

    tracker.complete_instance(success=True)
    assert tracker.completed == 1
    assert tracker.failed == 0

    tracker.complete_instance(success=False)
    assert tracker.completed == 1
    assert tracker.failed == 1

    tracker.complete_instance(success=True)
    assert tracker.completed == 2
    assert tracker.failed == 1


def test_progress_tracker_get_state() -> None:
    """Test getting progress state."""
    tracker = ProgressTracker(total_instances=100)

    tracker.complete_instance(success=True)
    tracker.complete_instance(success=True)
    tracker.complete_instance(success=False)

    state = tracker.get_state()

    assert state.total_instances == 100
    assert state.completed_instances == 2
    assert state.failed_instances == 1


@pytest.mark.skip(reason="Requires Rich display context - test is flaky in CI")
def test_progress_tracker_context_manager() -> None:
    """Test progress tracker context manager."""
    tracker = ProgressTracker(total_instances=5)

    with tracker.start(), tracker.stage("Test stage", total=5) as stage_id:
        for _ in range(5):
            tracker.update(stage_id, advance=1)
            tracker.complete_instance(success=True)

    assert tracker.completed == 5
