"""
Metrics module for benchmark evaluation.

Provides blazing-fast evaluation metrics for:
- Retrieval: ranx-based IR metrics (NDCG, MRR, Recall, MAP)
- QA: Accuracy with optional LLM evaluation
- Abstention: Precision/Recall/F1 for abstention detection
- RAGAS: RAG-specific metrics (faithfulness, context recall)
- Latency: Percentile tracking (p50, p90, p95, p99)

Example:
        ```python
        from engram_benchmark.metrics import (
                evaluate_retrieval,
                evaluate_qa,
                evaluate_abstention,
                evaluate_ragas,
                compute_latency_percentiles,
        )

        # Retrieval metrics
        retrieval_metrics = evaluate_retrieval(qrels, runs)

        # QA metrics
        qa_metrics = await evaluate_qa(predictions, ground_truth, question_types)

        # Abstention metrics
        abstention_metrics = evaluate_abstention(predictions, ground_truth, is_abstention)

        # RAGAS metrics
        ragas_metrics = await evaluate_ragas(questions, answers, contexts, ground_truths)

        # Latency metrics
        latency_metrics = compute_latency_percentiles(latencies)
        ```
"""

from engram_benchmark.metrics.abstention import (
    ABSTENTION_PHRASES,
    add_abstention_phrase,
    evaluate_abstention,
)
from engram_benchmark.metrics.latency import (
    LatencyMetrics,
    LatencyTracker,
    compute_custom_percentiles,
    compute_latency_percentiles,
)
from engram_benchmark.metrics.qa import evaluate_qa, evaluate_qa_sync
from engram_benchmark.metrics.ragas import (
    RAGASMetrics,
    evaluate_ragas,
    evaluate_ragas_subset,
)
from engram_benchmark.metrics.retrieval import evaluate_retrieval

__all__ = [
    # Retrieval
    "evaluate_retrieval",
    # QA
    "evaluate_qa",
    "evaluate_qa_sync",
    # Abstention
    "evaluate_abstention",
    "add_abstention_phrase",
    "ABSTENTION_PHRASES",
    # RAGAS
    "evaluate_ragas",
    "evaluate_ragas_subset",
    "RAGASMetrics",
    # Latency
    "compute_latency_percentiles",
    "compute_custom_percentiles",
    "LatencyMetrics",
    "LatencyTracker",
]
