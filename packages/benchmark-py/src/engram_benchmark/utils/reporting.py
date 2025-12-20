"""
Benchmark report generation in Markdown and JSON formats.

Generates comprehensive reports including:
- Overall accuracy metrics
- Per-ability breakdown (IE, MR, TR, KU, ABS)
- Retrieval metrics (turn recall, session recall, NDCG, MRR)
- Abstention metrics (precision, recall, F1)
- Confusion matrices
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from engram_benchmark.longmemeval.types import (
    AbilityMetrics,
    AbstentionMetrics,
    EvaluationMetrics,
    RetrievalMetrics,
)


class BenchmarkReport(BaseModel):
    """Complete benchmark report with all metrics and metadata."""

    timestamp: datetime = Field(default_factory=datetime.now)
    dataset_path: str
    total_instances: int = Field(ge=0)
    model_name: str | None = None
    embedding_model: str | None = None
    reranker_model: str | None = None
    retrieval_strategy: str | None = None
    metrics: EvaluationMetrics
    config: dict[str, Any] = Field(default_factory=dict)


def generate_markdown_report(report: BenchmarkReport, output_path: str | Path | None = None) -> str:
    """
    Generate a Markdown-formatted benchmark report.

    Args:
            report: BenchmarkReport with all metrics
            output_path: Optional path to save the report

    Returns:
            Markdown string

    Example:
            >>> report = BenchmarkReport(...)
            >>> markdown = generate_markdown_report(report, "results/report.md")
            >>> print(markdown)
    """
    lines = []

    # Header
    lines.append("# LongMemEval Benchmark Report")
    lines.append("")
    lines.append(f"**Generated:** {report.timestamp.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"**Dataset:** {report.dataset_path}")
    lines.append(f"**Total Instances:** {report.total_instances}")
    lines.append("")

    # Model configuration
    if report.model_name or report.embedding_model or report.reranker_model:
        lines.append("## Configuration")
        lines.append("")

        if report.model_name:
            lines.append(f"- **LLM Model:** {report.model_name}")
        if report.embedding_model:
            lines.append(f"- **Embedding Model:** {report.embedding_model}")
        if report.reranker_model:
            lines.append(f"- **Reranker Model:** {report.reranker_model}")
        if report.retrieval_strategy:
            lines.append(f"- **Retrieval Strategy:** {report.retrieval_strategy}")

        lines.append("")

    # Overall metrics
    lines.append("## Overall Performance")
    lines.append("")
    lines.append(_format_ability_metrics_table([("Overall", report.metrics.overall)]))
    lines.append("")

    # Per-ability breakdown
    lines.append("## Performance by Memory Ability")
    lines.append("")

    ability_items = [(ability, metrics) for ability, metrics in report.metrics.by_ability.items()]
    lines.append(_format_ability_metrics_table(ability_items))
    lines.append("")

    # Retrieval metrics
    if report.metrics.retrieval is not None:
        lines.append("## Retrieval Metrics")
        lines.append("")
        lines.append(_format_retrieval_metrics(report.metrics.retrieval))
        lines.append("")

    # Abstention metrics
    if report.metrics.abstention is not None:
        lines.append("## Abstention Metrics")
        lines.append("")
        lines.append(_format_abstention_metrics(report.metrics.abstention))
        lines.append("")

    markdown = "\n".join(lines)

    # Save if output path specified
    if output_path is not None:
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(markdown, encoding="utf-8")

    return markdown


def _format_ability_metrics_table(items: list[tuple[str, AbilityMetrics]]) -> str:
    """Format ability metrics as a Markdown table."""
    lines = [
        "| Ability | Total | Correct | Accuracy |",
        "|---------|-------|---------|----------|",
    ]

    for name, metrics in items:
        # Expand ability abbreviations
        display_name = _expand_ability_name(name)
        accuracy_pct = f"{metrics.accuracy * 100:.1f}%"

        lines.append(f"| {display_name} | {metrics.total} | {metrics.correct} | {accuracy_pct} |")

    return "\n".join(lines)


def _format_retrieval_metrics(metrics: RetrievalMetrics) -> str:
    """Format retrieval metrics as Markdown."""
    lines = []

    # Core metrics
    lines.append("### Core Metrics")
    lines.append("")
    lines.append(f"- **Turn Recall:** {metrics.turn_recall * 100:.1f}%")
    lines.append(f"- **Session Recall:** {metrics.session_recall * 100:.1f}%")
    lines.append(f"- **MRR:** {metrics.mrr:.4f}")
    lines.append("")

    # Recall@K
    lines.append("### Recall@K")
    lines.append("")
    lines.append("| K | Recall |")
    lines.append("|---|--------|")

    for k in sorted(metrics.recall_at_k.keys()):
        recall = metrics.recall_at_k[k]
        lines.append(f"| {k} | {recall * 100:.1f}% |")

    lines.append("")

    # NDCG@K
    lines.append("### NDCG@K")
    lines.append("")
    lines.append("| K | NDCG |")
    lines.append("|---|------|")

    for k in sorted(metrics.ndcg_at_k.keys()):
        ndcg = metrics.ndcg_at_k[k]
        lines.append(f"| {k} | {ndcg:.4f} |")

    return "\n".join(lines)


def _format_abstention_metrics(metrics: AbstentionMetrics) -> str:
    """Format abstention metrics as Markdown."""
    lines = []

    # Confusion matrix
    lines.append("### Confusion Matrix")
    lines.append("")
    lines.append("| | Should Abstain | Should Answer |")
    lines.append("|---|---|---|")
    lines.append(
        f"| **Did Abstain** | {metrics.true_positives} (TP) | {metrics.false_positives} (FP) |"
    )
    lines.append(
        f"| **Did Answer** | {metrics.false_negatives} (FN) | {metrics.true_negatives} (TN) |"
    )
    lines.append("")

    # Performance metrics
    lines.append("### Performance Metrics")
    lines.append("")
    lines.append(f"- **Precision:** {metrics.precision * 100:.1f}%")
    lines.append(f"- **Recall:** {metrics.recall * 100:.1f}%")
    lines.append(f"- **F1 Score:** {metrics.f1 * 100:.1f}%")

    return "\n".join(lines)


def _expand_ability_name(ability: str) -> str:
    """Expand ability abbreviation to full name."""
    ability_names = {
        "IE": "Information Extraction",
        "MR": "Multi-Session Reasoning",
        "TR": "Temporal Reasoning",
        "KU": "Knowledge Update",
        "ABS": "Abstention",
        "Overall": "Overall",
    }
    return ability_names.get(ability, ability)


def generate_json_report(report: BenchmarkReport, output_path: str | Path | None = None) -> str:
    """
    Generate a JSON-formatted benchmark report.

    Args:
            report: BenchmarkReport with all metrics
            output_path: Optional path to save the report

    Returns:
            JSON string

    Example:
            >>> report = BenchmarkReport(...)
            >>> json_str = generate_json_report(report, "results/report.json")
            >>> data = json.loads(json_str)
    """
    # Convert to dict and format
    report_dict = report.model_dump(mode="json")

    # Pretty-print JSON
    json_str = json.dumps(report_dict, indent=2, ensure_ascii=False)

    # Save if output path specified
    if output_path is not None:
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(json_str, encoding="utf-8")

    return json_str


def print_summary(report: BenchmarkReport) -> None:
    """
    Print a concise summary of the report to the console.

    Args:
            report: BenchmarkReport with metrics
    """
    from rich.console import Console
    from rich.table import Table

    console = Console()

    console.print()
    console.print("[bold cyan]Benchmark Summary[/bold cyan]")
    console.print()

    # Overall metrics
    console.print(f"[bold]Overall Accuracy:[/bold] {report.metrics.overall.accuracy * 100:.1f}%")
    console.print(f"  {report.metrics.overall.correct}/{report.metrics.overall.total} correct")
    console.print()

    # Per-ability table
    table = Table(title="Performance by Memory Ability")
    table.add_column("Ability", style="cyan")
    table.add_column("Total", justify="right")
    table.add_column("Correct", justify="right")
    table.add_column("Accuracy", justify="right", style="green")

    for ability in ["IE", "MR", "TR", "KU", "ABS"]:
        if ability in report.metrics.by_ability:
            metrics = report.metrics.by_ability[ability]
            table.add_row(
                _expand_ability_name(ability),
                str(metrics.total),
                str(metrics.correct),
                f"{metrics.accuracy * 100:.1f}%",
            )

    console.print(table)
    console.print()

    # Retrieval metrics (if available)
    if report.metrics.retrieval is not None:
        console.print("[bold]Retrieval Performance:[/bold]")
        console.print(f"  Turn Recall: {report.metrics.retrieval.turn_recall * 100:.1f}%")
        console.print(f"  Session Recall: {report.metrics.retrieval.session_recall * 100:.1f}%")
        console.print(f"  MRR: {report.metrics.retrieval.mrr:.4f}")
        console.print()

    # Abstention metrics (if available)
    if report.metrics.abstention is not None:
        console.print("[bold]Abstention Performance:[/bold]")
        console.print(f"  Precision: {report.metrics.abstention.precision * 100:.1f}%")
        console.print(f"  Recall: {report.metrics.abstention.recall * 100:.1f}%")
        console.print(f"  F1 Score: {report.metrics.abstention.f1 * 100:.1f}%")
        console.print()
