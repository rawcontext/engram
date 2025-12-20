"""
Dataset loader for LongMemEval benchmark.

Provides functions to load and validate LongMemEval dataset files with
comprehensive error reporting and type validation.
"""

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import ValidationError
from rich.console import Console
from rich.table import Table

from engram_benchmark.longmemeval.types import (
    LongMemEvalDataset,
    LongMemEvalInstance,
    QuestionType,
    get_memory_ability,
)

console = Console()

DatasetVariant = Literal["s", "m", "oracle"]


class DatasetValidationError(Exception):
    """Raised when dataset validation fails."""

    pass


def load_dataset(
    path: str | Path,
    *,
    limit: int | None = None,
    variant: DatasetVariant | None = None,
    validate: bool = True,
) -> LongMemEvalDataset:
    """
    Load a LongMemEval dataset from a JSON file.

    Args:
            path: Path to the dataset JSON file
            limit: Optional limit on number of instances to load
            variant: Expected dataset variant (s, m, oracle) for validation
            validate: Whether to perform strict validation (default: True)

    Returns:
            List of validated LongMemEvalInstance objects

    Raises:
            FileNotFoundError: If the dataset file doesn't exist
            DatasetValidationError: If validation fails
            json.JSONDecodeError: If the file is not valid JSON
    """
    file_path = Path(path)

    if not file_path.exists():
        raise FileNotFoundError(f"Dataset file not found: {file_path}")

    # Load raw JSON
    try:
        with open(file_path, encoding="utf-8") as f:
            raw_data = json.load(f)
    except json.JSONDecodeError as e:
        raise DatasetValidationError(f"Invalid JSON in dataset file: {e}") from e

    if not isinstance(raw_data, list):
        raise DatasetValidationError(
            f"Expected dataset to be a list, got {type(raw_data).__name__}"
        )

    # Apply limit if specified
    if limit is not None and limit > 0:
        raw_data = raw_data[:limit]

    # Validate and parse instances
    if validate:
        dataset = _validate_instances(raw_data, file_path)
    else:
        # Just parse without strict validation
        dataset = [LongMemEvalInstance(**instance) for instance in raw_data]

    # Validate variant if specified
    if variant is not None:
        expected_filename = f"longmemeval_{variant}.json"
        if file_path.name != expected_filename:
            console.print(
                f"[yellow]Warning:[/yellow] Expected filename '{expected_filename}' "
                f"for variant '{variant}', got '{file_path.name}'"
            )

    console.print(f"[green]✓[/green] Loaded {len(dataset)} instances from {file_path.name}")

    return dataset


def _validate_instances(raw_data: list[Any], file_path: Path) -> LongMemEvalDataset:
    """
    Validate all instances in the dataset.

    Provides detailed error reporting for validation failures.
    """
    dataset: LongMemEvalDataset = []
    errors: list[tuple[int, str, str]] = []  # (index, question_id, error)

    for i, raw_instance in enumerate(raw_data):
        try:
            instance = LongMemEvalInstance(**raw_instance)
            dataset.append(instance)
        except ValidationError as e:
            question_id = (
                raw_instance.get("question_id", f"<index {i}>")
                if isinstance(raw_instance, dict)
                else f"<index {i}>"
            )
            error_details = _format_validation_error(e)
            errors.append((i, question_id, error_details))

    if errors:
        _report_validation_errors(errors, file_path)
        raise DatasetValidationError(
            f"Dataset validation failed with {len(errors)} error(s). See above for details."
        )

    return dataset


def _format_validation_error(error: ValidationError) -> str:
    """Format a Pydantic validation error into a readable string."""
    error_messages = []
    for err in error.errors():
        loc = ".".join(str(loc_part) for loc_part in err["loc"])
        msg = err["msg"]
        error_messages.append(f"{loc}: {msg}")
    return "; ".join(error_messages)


def _report_validation_errors(errors: list[tuple[int, str, str]], file_path: Path) -> None:
    """Print a formatted table of validation errors."""
    console.print(f"\n[red]✗ Validation errors in {file_path.name}:[/red]\n")

    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Index", style="dim", width=8)
    table.add_column("Question ID", width=20)
    table.add_column("Error", width=60)

    for idx, question_id, error in errors[:10]:  # Show first 10 errors
        table.add_row(str(idx), question_id, error)

    if len(errors) > 10:
        table.add_row("...", "...", f"... and {len(errors) - 10} more errors")

    console.print(table)


def validate_dataset(path: str | Path) -> tuple[bool, dict[str, int]]:
    """
    Validate a dataset file and return statistics.

    Args:
            path: Path to the dataset JSON file

    Returns:
            Tuple of (is_valid, statistics)
            Statistics include counts by question type and memory ability
    """
    try:
        dataset = load_dataset(path, validate=True)
    except (FileNotFoundError, DatasetValidationError, json.JSONDecodeError) as e:
        console.print(f"[red]✗ Validation failed:[/red] {e}")
        return False, {}

    # Compute statistics
    stats = _compute_dataset_stats(dataset)
    _print_dataset_stats(stats, Path(path))

    return True, stats


def _compute_dataset_stats(dataset: LongMemEvalDataset) -> dict[str, int]:
    """Compute statistics about the dataset."""
    stats: dict[str, int] = {
        "total": len(dataset),
        "question_types": 0,
        "memory_abilities": 0,
    }

    # Count by question type
    question_type_counts: dict[QuestionType, int] = {}
    for instance in dataset:
        question_type_counts[instance.question_type] = (
            question_type_counts.get(instance.question_type, 0) + 1
        )

    for qt in QuestionType:
        stats[f"qt_{qt.value}"] = question_type_counts.get(qt, 0)

    # Count by memory ability
    ability_counts: dict[str, int] = {}
    for instance in dataset:
        ability = get_memory_ability(instance.question_type, instance.question_id)
        ability_counts[ability] = ability_counts.get(ability, 0) + 1

    for ability_name in ["IE", "MR", "TR", "KU", "ABS"]:
        stats[f"ability_{ability_name}"] = ability_counts.get(ability_name, 0)

    return stats


def _print_dataset_stats(stats: dict[str, int], file_path: Path) -> None:
    """Print formatted dataset statistics."""
    console.print(f"\n[bold]Dataset Statistics: {file_path.name}[/bold]\n")

    # Overall
    console.print(f"Total instances: [cyan]{stats['total']}[/cyan]\n")

    # By question type
    console.print("[bold]Question Types:[/bold]")
    for qt in QuestionType:
        count = stats.get(f"qt_{qt.value}", 0)
        percentage = (count / stats["total"] * 100) if stats["total"] > 0 else 0
        console.print(f"  {qt.value:30s}: {count:4d} ({percentage:5.1f}%)")

    console.print()

    # By memory ability
    console.print("[bold]Memory Abilities:[/bold]")
    for ability in ["IE", "MR", "TR", "KU", "ABS"]:
        count = stats.get(f"ability_{ability}", 0)
        percentage = (count / stats["total"] * 100) if stats["total"] > 0 else 0
        ability_name = {
            "IE": "Information Extraction",
            "MR": "Multi-Session Reasoning",
            "TR": "Temporal Reasoning",
            "KU": "Knowledge Update",
            "ABS": "Abstention",
        }[ability]
        console.print(f"  {ability_name:30s}: {count:4d} ({percentage:5.1f}%)")
