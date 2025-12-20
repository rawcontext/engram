"""
Configuration models for the benchmark suite.

Uses Pydantic Settings for environment variable support and validation.
"""

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

RerankerTier = Literal["fast", "accurate", "balanced"]


class RetrievalConfig(BaseSettings):
    """Configuration for retrieval settings."""

    model_config = SettingsConfigDict(
        env_prefix="BENCHMARK_RETRIEVAL_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Provider
    provider: Literal["engram", "qdrant", "chromadb"] = "engram"

    # Engram search settings
    search_url: str = Field(
        default="http://localhost:5002", description="URL of the Engram search service"
    )

    # Retrieval parameters
    hybrid_search: bool = Field(default=True, description="Use hybrid dense+sparse search")
    rerank: bool = Field(default=False, description="Enable reranking")
    rerank_tier: RerankerTier = Field(default="accurate", description="Reranker quality tier")
    top_k: int = Field(default=10, ge=1, le=100, description="Number of results to retrieve")

    # Embedding settings
    embedding_model: str = Field(
        default="BAAI/bge-base-en-v1.5", description="Embedding model for dense retrieval"
    )


class LLMConfig(BaseSettings):
    """Configuration for LLM settings."""

    model_config = SettingsConfigDict(
        env_prefix="BENCHMARK_LLM_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Model selection
    model: str = Field(
        default="anthropic/claude-sonnet-4-20250514",
        description="LLM model to use (LiteLLM format)",
    )

    # Generation parameters
    max_tokens: int = Field(default=1024, ge=1, le=8192)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)

    # Advanced features
    chain_of_note: bool = Field(default=False, description="Use Chain-of-Note reasoning")


class EvaluationConfig(BaseSettings):
    """Configuration for evaluation settings."""

    model_config = SettingsConfigDict(
        env_prefix="BENCHMARK_EVAL_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Evaluation model
    eval_model: str = Field(
        default="openai/gpt-4o", description="LLM model for evaluation judgments"
    )

    # Evaluation modes
    use_llm_eval: bool = Field(
        default=False, description="Use LLM-based evaluation instead of exact match"
    )
    ragas_enabled: bool = Field(
        default=False, description="Compute RAGAS metrics (faithfulness, context recall, etc.)"
    )

    # Metrics to compute
    metrics: list[str] = Field(
        default=["accuracy", "ndcg@10", "mrr", "abstention_f1"], description="Metrics to compute"
    )


class OutputConfig(BaseSettings):
    """Configuration for output settings."""

    model_config = SettingsConfigDict(
        env_prefix="BENCHMARK_OUTPUT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Output format
    format: Literal["jsonl", "json", "csv"] = Field(
        default="jsonl", description="Output format for results"
    )
    report: Literal["markdown", "json", "html"] = Field(
        default="markdown", description="Report format"
    )

    # Output paths
    output_dir: Path = Field(default=Path("./results"), description="Directory for output files")
    cache_dir: Path = Field(
        default=Path.home() / ".cache" / "engram-benchmark", description="Directory for cached data"
    )

    # Output options
    save_predictions: bool = Field(default=True, description="Save prediction outputs")
    save_reports: bool = Field(default=True, description="Save evaluation reports")


class BenchmarkConfig(BaseSettings):
    """Main benchmark configuration."""

    model_config = SettingsConfigDict(
        env_prefix="BENCHMARK_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Dataset settings
    dataset_path: Path = Field(
        default=Path("./data/longmemeval_oracle.json"),
        description="Path to the LongMemEval dataset",
    )
    dataset_variant: Literal["s", "m", "oracle"] | None = Field(
        default="oracle", description="Dataset variant (s=115k tokens, m=1.5M tokens, oracle=gold)"
    )
    limit: int | None = Field(
        default=None, ge=1, description="Limit number of instances to evaluate"
    )

    # Component configs
    retrieval: RetrievalConfig = Field(default_factory=RetrievalConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    evaluation: EvaluationConfig = Field(default_factory=EvaluationConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)

    # API keys (loaded from environment)
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    google_api_key: str | None = Field(default=None, alias="GOOGLE_API_KEY")
    xai_api_key: str | None = Field(default=None, alias="XAI_API_KEY")


def load_config(config_file: Path | None = None) -> BenchmarkConfig:
    """
    Load benchmark configuration from environment and optional config file.

    Args:
            config_file: Optional YAML config file to load

    Returns:
            Validated BenchmarkConfig instance
    """
    if config_file is not None and config_file.exists():
        import yaml

        with open(config_file, encoding="utf-8") as f:
            config_data = yaml.safe_load(f)
        return BenchmarkConfig(**config_data)

    return BenchmarkConfig()
