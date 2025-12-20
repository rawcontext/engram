"""
BEIR (Benchmarking Information Retrieval) wrapper.

Provides integration with the beir library for zero-shot evaluation of
information retrieval models across diverse datasets.
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


class BEIRConfig(BaseModel):
    """Configuration for BEIR benchmark evaluation."""

    model_name: str = Field(
        description="Model identifier (sentence-transformers model or custom model)"
    )
    datasets: list[str] = Field(
        default_factory=lambda: ["nfcorpus"],
        description="List of BEIR dataset names (nfcorpus, scifact, scidocs, etc.)",
    )
    split: str = Field(
        default="test",
        description="Dataset split to evaluate (test, dev)",
    )
    output_folder: Path = Field(
        default=Path("./results/beir"),
        description="Output directory for results",
    )
    batch_size: int = Field(
        default=128,
        ge=1,
        le=512,
        description="Batch size for encoding",
    )
    score_function: str = Field(
        default="cos_sim",
        description="Scoring function (cos_sim or dot)",
    )
    top_k: int = Field(
        default=100,
        ge=1,
        le=1000,
        description="Number of top documents to retrieve",
    )
    device: str = Field(
        default="cpu",
        description="Device for inference (cpu, cuda, mps, auto)",
    )
    corpus_chunk_size: int = Field(
        default=50000,
        ge=1,
        description="Chunk size for encoding corpus",
    )

    model_config = ConfigDict(arbitrary_types_allowed=True)


@dataclass
class BEIRResults:
    """Results from BEIR evaluation."""

    model_name: str
    datasets: list[str]
    scores: dict[str, dict[str, float]]
    metadata: dict[str, Any] = field(default_factory=dict)

    def get_average_ndcg(self, k: int = 10) -> float:
        """
        Calculate average NDCG@k across all datasets.

        Args:
            k: Cutoff for NDCG (default: 10)

        Returns:
            Average NDCG@k score
        """
        metric_key = f"NDCG@{k}"
        scores = []
        for dataset_scores in self.scores.values():
            if metric_key in dataset_scores:
                scores.append(dataset_scores[metric_key])

        return sum(scores) / len(scores) if scores else 0.0

    def get_average_recall(self, k: int = 100) -> float:
        """
        Calculate average Recall@k across all datasets.

        Args:
            k: Cutoff for Recall (default: 100)

        Returns:
            Average Recall@k score
        """
        metric_key = f"Recall@{k}"
        scores = []
        for dataset_scores in self.scores.values():
            if metric_key in dataset_scores:
                scores.append(dataset_scores[metric_key])

        return sum(scores) / len(scores) if scores else 0.0

    def to_dict(self) -> dict[str, Any]:
        """
        Convert results to dictionary.

        Returns:
            Dictionary representation
        """
        return {
            "model_name": self.model_name,
            "datasets": self.datasets,
            "scores": self.scores,
            "metadata": self.metadata,
            "average_ndcg@10": self.get_average_ndcg(10),
            "average_recall@100": self.get_average_recall(100),
        }


class BEIRBenchmark:
    """
    Wrapper for BEIR benchmark evaluation.

    Provides a simple interface to evaluate retrieval models using BEIR datasets.
    Supports both quick tests (single dataset) and full evaluation (multiple datasets).

    Examples:
        >>> # Quick test with single dataset
        >>> config = BEIRConfig(
        ...     model_name="BAAI/bge-base-en-v1.5",
        ...     datasets=["nfcorpus"],
        ... )
        >>> benchmark = BEIRBenchmark(config)
        >>> results = benchmark.run()
        >>> print(f"NDCG@10: {results.get_average_ndcg(10):.4f}")

        >>> # Multi-dataset evaluation
        >>> config = BEIRConfig(
        ...     model_name="sentence-transformers/all-MiniLM-L6-v2",
        ...     datasets=["nfcorpus", "scifact", "scidocs"],
        ... )
        >>> benchmark = BEIRBenchmark(config)
        >>> results = benchmark.run()
    """

    def __init__(self, config: BEIRConfig) -> None:
        """
        Initialize BEIR benchmark.

        Args:
            config: BEIR configuration
        """
        self.config = config
        self._model: Any = None

        # Ensure output directory exists
        self.config.output_folder.mkdir(parents=True, exist_ok=True)

    def _load_model(self) -> Any:
        """
        Load the embedding model for BEIR.

        Returns:
            BEIR-compatible model wrapper

        Raises:
            ImportError: If beir is not installed
        """
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
        except ImportError as e:
            raise ImportError(
                "beir is not installed. Install with: pip install 'engram-benchmark[mteb]'"
            ) from e

        logger.info(f"Loading model: {self.config.model_name}")

        # Load sentence-transformers model
        model = SentenceTransformer(self.config.model_name, device=self.config.device)

        # Wrap for BEIR compatibility
        # BEIR expects a model with encode_queries and encode_corpus methods
        class BEIRModelWrapper:
            def __init__(self, st_model: Any, batch_size: int) -> None:
                self.model = st_model
                self.batch_size = batch_size

            def encode_queries(self, queries: list[str], batch_size: int, **kwargs: Any) -> Any:
                return self.model.encode(
                    queries,
                    batch_size=batch_size,
                    show_progress_bar=True,
                    convert_to_numpy=True,
                    **kwargs,
                )

            def encode_corpus(
                self, corpus: list[dict[str, str]], batch_size: int, **kwargs: Any
            ) -> Any:
                # BEIR corpus is list of dicts with 'title' and 'text'
                sentences = [
                    (doc.get("title", "") + " " + doc.get("text", "")).strip() for doc in corpus
                ]
                return self.model.encode(
                    sentences,
                    batch_size=batch_size,
                    show_progress_bar=True,
                    convert_to_numpy=True,
                    **kwargs,
                )

        return BEIRModelWrapper(model, self.config.batch_size)

    def run(self) -> BEIRResults:
        """
        Run BEIR evaluation.

        Returns:
            BEIR evaluation results

        Raises:
            ImportError: If beir is not installed
        """
        try:
            from beir import util  # type: ignore
            from beir.datasets.data_loader import GenericDataLoader  # type: ignore
            from beir.retrieval.evaluation import EvaluateRetrieval  # type: ignore
            from beir.retrieval.search.dense import DenseRetrievalExactSearch  # type: ignore
        except ImportError as e:
            raise ImportError(
                "beir is not installed. Install with: pip install 'engram-benchmark[mteb]'"
            ) from e

        # Load model
        self._model = self._load_model()

        # Initialize retrieval model
        retrieval_model = DenseRetrievalExactSearch(
            self._model, batch_size=self.config.batch_size
        )

        # Results storage
        all_scores: dict[str, dict[str, float]] = {}

        # Evaluate on each dataset
        for dataset_name in self.config.datasets:
            logger.info(f"Evaluating on dataset: {dataset_name}")

            # Download and load dataset
            url = f"https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/{dataset_name}.zip"
            data_path = util.download_and_unzip(url, str(self.config.output_folder / "datasets"))

            # Load corpus, queries, and qrels
            corpus, queries, qrels = GenericDataLoader(data_folder=data_path).load(
                split=self.config.split
            )

            # Retrieve results
            logger.info(f"Retrieving for {len(queries)} queries from {len(corpus)} documents")
            results = retrieval_model.search(
                corpus,
                queries,
                top_k=self.config.top_k,
                score_function=self.config.score_function,
            )

            # Evaluate
            logger.info(f"Evaluating results for {dataset_name}")
            ndcg, _map, recall, precision = EvaluateRetrieval.evaluate(
                qrels, results, [1, 3, 5, 10, 100, 1000]
            )

            # Store scores
            all_scores[dataset_name] = {
                **{f"NDCG@{k}": v for k, v in ndcg.items()},
                **{f"MAP@{k}": v for k, v in _map.items()},
                **{f"Recall@{k}": v for k, v in recall.items()},
                **{f"P@{k}": v for k, v in precision.items()},
            }

            logger.info(f"{dataset_name} - NDCG@10: {ndcg[10]:.4f}, Recall@100: {recall[100]:.4f}")

        logger.info(f"BEIR evaluation complete. Results saved to {self.config.output_folder}")

        return BEIRResults(
            model_name=self.config.model_name,
            datasets=self.config.datasets,
            scores=all_scores,
            metadata={
                "split": self.config.split,
                "batch_size": self.config.batch_size,
                "score_function": self.config.score_function,
                "top_k": self.config.top_k,
                "device": self.config.device,
            },
        )

    @staticmethod
    def get_available_datasets() -> list[str]:
        """
        Get list of available BEIR datasets.

        Returns:
            List of dataset names
        """
        # Commonly used BEIR datasets
        return [
            "nfcorpus",  # Nutrition
            "scifact",  # Scientific fact verification
            "scidocs",  # Scientific paper citation prediction
            "fiqa",  # Financial QA
            "trec-covid",  # COVID-19 search
            "arguana",  # Argument retrieval
            "webis-touche2020",  # Argument retrieval
            "quora",  # Duplicate question detection
            "dbpedia-entity",  # Entity retrieval
            "fever",  # Fact verification
            "climate-fever",  # Climate fact verification
            "hotpotqa",  # Multi-hop QA
            "nq",  # Natural Questions
            "msmarco",  # MS MARCO passage ranking
            "trec-news",  # News background linking
            "robust04",  # Robust retrieval
            "signal1m",  # Tweet search
            "bioasq",  # Biomedical QA
        ]
