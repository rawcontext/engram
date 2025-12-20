"""
Custom Retriever Implementation Example.

This script demonstrates how to implement a custom retriever for the
LongMemEval benchmark. You can use this as a template to integrate
your own retrieval system.

The example shows:
1. Implementing the BaseRetriever protocol
2. Loading and indexing documents
3. Retrieving relevant contexts
4. Running the benchmark with the custom retriever
"""

import asyncio
import time
from pathlib import Path
from typing import Any

from engram_benchmark.longmemeval.pipeline import BenchmarkPipeline, PipelineConfig
from engram_benchmark.longmemeval.reader import LongMemEvalReader
from engram_benchmark.longmemeval.retriever import BaseRetriever, RetrievalContext, RetrievalResult
from engram_benchmark.longmemeval.types import ParsedInstance
from engram_benchmark.providers.llm import LiteLLMProvider


class SimpleKeywordRetriever(BaseRetriever):
    """
    Simple keyword-based retriever for demonstration.

    This retriever uses basic keyword matching to find relevant documents.
    Replace this with your own retrieval logic (e.g., Elasticsearch, Pinecone, etc.).
    """

    def __init__(self) -> None:
        """Initialize the retriever."""
        self.documents: list[dict[str, Any]] = []
        self.is_loaded = False

    async def load(self) -> None:
        """Load or initialize the retriever."""
        print("Initializing SimpleKeywordRetriever...")
        self.documents = []
        self.is_loaded = True

    async def index_instance(self, instance: ParsedInstance) -> None:
        """
        Index documents from a parsed instance.

        Args:
                instance: Parsed instance with documents to index
        """
        for doc in instance.documents:
            # Store document with metadata
            self.documents.append(
                {
                    "content": doc.content,
                    "metadata": doc.metadata,
                    "question_id": instance.question_id,
                }
            )

    async def retrieve(self, instance: ParsedInstance, top_k: int = 10) -> RetrievalResult:
        """
        Retrieve relevant contexts for a question.

        Args:
                instance: Parsed instance with question
                top_k: Number of contexts to retrieve

        Returns:
                RetrievalResult with retrieved contexts
        """
        start_time = time.time()

        # Extract keywords from question (simple tokenization)
        question_lower = instance.question.lower()
        question_keywords = {
            word.strip(".,!?;:") for word in question_lower.split() if len(word) > 3
        }

        # Score documents by keyword overlap
        scored_docs: list[tuple[float, dict[str, Any]]] = []
        for doc in self.documents:
            content_lower = doc["content"].lower()
            content_keywords = {
                word.strip(".,!?;:") for word in content_lower.split() if len(word) > 3
            }

            # Calculate overlap score (Jaccard similarity)
            intersection = len(question_keywords & content_keywords)
            union = len(question_keywords | content_keywords)
            score = intersection / union if union > 0 else 0.0

            if score > 0:
                scored_docs.append((score, doc))

        # Sort by score and take top-k
        scored_docs.sort(reverse=True, key=lambda x: x[0])
        top_docs = scored_docs[:top_k]

        # Convert to RetrievalContext objects
        contexts = [
            RetrievalContext(content=doc["content"], score=score, metadata=doc["metadata"])
            for score, doc in top_docs
        ]

        # Calculate retrieval time
        retrieval_time_ms = (time.time() - start_time) * 1000

        return RetrievalResult(
            question_id=instance.question_id,
            contexts=contexts,
            retrieval_time_ms=retrieval_time_ms,
        )


class ExternalAPIRetriever(BaseRetriever):
    """
    Example retriever that calls an external API.

    Replace this with your actual API client (e.g., Pinecone, Weaviate, etc.).
    """

    def __init__(self, api_url: str, api_key: str | None = None) -> None:
        """
        Initialize the API retriever.

        Args:
                api_url: Base URL of the retrieval API
                api_key: Optional API key for authentication
        """
        self.api_url = api_url
        self.api_key = api_key
        self.is_loaded = False

    async def load(self) -> None:
        """Initialize connection to the API."""
        print(f"Connecting to retrieval API: {self.api_url}")
        # Add your API initialization here
        self.is_loaded = True

    async def index_instance(self, instance: ParsedInstance) -> None:
        """
        Index documents via API.

        Args:
                instance: Parsed instance with documents to index
        """
        # Example: POST documents to your API
        # async with httpx.AsyncClient() as client:
        #     for doc in instance.documents:
        #         await client.post(
        #             f"{self.api_url}/index",
        #             json={"content": doc.content, "metadata": doc.metadata},
        #             headers={"Authorization": f"Bearer {self.api_key}"}
        #         )
        pass

    async def retrieve(self, instance: ParsedInstance, top_k: int = 10) -> RetrievalResult:
        """
        Retrieve contexts from API.

        Args:
                instance: Parsed instance with question
                top_k: Number of contexts to retrieve

        Returns:
                RetrievalResult with retrieved contexts
        """
        start_time = time.time()

        # Example: Query your API
        # async with httpx.AsyncClient() as client:
        #     response = await client.post(
        #         f"{self.api_url}/search",
        #         json={"query": instance.question, "top_k": top_k},
        #         headers={"Authorization": f"Bearer {self.api_key}"}
        #     )
        #     results = response.json()

        # For demo, return empty results
        contexts: list[RetrievalContext] = []
        retrieval_time_ms = (time.time() - start_time) * 1000

        return RetrievalResult(
            question_id=instance.question_id,
            contexts=contexts,
            retrieval_time_ms=retrieval_time_ms,
        )


async def main() -> None:
    """Run the benchmark with a custom retriever."""
    print("=" * 80)
    print("Custom Retriever Example")
    print("=" * 80)

    # Configuration
    dataset_path = Path("data/longmemeval_oracle.json")
    output_dir = Path("./results/custom_retriever")
    limit = 10  # Small limit for demo

    if not dataset_path.exists():
        print(f"\nError: Dataset not found at {dataset_path}")
        print(
            "Please download from: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned"
        )
        return

    print("\nUsing SimpleKeywordRetriever (basic keyword matching)")
    print("\nTo use your own retriever:")
    print("  1. Implement the BaseRetriever protocol")
    print("  2. Override load(), index_instance(), and retrieve()")
    print("  3. Replace SimpleKeywordRetriever with your class")

    # Step 1: Initialize custom retriever
    print("\n" + "=" * 80)
    print("Initializing custom retriever...")
    print("=" * 80)

    retriever = SimpleKeywordRetriever()
    await retriever.load()
    print("✓ Custom retriever initialized")

    # Step 2: Initialize LLM and reader
    print("\n" + "=" * 80)
    print("Initializing LLM and reader...")
    print("=" * 80)

    llm = LiteLLMProvider(model="openai/gpt-4o-mini")
    reader = LongMemEvalReader(llm_provider=llm)
    print("✓ LLM initialized")

    # Step 3: Create pipeline
    print("\n" + "=" * 80)
    print("Creating pipeline...")
    print("=" * 80)

    config = PipelineConfig(
        dataset_path=str(dataset_path),
        output_dir=str(output_dir),
        limit=limit,
        concurrency=3,
        top_k=5,
        use_llm_eval=False,
    )

    pipeline = BenchmarkPipeline(config, retriever, reader)
    print("✓ Pipeline created")

    # Step 4: Run benchmark
    print("\n" + "=" * 80)
    print("Running benchmark with custom retriever...")
    print("=" * 80)

    try:
        report = await pipeline.run()

        print("\n" + "=" * 80)
        print("Results:")
        print("=" * 80)
        print(f"\nOverall Accuracy: {report.metrics.overall.accuracy:.1%}")
        print(f"Total Instances: {report.total_instances}")

        if report.metrics.retrieval:
            print("\nRetrieval Metrics:")
            print(f"  MRR@5: {report.metrics.retrieval.mrr_at_5:.4f}")
            print(f"  Average Retrieval Time: {report.metrics.retrieval.mean_latency_ms:.1f}ms")

        print(f"\nReports saved to: {output_dir}")

    except Exception as e:
        print(f"\n\n✗ Error: {e}")
        import traceback

        traceback.print_exc()

    print("\n" + "=" * 80)
    print("Next Steps:")
    print("=" * 80)
    print("1. Replace SimpleKeywordRetriever with your retriever")
    print("2. Implement load(), index_instance(), and retrieve()")
    print("3. Test with a small dataset first (--limit 10)")
    print("4. Scale up to full dataset once working")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
