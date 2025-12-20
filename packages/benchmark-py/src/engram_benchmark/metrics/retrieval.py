"""
Retrieval metrics using ranx.

Implements blazing-fast IR metrics using ranx (Numba-optimized):
- Recall@K: Percentage of relevant documents retrieved in top-K
- NDCG@K: Normalized Discounted Cumulative Gain - measures ranking quality
- MRR: Mean Reciprocal Rank - focuses on position of first relevant result
- MAP: Mean Average Precision - average of precision at each relevant result

Based on ranx: https://amenra.github.io/ranx/
"""

from ranx import Qrels, Run, evaluate

from engram_benchmark.longmemeval.types import RetrievalMetrics


def evaluate_retrieval(
    qrels: dict[str, dict[str, int]],
    runs: dict[str, dict[str, float]],
    k_values: list[int] | None = None,
) -> RetrievalMetrics:
    """
    Evaluate retrieval using ranx-based IR metrics.

    Args:
            qrels: Ground truth relevance judgments
                       Format: query_id -> doc_id -> relevance_score
                       Example: {"q1": {"d1": 1, "d2": 0}, "q2": {"d3": 1}}
            runs: Retrieved results with scores
                      Format: query_id -> doc_id -> score
                      Example: {"q1": {"d1": 0.9, "d2": 0.1}, "q2": {"d3": 0.8}}
            k_values: K values for recall/NDCG (default: [1, 5, 10])

    Returns:
            RetrievalMetrics with recall@K, NDCG@K, MRR, and turn/session recall

    Example:
            ```python
            qrels = {
                    "q1": {"doc1": 1, "doc2": 0, "doc3": 1},
                    "q2": {"doc4": 1}
            }
            runs = {
                    "q1": {"doc1": 0.9, "doc3": 0.7, "doc2": 0.1},
                    "q2": {"doc5": 0.8, "doc4": 0.6}
            }
            metrics = evaluate_retrieval(qrels, runs)
            print(f"NDCG@10: {metrics.ndcg_at_k[10]:.3f}")
            print(f"MRR: {metrics.mrr:.3f}")
            ```
    """
    if k_values is None:
        k_values = [1, 5, 10]

    # Create ranx objects
    qrels_obj = Qrels(qrels)
    run_obj = Run(runs)

    # Build metric names
    metric_names = (
        [f"recall@{k}" for k in k_values] + [f"ndcg@{k}" for k in k_values] + ["mrr", "map"]
    )

    # Evaluate all metrics at once (ranx is highly optimized)
    results = evaluate(qrels_obj, run_obj, metric_names)

    # Compute turn/session recall
    # Turn recall: percentage of evidence turns retrieved
    # Session recall: percentage of evidence sessions retrieved
    turn_recall = _compute_turn_recall(qrels, runs)
    session_recall = _compute_session_recall(qrels, runs)

    # Build result object
    return RetrievalMetrics(
        turn_recall=turn_recall,
        session_recall=session_recall,
        recall_at_k={k: float(results[f"recall@{k}"]) for k in k_values},
        ndcg_at_k={k: float(results[f"ndcg@{k}"]) for k in k_values},
        mrr=float(results["mrr"]),
    )


def _compute_turn_recall(
    qrels: dict[str, dict[str, int]], runs: dict[str, dict[str, float]]
) -> float:
    """
    Compute turn-level recall (percentage of evidence turns retrieved).

    A turn is considered recalled if it appears in the retrieved results
    with a relevance score > 0 in qrels.
    """
    total_relevant = 0
    retrieved_relevant = 0

    for query_id, query_qrels in qrels.items():
        query_runs = runs.get(query_id, {})

        # Count relevant documents for this query
        relevant_docs = {doc_id for doc_id, rel in query_qrels.items() if rel > 0}
        total_relevant += len(relevant_docs)

        # Count how many were retrieved
        retrieved_docs = set(query_runs.keys())
        retrieved_relevant += len(relevant_docs & retrieved_docs)

    if total_relevant == 0:
        return 0.0

    return retrieved_relevant / total_relevant


def _compute_session_recall(
    qrels: dict[str, dict[str, int]], runs: dict[str, dict[str, float]]
) -> float:
    """
    Compute session-level recall (percentage of evidence sessions retrieved).

    Assumes doc IDs are formatted as "session_id:turn_index".
    A session is considered recalled if at least one turn from that session
    is retrieved.
    """
    total_sessions = set()
    retrieved_sessions = set()

    for query_id, query_qrels in qrels.items():
        query_runs = runs.get(query_id, {})

        # Extract sessions from relevant documents
        for doc_id, rel in query_qrels.items():
            if rel > 0:
                session_id = doc_id.split(":")[0]
                total_sessions.add(session_id)

                # Check if this session was retrieved
                if any(run_doc.startswith(f"{session_id}:") for run_doc in query_runs):
                    retrieved_sessions.add(session_id)

    if len(total_sessions) == 0:
        return 0.0

    return len(retrieved_sessions) / len(total_sessions)
