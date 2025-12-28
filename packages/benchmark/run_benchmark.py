#!/usr/bin/env python3
"""Direct benchmark runner without CLI/Rich progress bar issues."""

import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


async def main() -> None:
    """Run the benchmark pipeline directly."""
    from engram_benchmark.longmemeval.pipeline import BenchmarkPipeline, PipelineConfig
    from engram_benchmark.longmemeval.reader import LongMemEvalReader
    from engram_benchmark.longmemeval.retriever import EngramRetriever
    from engram_benchmark.providers.engram import EngramSearchClient
    from engram_benchmark.providers.llm import LiteLLMProvider

    # Configuration
    dataset_path = Path("data/longmemeval_oracle.json")
    output_dir = Path(f"results/full-500-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
    search_url = "https://api.statient.com"
    model = "gemini/gemini-3-flash-preview"
    top_k = 10
    concurrency = 10  # Max concurrency for speed
    rerank = True
    rerank_tier = "accurate"
    search_strategy = "hybrid"

    logger.info(f"Starting benchmark run")
    logger.info(f"  Dataset: {dataset_path}")
    logger.info(f"  Output: {output_dir}")
    logger.info(f"  Search URL: {search_url}")
    logger.info(f"  Model: {model}")
    logger.info(f"  Top-K: {top_k}")
    logger.info(f"  Concurrency: {concurrency}")

    # Initialize Engram search client with higher timeout for reranking
    search_client = EngramSearchClient(base_url=search_url, timeout=180.0)

    # Test connection
    try:
        health = await search_client.health()
        logger.info(f"Connected to Engram search-py: {health.status}")
    except Exception as e:
        logger.error(f"Failed to connect to Engram search-py: {e}")
        sys.exit(1)

    # Create retriever
    retriever = EngramRetriever(
        client=search_client,
        strategy=search_strategy,
        rerank=rerank,
        rerank_tier=rerank_tier,
    )

    # Create LLM provider and reader with higher timeout for Chain-of-Note
    llm = LiteLLMProvider(model=model, timeout=180.0)
    reader = LongMemEvalReader(llm_provider=llm)

    # Create pipeline config
    config = PipelineConfig(
        dataset_path=str(dataset_path),
        output_dir=str(output_dir),
        limit=None,  # Run all 500 instances
        concurrency=concurrency,
        top_k=top_k,
        use_llm_eval=True,  # Use LLM-based evaluation for semantic matching
        llm_eval_model=model,  # Use same Gemini model for eval
        ragas_enabled=False,
    )

    # Run pipeline
    logger.info("Starting benchmark pipeline...")
    pipeline = BenchmarkPipeline(config, retriever, reader)
    report = await pipeline.run()

    # Print summary
    logger.info("=" * 60)
    logger.info("BENCHMARK RESULTS")
    logger.info("=" * 60)
    logger.info(f"Total instances: {report.total_instances}")
    logger.info(f"Overall accuracy: {report.metrics.overall.accuracy:.2%}")
    logger.info("")
    logger.info("By ability:")
    for ability, stats in report.metrics.by_ability.items():
        logger.info(f"  {ability}: {stats.correct}/{stats.total} ({stats.accuracy:.2%})")
    logger.info("")
    logger.info("Retrieval metrics:")
    if report.metrics.retrieval:
        logger.info(f"  Turn recall: {report.metrics.retrieval.turn_recall:.2%}")
        logger.info(f"  Session recall: {report.metrics.retrieval.session_recall:.2%}")
        logger.info(f"  MRR: {report.metrics.retrieval.mrr:.4f}")
        logger.info(f"  MAP: {report.metrics.retrieval.map:.4f}")
        for k, v in report.metrics.retrieval.recall_at_k.items():
            logger.info(f"  Recall@{k}: {v:.4f}")
    logger.info("")
    logger.info("Latency (ms):")
    if report.metrics.latency:
        lat = report.metrics.latency
        if isinstance(lat, dict):
            logger.info(f"  Retrieval P50: {lat.get('retrieval_p50_ms', 0):.1f}")
            logger.info(f"  Retrieval P95: {lat.get('retrieval_p95_ms', 0):.1f}")
            logger.info(f"  Reader P50: {lat.get('reader_p50_ms', 0):.1f}")
            logger.info(f"  Reader P95: {lat.get('reader_p95_ms', 0):.1f}")
            logger.info(f"  Total P50: {lat.get('total_p50_ms', 0):.1f}")
            logger.info(f"  Total P95: {lat.get('total_p95_ms', 0):.1f}")
        else:
            logger.info(f"  Retrieval P50: {lat.retrieval_p50_ms:.1f}")
            logger.info(f"  Retrieval P95: {lat.retrieval_p95_ms:.1f}")
            logger.info(f"  Reader P50: {lat.reader_p50_ms:.1f}")
            logger.info(f"  Reader P95: {lat.reader_p95_ms:.1f}")
            logger.info(f"  Total P50: {lat.total_p50_ms:.1f}")
            logger.info(f"  Total P95: {lat.total_p95_ms:.1f}")
    logger.info("=" * 60)
    logger.info(f"Reports saved to: {output_dir}")


if __name__ == "__main__":
    asyncio.run(main())
