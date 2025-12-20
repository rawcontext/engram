"""
Progress tracking for benchmark pipeline using Rich progress bars.

Provides visual feedback for long-running benchmark operations with
nested progress tracking for different pipeline stages.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from pydantic import BaseModel, Field
from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TaskID,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)

console = Console()


class BenchmarkProgress(BaseModel):
    """Progress state for a benchmark run."""

    total_instances: int = Field(ge=0)
    completed_instances: int = Field(default=0, ge=0)
    failed_instances: int = Field(default=0, ge=0)
    current_stage: str = Field(default="")
    stage_progress: dict[str, dict[str, int]] = Field(default_factory=dict)


class ProgressTracker:
    """
    Progress tracker for benchmark pipeline stages.

    Displays nested progress bars for:
    - Overall pipeline progress
    - Stage-specific progress (load, map, index, retrieve, read, evaluate)
    - Per-instance metrics

    Examples:
            >>> tracker = ProgressTracker(total_instances=100)
            >>> with tracker.start():
            ...     with tracker.stage("Loading dataset") as stage_id:
            ...         for i in range(100):
            ...             tracker.update(stage_id, advance=1)
            ...             await process_instance(i)
            ...     tracker.complete_instance(success=True)
    """

    def __init__(
        self,
        total_instances: int,
        show_elapsed: bool = True,
        show_remaining: bool = True,
    ) -> None:
        """
        Initialize progress tracker.

        Args:
                total_instances: Total number of instances to process
                show_elapsed: Whether to show elapsed time
                show_remaining: Whether to show estimated time remaining
        """
        self.total_instances = total_instances
        self.completed = 0
        self.failed = 0
        self.show_elapsed = show_elapsed
        self.show_remaining = show_remaining

        # Create progress display with multiple columns
        columns: list[Any] = [
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            MofNCompleteColumn(),
        ]

        if show_elapsed:
            columns.append(TimeElapsedColumn())

        if show_remaining:
            columns.append(TimeRemainingColumn())

        self.progress = Progress(*columns, console=console)
        self.overall_task: TaskID | None = None
        self.stage_tasks: dict[str, TaskID] = {}

    @contextmanager
    def start(self) -> Iterator["ProgressTracker"]:
        """
        Context manager to start and stop the progress display.

        Yields:
                The progress tracker instance
        """
        with self.progress:
            # Create overall progress task
            self.overall_task = self.progress.add_task(
                "[bold blue]Overall Progress",
                total=self.total_instances,
            )
            yield self
            self._finalize()

    @contextmanager
    def stage(self, name: str, total: int | None = None) -> Iterator[TaskID]:
        """
        Context manager for tracking a pipeline stage.

        Args:
                name: Name of the stage
                total: Total items in this stage (defaults to total_instances)

        Yields:
                Task ID for the stage
        """
        if total is None:
            total = self.total_instances

        task_id = self.progress.add_task(f"  → {name}", total=total)
        self.stage_tasks[name] = task_id

        try:
            yield task_id
        finally:
            # Mark stage as complete
            self.progress.update(task_id, completed=total)

    def update(self, task_id: TaskID, advance: int = 1, **kwargs: Any) -> None:
        """
        Update progress for a specific task.

        Args:
                task_id: Task ID to update
                advance: Number of items to advance (default: 1)
                **kwargs: Additional progress update arguments
        """
        self.progress.update(task_id, advance=advance, **kwargs)

    def complete_instance(self, success: bool = True) -> None:
        """
        Mark an instance as completed.

        Args:
                success: Whether the instance completed successfully
        """
        if success:
            self.completed += 1
        else:
            self.failed += 1

        # Update overall progress
        if self.overall_task is not None:
            self.progress.update(self.overall_task, advance=1)

    def _finalize(self) -> None:
        """Print final summary."""
        console.print()
        console.print("[bold green]✓[/bold green] Benchmark completed!")
        console.print(f"  Total: {self.total_instances}")
        console.print(f"  Completed: [green]{self.completed}[/green]")

        if self.failed > 0:
            console.print(f"  Failed: [red]{self.failed}[/red]")

    def get_state(self) -> BenchmarkProgress:
        """
        Get current progress state.

        Returns:
                BenchmarkProgress with current state
        """
        stage_progress = {}
        for name, task_id in self.stage_tasks.items():
            task = self.progress.tasks[self.progress._tasks.index(task_id)]
            stage_progress[name] = {
                "total": task.total or 0,
                "completed": task.completed,
            }

        return BenchmarkProgress(
            total_instances=self.total_instances,
            completed_instances=self.completed,
            failed_instances=self.failed,
            current_stage=list(self.stage_tasks.keys())[-1] if self.stage_tasks else "",
            stage_progress=stage_progress,
        )


def print_stage_header(stage_name: str, description: str = "") -> None:
    """
    Print a formatted stage header.

    Args:
            stage_name: Name of the stage
            description: Optional description
    """
    console.print()
    console.print(f"[bold cyan]{stage_name}[/bold cyan]")
    if description:
        console.print(f"[dim]{description}[/dim]")
    console.print()


def print_metric_summary(metrics: dict[str, float], title: str = "Metrics") -> None:
    """
    Print a formatted metric summary.

    Args:
            metrics: Dictionary of metric names to values
            title: Title for the summary
    """
    console.print()
    console.print(f"[bold]{title}[/bold]")
    console.print()

    for metric_name, value in metrics.items():
        # Format percentages differently from raw numbers
        if 0 <= value <= 1 and metric_name.lower() in [
            "accuracy",
            "precision",
            "recall",
            "f1",
        ]:
            formatted_value = f"{value:.1%}"
        else:
            formatted_value = f"{value:.4f}"

        console.print(f"  {metric_name:20s}: {formatted_value}")
