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


def compute_retrieval_metrics(
    retrieval_results: list,
) -> RetrievalMetrics:
    """
    Compute aggregate retrieval metrics from a list of RetrievalResult objects.

    Args:
            retrieval_results: List of RetrievalResult objects from pipeline

    Returns:
            Aggregated RetrievalMetrics

    Example:
            ```python
            results = [result1, result2, result3]
            metrics = compute_retrieval_metrics(results)
            print(f"Average turn recall: {metrics.turn_recall:.2f}")
            ```
    """
    if not retrieval_results:
        return RetrievalMetrics(
            turn_recall=0.0,
            session_recall=0.0,
            recall_at_k={1: 0.0, 5: 0.0, 10: 0.0},
            ndcg_at_k={1: 0.0, 5: 0.0, 10: 0.0},
            mrr=0.0,
        )

    # Aggregate turn and session recall by averaging
    total_turn_recall = sum(r.turn_recall for r in retrieval_results)
    total_session_recall = sum(r.session_recall for r in retrieval_results)
    num_results = len(retrieval_results)

    # Compute per-K metrics (recall@K, NDCG@K, MRR)
    k_values = [1, 5, 10]
    recall_at_k: dict[int, float] = {}
    ndcg_at_k: dict[int, float] = {}
    mrr_scores: list[float] = []

    for result in retrieval_results:
        # Build relevance list (1 if has_answer, 0 otherwise)
        relevance = [1 if ctx.has_answer else 0 for ctx in result.contexts]

        # Compute Recall@K for each K
        for k in k_values:
            # Recall@K: fraction of relevant items in top-K
            top_k_relevance = relevance[:k]
            recall = sum(top_k_relevance) / sum(relevance) if sum(relevance) > 0 else 0.0

            if k not in recall_at_k:
                recall_at_k[k] = 0.0
            recall_at_k[k] += recall

        # Compute NDCG@K for each K
        for k in k_values:
            ndcg = _compute_ndcg(relevance, k)
            if k not in ndcg_at_k:
                ndcg_at_k[k] = 0.0
            ndcg_at_k[k] += ndcg

        # Compute MRR (Mean Reciprocal Rank)
        mrr = _compute_mrr(relevance)
        mrr_scores.append(mrr)

    # Average per-K metrics across all results
    for k in k_values:
        recall_at_k[k] /= num_results
        ndcg_at_k[k] /= num_results

    # Average MRR
    avg_mrr = sum(mrr_scores) / num_results if mrr_scores else 0.0

    return RetrievalMetrics(
        turn_recall=total_turn_recall / num_results,
        session_recall=total_session_recall / num_results,
        recall_at_k=recall_at_k,
        ndcg_at_k=ndcg_at_k,
        mrr=avg_mrr,
    )


def _compute_ndcg(relevance: list[int], k: int) -> float:
    """
    Compute Normalized Discounted Cumulative Gain at K.

    Args:
            relevance: Binary relevance list (1 for relevant, 0 for not)
            k: Cutoff rank

    Returns:
            NDCG@K score between 0 and 1
    """
    import numpy as np

    # DCG@K: sum of (relevance / log2(rank+1)) for top-K
    top_k = relevance[:k]
    if not top_k:
        return 0.0

    dcg = sum(rel / np.log2(i + 2) for i, rel in enumerate(top_k))

    # IDCG@K: DCG for ideal ranking (all relevant items first)
    ideal = sorted(relevance, reverse=True)[:k]
    idcg = sum(rel / np.log2(i + 2) for i, rel in enumerate(ideal))

    if idcg == 0:
        return 0.0

    return dcg / idcg


def _compute_mrr(relevance: list[int]) -> float:
    """
    Compute Mean Reciprocal Rank.

    Args:
            relevance: Binary relevance list (1 for relevant, 0 for not)

    Returns:
            MRR score (reciprocal of first relevant item's rank, or 0 if none)
    """
    for i, rel in enumerate(relevance):
        if rel > 0:
            return 1.0 / (i + 1)
    return 0.0
