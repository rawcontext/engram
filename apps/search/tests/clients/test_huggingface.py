"""Tests for HuggingFace embedder client."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.clients.huggingface import HuggingFaceEmbedder


@pytest.fixture
def mock_api_token() -> str:
    """Mock HuggingFace API token."""
    return "hf_test_token_123"


@pytest.fixture
def bge_embedder(mock_api_token: str) -> HuggingFaceEmbedder:
    """Create BGE embedder instance."""
    return HuggingFaceEmbedder(
        model_id="BAAI/bge-small-en-v1.5",
        api_token=mock_api_token,
        timeout=30,
        max_retries=3,
    )


@pytest.fixture
def nomic_embedder(mock_api_token: str) -> HuggingFaceEmbedder:
    """Create Nomic embedder instance."""
    return HuggingFaceEmbedder(
        model_id="nomic-ai/nomic-embed-text-v1.5",
        api_token=mock_api_token,
        timeout=30,
        max_retries=3,
    )


class TestHuggingFaceEmbedderInit:
    """Tests for HuggingFaceEmbedder initialization."""

    def test_init_with_bge_model(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test initialization with BGE model."""
        assert bge_embedder.model_id == "BAAI/bge-small-en-v1.5"
        assert bge_embedder.dimensions == 384
        assert bge_embedder.timeout == 30
        assert bge_embedder.max_retries == 3

    def test_init_with_nomic_model(self, nomic_embedder: HuggingFaceEmbedder) -> None:
        """Test initialization with Nomic model."""
        assert nomic_embedder.model_id == "nomic-ai/nomic-embed-text-v1.5"
        assert nomic_embedder.dimensions == 768
        assert nomic_embedder.timeout == 30

    def test_init_with_unknown_model(self, mock_api_token: str) -> None:
        """Test initialization with unknown model uses defaults."""
        embedder = HuggingFaceEmbedder(
            model_id="unknown/model",
            api_token=mock_api_token,
        )
        assert embedder.dimensions == 768  # Default dimensions
        assert embedder.config["query_prefix"] == ""  # No prefix


class TestHuggingFaceEmbedderEmbed:
    """Tests for single text embedding."""

    async def test_embed_returns_vector(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test that embed returns a vector of correct dimensions."""
        mock_embedding = [0.1] * 384  # BGE dimensions

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            mock_fe.return_value = mock_embedding

            result = await bge_embedder.embed("test query")

            assert isinstance(result, list)
            assert len(result) == 384
            assert all(isinstance(x, float) for x in result)
            mock_fe.assert_called_once()

    async def test_embed_applies_query_prefix_for_bge(
        self, bge_embedder: HuggingFaceEmbedder
    ) -> None:
        """Test that BGE model applies query prefix when is_query=True."""
        mock_embedding = [0.1] * 384

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            mock_fe.return_value = mock_embedding

            await bge_embedder.embed("test query", is_query=True)

            # Verify the prefix was added
            call_args = mock_fe.call_args
            text_arg = call_args.kwargs.get("text") or call_args.args[0]
            assert text_arg.startswith("Represent this sentence for searching relevant passages: ")
            assert "test query" in text_arg

    async def test_embed_no_prefix_for_documents(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test that no prefix is added when is_query=False."""
        mock_embedding = [0.1] * 384

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            mock_fe.return_value = mock_embedding

            await bge_embedder.embed("test document", is_query=False)

            # Verify no prefix was added
            call_args = mock_fe.call_args
            text_arg = call_args.kwargs.get("text") or call_args.args[0]
            assert text_arg == "test document"

    async def test_embed_applies_nomic_prefix(self, nomic_embedder: HuggingFaceEmbedder) -> None:
        """Test that Nomic model applies its specific prefix."""
        mock_embedding = [0.1] * 768

        with patch.object(
            nomic_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            mock_fe.return_value = mock_embedding

            await nomic_embedder.embed("test query", is_query=True)

            call_args = mock_fe.call_args
            text_arg = call_args.kwargs.get("text") or call_args.args[0]
            assert text_arg.startswith("search_query: ")

    async def test_embed_handles_nested_list_response(
        self, bge_embedder: HuggingFaceEmbedder
    ) -> None:
        """Test that nested list responses are handled correctly."""
        # Some API responses return [[embedding]] instead of [embedding]
        mock_embedding = [[0.1] * 384]

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            mock_fe.return_value = mock_embedding

            result = await bge_embedder.embed("test")

            assert isinstance(result, list)
            assert len(result) == 384
            assert not isinstance(result[0], list)

    async def test_embed_retries_on_rate_limit(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test that embed retries on 429 rate limit errors."""
        mock_embedding = [0.1] * 384

        # Create a mock response for 429 error
        mock_response = MagicMock()
        mock_response.status_code = 429

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            # First call raises 429, second succeeds
            mock_fe.side_effect = [
                httpx.HTTPStatusError("Rate limited", request=MagicMock(), response=mock_response),
                mock_embedding,
            ]

            # Mock asyncio.sleep to avoid waiting
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await bge_embedder.embed("test")

            assert len(result) == 384
            assert mock_fe.call_count == 2

    async def test_embed_retries_on_timeout(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test that embed retries on timeout errors."""
        mock_embedding = [0.1] * 384

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            # First call times out, second succeeds
            mock_fe.side_effect = [
                httpx.TimeoutException("Request timed out"),
                mock_embedding,
            ]

            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await bge_embedder.embed("test")

            assert len(result) == 384
            assert mock_fe.call_count == 2

    async def test_embed_fails_after_max_retries(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test that embed fails after exhausting retries."""
        mock_response = MagicMock()
        mock_response.status_code = 429

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            # Always raise rate limit error
            mock_fe.side_effect = httpx.HTTPStatusError(
                "Rate limited", request=MagicMock(), response=mock_response
            )

            with patch("asyncio.sleep", new_callable=AsyncMock), pytest.raises(httpx.HTTPError):
                await bge_embedder.embed("test")

            # Should have tried max_retries times
            assert mock_fe.call_count == bge_embedder.max_retries

    async def test_embed_raises_on_non_retryable_error(
        self, bge_embedder: HuggingFaceEmbedder
    ) -> None:
        """Test that non-retryable errors are raised immediately."""
        mock_response = MagicMock()
        mock_response.status_code = 401  # Unauthorized

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            mock_fe.side_effect = httpx.HTTPStatusError(
                "Unauthorized", request=MagicMock(), response=mock_response
            )

            with pytest.raises(httpx.HTTPStatusError):
                await bge_embedder.embed("test")

            # Should fail immediately without retries
            assert mock_fe.call_count == 1

    async def test_embed_handles_unexpected_format(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test that unexpected response formats raise an error."""
        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            # Return unexpected format (e.g., a dict instead of list)
            mock_fe.return_value = {"embedding": [0.1] * 384}

            with pytest.raises(ValueError, match="Unexpected embedding format"):
                await bge_embedder.embed("test")


class TestHuggingFaceEmbedderEmbedBatch:
    """Tests for batch embedding."""

    async def test_embed_batch_returns_multiple_vectors(
        self, bge_embedder: HuggingFaceEmbedder
    ) -> None:
        """Test that embed_batch returns multiple vectors."""
        mock_embedding = [0.1] * 384

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            mock_fe.return_value = mock_embedding

            texts = ["query 1", "query 2", "query 3"]
            results = await bge_embedder.embed_batch(texts)

            assert len(results) == 3
            assert all(len(emb) == 384 for emb in results)
            assert mock_fe.call_count == 3  # Called once per text

    async def test_embed_batch_with_empty_list(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test that embed_batch handles empty list."""
        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            results = await bge_embedder.embed_batch([])

            assert results == []
            mock_fe.assert_not_called()

    async def test_embed_batch_applies_query_prefix(
        self, bge_embedder: HuggingFaceEmbedder
    ) -> None:
        """Test that batch embedding applies query prefix when needed."""
        mock_embedding = [0.1] * 384

        with patch.object(
            bge_embedder._client, "feature_extraction", new_callable=AsyncMock
        ) as mock_fe:
            mock_fe.return_value = mock_embedding

            texts = ["query 1", "query 2"]
            await bge_embedder.embed_batch(texts, is_query=True)

            # Check all calls had the prefix
            for call in mock_fe.call_args_list:
                text_arg = call.kwargs.get("text") or call.args[0]
                assert text_arg.startswith(
                    "Represent this sentence for searching relevant passages: "
                )

    async def test_embed_batch_concurrent_execution(
        self, bge_embedder: HuggingFaceEmbedder
    ) -> None:
        """Test that batch embedding executes concurrently."""
        mock_embedding = [0.1] * 384

        call_order = []

        async def mock_feature_extraction(text: str, model: str) -> list[float]:
            call_order.append(text)
            return mock_embedding

        with patch.object(
            bge_embedder._client, "feature_extraction", side_effect=mock_feature_extraction
        ):
            texts = ["text1", "text2", "text3"]
            await bge_embedder.embed_batch(texts, is_query=False)

            # All calls should have been made (order may vary due to concurrency)
            assert len(call_order) == 3
            assert all(text in call_order for text in texts)


class TestHuggingFaceEmbedderContextManager:
    """Tests for async context manager."""

    async def test_context_manager_usage(self, mock_api_token: str) -> None:
        """Test that embedder works as async context manager."""
        async with HuggingFaceEmbedder(
            model_id="BAAI/bge-small-en-v1.5",
            api_token=mock_api_token,
        ) as embedder:
            assert embedder is not None
            assert embedder.model_id == "BAAI/bge-small-en-v1.5"

    async def test_close_cleanup(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test that close method performs cleanup."""
        # Mock the internal client
        mock_internal_client = AsyncMock()
        bge_embedder._client._client = mock_internal_client

        await bge_embedder.close()

        # Verify close was called on internal client
        mock_internal_client.aclose.assert_called_once()

    async def test_close_handles_missing_internal_client(
        self, bge_embedder: HuggingFaceEmbedder
    ) -> None:
        """Test that close handles missing internal client gracefully."""
        # Remove the internal client attribute
        if hasattr(bge_embedder._client, "_client"):
            delattr(bge_embedder._client, "_client")

        # Should not raise an error
        await bge_embedder.close()


class TestHuggingFaceEmbedderDimensions:
    """Tests for dimensions property."""

    def test_dimensions_bge(self, bge_embedder: HuggingFaceEmbedder) -> None:
        """Test dimensions for BGE model."""
        assert bge_embedder.dimensions == 384

    def test_dimensions_nomic(self, nomic_embedder: HuggingFaceEmbedder) -> None:
        """Test dimensions for Nomic model."""
        assert nomic_embedder.dimensions == 768

    def test_dimensions_unknown_model(self, mock_api_token: str) -> None:
        """Test dimensions for unknown model."""
        embedder = HuggingFaceEmbedder(
            model_id="unknown/model",
            api_token=mock_api_token,
        )
        assert embedder.dimensions == 768  # Default
