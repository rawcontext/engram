"""
Typer CLI for the Engram benchmark suite.

Provides commands for validating datasets, running benchmarks, and evaluating results.
"""

from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.panel import Panel

from engram_benchmark.longmemeval.loader import validate_dataset

app = typer.Typer(
    name="engram-benchmark",
    help="LongMemEval benchmark suite for Engram memory system",
    add_completion=False,
)
console = Console()


@app.command()
def validate(
    dataset: Annotated[
        Path,
        typer.Argument(
            help="Path to the LongMemEval dataset JSON file",
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
        ),
    ],
    variant: Annotated[
        str | None,
        typer.Option(
            "--variant",
            "-v",
            help="Expected dataset variant (s, m, oracle)",
        ),
    ] = None,
) -> None:
    """
    Validate a LongMemEval dataset file.

    Checks JSON structure, Pydantic validation, and prints statistics.
    """
    console.print(
        Panel.fit(
            f"[bold]Validating dataset:[/bold] {dataset}",
            border_style="blue",
        )
    )

    is_valid, stats = validate_dataset(dataset)

    if is_valid:
        console.print("\n[bold green]✓ Dataset is valid![/bold green]")
        raise typer.Exit(0)
    else:
        console.print("\n[bold red]✗ Dataset validation failed[/bold red]")
        raise typer.Exit(1)


@app.command()
def run(
    dataset: Annotated[
        Path,
        typer.Option(
            "--dataset",
            "-d",
            help="Path to the LongMemEval dataset JSON file",
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
        ),
    ] = Path("./data/longmemeval_oracle.json"),
    limit: Annotated[
        int | None,
        typer.Option(
            "--limit",
            "-n",
            help="Limit number of instances to evaluate",
            min=1,
        ),
    ] = None,
    output: Annotated[
        Path | None,
        typer.Option(
            "--output",
            "-o",
            help="Output file for results (JSONL format)",
        ),
    ] = None,
) -> None:
    """
    Run the LongMemEval benchmark (placeholder).

    This command will execute the full benchmark pipeline including:
    - Loading the dataset
    - Ingesting into vector store
    - Running retrieval
    - Generating answers with LLM
    - Computing metrics
    """
    console.print(
        Panel.fit(
            "[bold yellow]⚠ Not yet implemented[/bold yellow]\n\n"
            "This command will be implemented in Phase 5 (Pipeline).\n"
            f"Dataset: {dataset}\n"
            f"Limit: {limit or 'all'}\n"
            f"Output: {output or 'default'}",
            border_style="yellow",
            title="Run Benchmark",
        )
    )

    console.print(
        "\n[dim]For now, use 'validate' to check your dataset:[/dim]\n"
        f"  engram-benchmark validate {dataset}"
    )


@app.command()
def evaluate(
    predictions: Annotated[
        Path,
        typer.Option(
            "--predictions",
            "-p",
            help="Path to predictions JSONL file",
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
        ),
    ],
    ground_truth: Annotated[
        Path,
        typer.Option(
            "--ground-truth",
            "-g",
            help="Path to ground truth dataset JSON file",
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
        ),
    ],
    llm_eval: Annotated[
        bool,
        typer.Option(
            "--llm-eval",
            help="Use LLM-based evaluation instead of exact match",
        ),
    ] = False,
    output: Annotated[
        Path | None,
        typer.Option(
            "--output",
            "-o",
            help="Output file for evaluation report",
        ),
    ] = None,
) -> None:
    """
    Evaluate benchmark predictions against ground truth (placeholder).

    Computes accuracy, retrieval metrics, and abstention metrics.
    """
    console.print(
        Panel.fit(
            "[bold yellow]⚠ Not yet implemented[/bold yellow]\n\n"
            "This command will be implemented in Phase 4 (Evaluation Metrics).\n"
            f"Predictions: {predictions}\n"
            f"Ground Truth: {ground_truth}\n"
            f"LLM Eval: {llm_eval}\n"
            f"Output: {output or 'default'}",
            border_style="yellow",
            title="Evaluate Results",
        )
    )


@app.command()
def version() -> None:
    """Show version information."""
    from engram_benchmark import __version__

    console.print(f"engram-benchmark version [bold cyan]{__version__}[/bold cyan]")


@app.callback()
def main() -> None:
    """
    Engram Benchmark - LongMemEval evaluation suite.

    For detailed help on each command, run:
        engram-benchmark COMMAND --help
    """
    pass


if __name__ == "__main__":
    app()
