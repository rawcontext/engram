"""
Complete LongMemEval Benchmark Example.

This script demonstrates running the full LongMemEval benchmark pipeline:
1. Load dataset
2. Initialize embedder and retriever
3. Initialize LLM and reader
4. Run benchmark pipeline
5. Generate and save reports

This is equivalent to running: engram-benchmark run
"""

import asyncio
import os
from pathlib import Path

from engram_benchmark.longmemeval.pipeline import BenchmarkPipeline, PipelineConfig
from engram_benchmark.longmemeval.reader import LongMemEvalReader
from engram_benchmark.longmemeval.retriever import ChromaRetriever
from engram_benchmark.providers.embeddings import EmbeddingProvider
from engram_benchmark.providers.llm import LiteLLMProvider


async def main() -> None:
    """Run the complete LongMemEval benchmark."""
    print("=" * 80)
    print("Engram Benchmark - Complete LongMemEval Evaluation")
    print("=" * 80)

    # Configuration
    dataset_path = Path("data/longmemeval_oracle.json")
    output_dir = Path("./results")
    limit = 50  # Limit to 50 instances for demo (set to None for full dataset)
    model = "openai/gpt-4o-mini"  # LLM for answer generation
    embedding_model = "BAAI/bge-base-en-v1.5"  # Embedding model for retrieval
    top_k = 10  # Number of contexts to retrieve
    concurrency = 5  # Number of concurrent operations

    # Check dataset exists
    if not dataset_path.exists():
        print(f"\nError: Dataset not found at {dataset_path}")
        print(
            "Please download from: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned"
        )
        return

    # Check API keys
    if not os.getenv("OPENAI_API_KEY"):
        print("\nWarning: OPENAI_API_KEY not set. Set it with:")
        print("  export OPENAI_API_KEY=sk-...")
        print("\nContinuing anyway (will fail at LLM generation)...")

    print("\nConfiguration:")
    print(f"  Dataset: {dataset_path}")
    print(f"  Output: {output_dir}")
    print(f"  Limit: {limit or 'all instances'}")
    print(f"  LLM Model: {model}")
    print(f"  Embedding Model: {embedding_model}")
    print(f"  Top-K Retrieval: {top_k}")
    print(f"  Concurrency: {concurrency}")

    # Step 1: Initialize embedding provider
    print("\n" + "=" * 80)
    print("Step 1: Initializing embedding provider...")
    print("=" * 80)

    embedder = EmbeddingProvider(model_name=embedding_model)
    await embedder.load()
    print(f"✓ Loaded embedding model: {embedding_model}")

    # Step 2: Initialize retriever
    print("\n" + "=" * 80)
    print("Step 2: Initializing ChromaDB retriever...")
    print("=" * 80)

    retriever = ChromaRetriever(embedder=embedder)
    await retriever.load()
    print("✓ ChromaDB retriever initialized")

    # Step 3: Initialize LLM and reader
    print("\n" + "=" * 80)
    print("Step 3: Initializing LLM and reader...")
    print("=" * 80)

    llm = LiteLLMProvider(model=model)
    reader = LongMemEvalReader(llm_provider=llm)
    print(f"✓ LLM provider initialized: {model}")

    # Step 4: Create pipeline configuration
    print("\n" + "=" * 80)
    print("Step 4: Creating pipeline configuration...")
    print("=" * 80)

    config = PipelineConfig(
        dataset_path=str(dataset_path),
        output_dir=str(output_dir),
        limit=limit,
        concurrency=concurrency,
        top_k=top_k,
        granularity="turn",  # "turn" or "session"
        use_llm_eval=False,  # Set to True for LLM-based evaluation
        llm_eval_model="openai/gpt-4o",
    )
    print("✓ Pipeline configuration created")

    # Step 5: Create and run pipeline
    print("\n" + "=" * 80)
    print("Step 5: Running benchmark pipeline...")
    print("=" * 80)
    print("\nThis will:")
    print("  1. Load dataset")
    print("  2. Parse and map instances to documents")
    print("  3. Index documents in ChromaDB")
    print("  4. Retrieve relevant contexts for each question")
    print("  5. Generate answers with LLM")
    print("  6. Evaluate results and generate reports")
    print("\nProgress will be shown below:\n")

    pipeline = BenchmarkPipeline(config, retriever, reader)

    try:
        report = await pipeline.run()

        # Step 6: Display results
        print("\n" + "=" * 80)
        print("Step 6: Results Summary")
        print("=" * 80)

        print("\nOverall Metrics:")
        print(f"  Accuracy: {report.metrics.overall.accuracy:.1%}")
        print(f"  Total Instances: {report.total_instances}")

        if report.metrics.retrieval:
            print("\nRetrieval Metrics:")
            print(f"  MRR@10: {report.metrics.retrieval.mrr_at_10:.4f}")
            print(f"  NDCG@10: {report.metrics.retrieval.ndcg_at_10:.4f}")
            print(f"  Recall@10: {report.metrics.retrieval.recall_at_10:.4f}")

        if report.metrics.by_ability:
            print("\nAccuracy by Memory Ability:")
            for ability in ["IE", "MR", "TR", "KU", "ABS"]:
                ability_metrics = report.metrics.by_ability.get(ability)
                if ability_metrics and ability_metrics.total > 0:
                    acc = ability_metrics.accuracy
                    total = ability_metrics.total
                    print(f"  {ability}: {acc:.1%} ({total} instances)")

        if report.metrics.abstention:
            print("\nAbstention Detection:")
            print(f"  Precision: {report.metrics.abstention.precision:.4f}")
            print(f"  Recall: {report.metrics.abstention.recall:.4f}")
            print(f"  F1 Score: {report.metrics.abstention.f1:.4f}")

        print("\n" + "=" * 80)
        print("Evaluation complete!")
        print("=" * 80)
        print(f"\nReports saved to: {output_dir}")
        print("\nGenerated files:")
        print("  - report_*.md   (Markdown report)")
        print("  - report_*.json (JSON report)")
        print("  - results_*.jsonl (Per-instance results)")

    except Exception as e:
        print(f"\n\n✗ Error during benchmark: {e}")
        import traceback

        traceback.print_exc()
        return

    print("\n" + "=" * 80)
    print("Next Steps:")
    print("=" * 80)
    print("1. Review the Markdown report for detailed analysis")
    print("2. Use the JSON report for programmatic analysis")
    print("3. Inspect results JSONL for per-instance predictions")
    print("4. Try different models or configurations")
    print("5. Run with --llm-eval for LLM-based evaluation")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
