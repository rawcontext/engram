"""Tests for benchmark configuration."""

from pathlib import Path
from unittest.mock import patch

import pytest

from engram_benchmark.config import (
    BenchmarkConfig,
    EvaluationConfig,
    LLMConfig,
    OutputConfig,
    RetrievalConfig,
    load_config,
)


class TestRetrievalConfig:
    """Tests for RetrievalConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = RetrievalConfig()

        assert config.provider == "engram"
        assert config.search_url == "http://localhost:5002"
        assert config.hybrid_search is True
        assert config.rerank is False
        assert config.rerank_tier == "accurate"
        assert config.top_k == 10
        assert config.embedding_model == "BAAI/bge-base-en-v1.5"

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = RetrievalConfig(
            provider="qdrant",
            search_url="http://custom:8080",
            hybrid_search=False,
            rerank=True,
            rerank_tier="fast",
            top_k=20,
            embedding_model="custom/model",
        )

        assert config.provider == "qdrant"
        assert config.search_url == "http://custom:8080"
        assert config.hybrid_search is False
        assert config.rerank is True
        assert config.rerank_tier == "fast"
        assert config.top_k == 20
        assert config.embedding_model == "custom/model"


class TestLLMConfig:
    """Tests for LLMConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = LLMConfig()

        assert config.model == "anthropic/claude-sonnet-4-20250514"
        assert config.max_tokens == 1024
        assert config.temperature == 0.0
        assert config.chain_of_note is False

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = LLMConfig(
            model="openai/gpt-4o",
            max_tokens=2048,
            temperature=0.5,
            chain_of_note=True,
        )

        assert config.model == "openai/gpt-4o"
        assert config.max_tokens == 2048
        assert config.temperature == 0.5
        assert config.chain_of_note is True


class TestEvaluationConfig:
    """Tests for EvaluationConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = EvaluationConfig()

        assert config.eval_model == "openai/gpt-4o"
        assert config.use_llm_eval is False
        assert config.ragas_enabled is False
        assert "accuracy" in config.metrics

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = EvaluationConfig(
            eval_model="anthropic/claude-3-opus",
            use_llm_eval=True,
            ragas_enabled=True,
            metrics=["ndcg@10", "mrr"],
        )

        assert config.eval_model == "anthropic/claude-3-opus"
        assert config.use_llm_eval is True
        assert config.ragas_enabled is True
        assert config.metrics == ["ndcg@10", "mrr"]


class TestOutputConfig:
    """Tests for OutputConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = OutputConfig()

        assert config.format == "jsonl"
        assert config.report == "markdown"
        assert config.output_dir == Path("./results")
        assert config.save_predictions is True
        assert config.save_reports is True

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = OutputConfig(
            format="json",
            report="html",
            output_dir=Path("/custom/output"),
            save_predictions=False,
            save_reports=False,
        )

        assert config.format == "json"
        assert config.report == "html"
        assert config.output_dir == Path("/custom/output")
        assert config.save_predictions is False
        assert config.save_reports is False


class TestBenchmarkConfig:
    """Tests for BenchmarkConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = BenchmarkConfig()

        assert config.dataset_path == Path("./data/longmemeval_oracle.json")
        assert config.dataset_variant == "oracle"
        assert config.limit is None
        assert config.anthropic_api_key is None

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = BenchmarkConfig(
            dataset_path=Path("/custom/dataset.json"),
            dataset_variant="s",
            limit=100,
        )

        assert config.dataset_path == Path("/custom/dataset.json")
        assert config.dataset_variant == "s"
        assert config.limit == 100

    def test_nested_configs(self) -> None:
        """Test that nested configs are properly initialized."""
        config = BenchmarkConfig()

        assert isinstance(config.retrieval, RetrievalConfig)
        assert isinstance(config.llm, LLMConfig)
        assert isinstance(config.evaluation, EvaluationConfig)
        assert isinstance(config.output, OutputConfig)

    def test_api_keys_from_env(self) -> None:
        """Test loading API keys from environment."""
        with patch.dict(
            "os.environ",
            {
                "ANTHROPIC_API_KEY": "sk-ant-test",
                "OPENAI_API_KEY": "sk-openai-test",
            },
        ):
            config = BenchmarkConfig()
            # API keys are loaded via alias from environment
            assert config.anthropic_api_key == "sk-ant-test"
            assert config.openai_api_key == "sk-openai-test"


class TestLoadConfig:
    """Tests for load_config function."""

    def test_load_default_config(self) -> None:
        """Test loading default config without file."""
        config = load_config()

        assert isinstance(config, BenchmarkConfig)
        assert config.dataset_variant == "oracle"

    def test_load_nonexistent_file(self) -> None:
        """Test loading config with nonexistent file falls back to defaults."""
        config = load_config(Path("/nonexistent/config.yaml"))

        assert isinstance(config, BenchmarkConfig)

    def test_load_from_yaml_file(self, tmp_path: Path) -> None:
        """Test loading config from YAML file."""
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            """
dataset_path: /custom/data.json
dataset_variant: m
limit: 50
retrieval:
  provider: qdrant
  top_k: 25
llm:
  model: openai/gpt-4o-mini
  temperature: 0.3
"""
        )

        config = load_config(config_file)

        assert config.dataset_path == Path("/custom/data.json")
        assert config.dataset_variant == "m"
        assert config.limit == 50
        assert config.retrieval.provider == "qdrant"
        assert config.retrieval.top_k == 25
        assert config.llm.model == "openai/gpt-4o-mini"
        assert config.llm.temperature == 0.3
