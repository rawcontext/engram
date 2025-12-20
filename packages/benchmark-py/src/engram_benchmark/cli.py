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
    output_dir: Annotated[
        Path,
        typer.Option(
            "--output-dir",
            "-o",
            help="Output directory for results",
        ),
    ] = Path("./results"),
    model: Annotated[
        str,
        typer.Option(
            "--model",
            "-m",
            help="LLM model for answer generation",
        ),
    ] = "openai/gpt-4o-mini",
    embedding_model: Annotated[
        str,
        typer.Option(
            "--embedding-model",
            "-e",
            help="Embedding model for retrieval",
        ),
    ] = "BAAI/bge-base-en-v1.5",
    top_k: Annotated[
        int,
        typer.Option(
            "--top-k",
            "-k",
            help="Number of contexts to retrieve",
            min=1,
            max=100,
        ),
    ] = 10,
    concurrency: Annotated[
        int,
        typer.Option(
            "--concurrency",
            "-c",
            help="Number of concurrent operations",
            min=1,
            max=50,
        ),
    ] = 5,
    llm_eval: Annotated[
        bool,
        typer.Option(
            "--llm-eval",
            help="Use LLM-based evaluation instead of exact match",
        ),
    ] = False,
) -> None:
    """
    Run the LongMemEval benchmark.

    This command executes the full benchmark pipeline including:
    - Loading the dataset
    - Parsing and mapping instances to documents
    - Indexing into ChromaDB vector store
    - Retrieving relevant contexts
    - Generating answers with LLM
    - Computing metrics and generating reports
    """
    import asyncio

    from engram_benchmark.longmemeval.pipeline import BenchmarkPipeline, PipelineConfig
    from engram_benchmark.longmemeval.reader import LongMemEvalReader
    from engram_benchmark.longmemeval.retriever import ChromaRetriever
    from engram_benchmark.providers.embeddings import EmbeddingProvider
    from engram_benchmark.providers.llm import LiteLLMProvider
    from engram_benchmark.utils.reporting import print_summary

    console.print(
        Panel.fit(
            f"[bold]Running LongMemEval Benchmark[/bold]\n\n"
            f"Dataset: {dataset}\n"
            f"Limit: {limit or 'all'}\n"
            f"Model: {model}\n"
            f"Embedding: {embedding_model}\n"
            f"Top-K: {top_k}\n"
            f"Output: {output_dir}",
            border_style="blue",
        )
    )

    async def run_pipeline() -> None:
        # Initialize components
        console.print("\n[bold cyan]Initializing components...[/bold cyan]")

        embedder = EmbeddingProvider(model_name=embedding_model)
        await embedder.load()

        retriever = ChromaRetriever(embedder=embedder)
        await retriever.load()

        llm = LiteLLMProvider(model=model)
        reader = LongMemEvalReader(llm_provider=llm)

        # Create pipeline config
        config = PipelineConfig(
            dataset_path=str(dataset),
            output_dir=str(output_dir),
            limit=limit,
            concurrency=concurrency,
            top_k=top_k,
            use_llm_eval=llm_eval,
        )

        # Run pipeline
        pipeline = BenchmarkPipeline(config, retriever, reader)
        report = await pipeline.run()

        # Print summary
        print_summary(report)

        console.print(
            f"\n[bold green]✓ Benchmark complete![/bold green]\nReports saved to: {output_dir}"
        )

    # Run async pipeline
    try:
        asyncio.run(run_pipeline())
        raise typer.Exit(0)
    except Exception as e:
        console.print(f"\n[bold red]✗ Error:[/bold red] {e}")
        raise typer.Exit(1) from e


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
