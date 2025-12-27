"""Tests for turn backfill script."""

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.config import Settings
from src.scripts.backfill_turns import TurnsBackfiller, main


class TestTurnsBackfiller:
    """Tests for TurnsBackfiller."""

    @pytest.fixture
    def mock_settings(self) -> Settings:
        """Create mock settings."""
        return Settings(
            qdrant_url="http://localhost:6333",
            qdrant_turns_collection="test_turns",
            falkordb_url="redis://localhost:6379",
            embedder_device="cpu",
            embedder_preload=False,
        )

    @pytest.fixture
    def backfiller(self, mock_settings: Settings) -> TurnsBackfiller:
        """Create backfiller instance."""
        return TurnsBackfiller(
            settings=mock_settings,
            batch_size=32,
            dry_run=False,
        )

    @pytest.fixture
    def dry_run_backfiller(self, mock_settings: Settings) -> TurnsBackfiller:
        """Create dry-run backfiller instance."""
        return TurnsBackfiller(
            settings=mock_settings,
            batch_size=32,
            dry_run=True,
        )

    def test_turn_to_document_success(self, backfiller: TurnsBackfiller) -> None:
        """Test converting a valid turn to document."""
        turn = {
            "turn_id": "turn-123",
            "user_content": "How do I fix this bug?",
            "assistant_preview": "Here's how you can fix it...",
            "sequence_index": 0,
            "files_touched": "['src/main.ts', 'src/utils.ts']",
            "tool_calls_count": 2,
            "input_tokens": 100,
            "output_tokens": 500,
            "timestamp": 1234567890,
            "session_id": "session-456",
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert doc.id == "turn-123"
        assert "User: How do I fix this bug?" in doc.content
        assert "Assistant: Here's how" in doc.content
        assert doc.session_id == "session-456"
        assert doc.metadata["type"] == "turn"
        assert doc.metadata["sequence_index"] == 0
        assert doc.metadata["files_touched"] == ["src/main.ts", "src/utils.ts"]
        assert doc.metadata["tool_calls_count"] == 2

    def test_turn_to_document_minimal(self, backfiller: TurnsBackfiller) -> None:
        """Test converting a minimal turn to document."""
        turn = {
            "turn_id": "turn-123",
            "user_content": "Hello",
            "assistant_preview": "Hi there!",
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert doc.id == "turn-123"
        assert "User: Hello" in doc.content
        assert "Assistant: Hi there!" in doc.content

    def test_turn_to_document_missing_id(self, backfiller: TurnsBackfiller) -> None:
        """Test that turn without id returns None."""
        turn = {
            "user_content": "Hello",
            "assistant_preview": "Hi!",
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is None

    def test_turn_to_document_no_content(self, backfiller: TurnsBackfiller) -> None:
        """Test that turn with no content returns None."""
        turn = {
            "turn_id": "turn-123",
            "user_content": "",
            "assistant_preview": "",
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is None

    def test_turn_to_document_with_code(self, backfiller: TurnsBackfiller) -> None:
        """Test that has_code is detected correctly."""
        turn = {
            "turn_id": "turn-123",
            "user_content": "Show me code",
            "assistant_preview": "Here's code:\n```python\nprint('hello')\n```",
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert doc.metadata["has_code"] is True

    def test_turn_to_document_files_touched_list(self, backfiller: TurnsBackfiller) -> None:
        """Test parsing files_touched as actual list."""
        turn = {
            "turn_id": "turn-123",
            "user_content": "Test",
            "assistant_preview": "Response",
            "files_touched": ["file1.ts", "file2.ts"],
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert doc.metadata["files_touched"] == ["file1.ts", "file2.ts"]

    def test_turn_to_document_files_touched_none(self, backfiller: TurnsBackfiller) -> None:
        """Test handling None files_touched."""
        turn = {
            "turn_id": "turn-123",
            "user_content": "Test",
            "assistant_preview": "Response",
            "files_touched": None,
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert doc.metadata["files_touched"] == []

    @pytest.mark.asyncio
    async def test_backfill_dry_run(self, dry_run_backfiller: TurnsBackfiller) -> None:
        """Test dry run mode doesn't index."""
        # Mock redis connection
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content", b"assistant_preview", b"session_id"],
                [
                    [b"turn-1", b"Hello", b"Hi!", b"session-1"],
                    [b"turn-2", b"Bye", b"Goodbye!", b"session-1"],
                ],
                [b"Query internal execution time: 0.5 ms"],
            ]
        )
        mock_redis.close = AsyncMock()

        with patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis):
            await dry_run_backfiller.connect()
            total, indexed = await dry_run_backfiller.backfill(limit=10)
            await dry_run_backfiller.disconnect()

        assert total == 2
        assert indexed == 0  # Dry run doesn't index

    @pytest.mark.asyncio
    async def test_query_turns_parses_response(self, dry_run_backfiller: TurnsBackfiller) -> None:
        """Test parsing FalkorDB response."""
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content", b"session_id"],
                [
                    [b"turn-1", b"Question 1", b"session-1"],
                    [b"turn-2", b"Question 2", b"session-2"],
                ],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis):
            await dry_run_backfiller.connect()
            turns = await dry_run_backfiller.query_turns(limit=10)
            await dry_run_backfiller.disconnect()

        assert len(turns) == 2
        assert turns[0]["turn_id"] == "turn-1"
        assert turns[0]["user_content"] == "Question 1"
        assert turns[1]["turn_id"] == "turn-2"

    @pytest.mark.asyncio
    async def test_query_turns_empty_response(self, dry_run_backfiller: TurnsBackfiller) -> None:
        """Test handling empty FalkorDB response."""
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content"],
                [],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis):
            await dry_run_backfiller.connect()
            turns = await dry_run_backfiller.query_turns()
            await dry_run_backfiller.disconnect()

        assert len(turns) == 0


class TestTurnsBackfillerConfig:
    """Tests for TurnsBackfiller configuration."""

    def test_default_batch_size(self) -> None:
        """Test default batch size."""
        settings = Settings()
        backfiller = TurnsBackfiller(settings=settings)
        assert backfiller.batch_size == 32

    def test_custom_batch_size(self) -> None:
        """Test custom batch size."""
        settings = Settings()
        backfiller = TurnsBackfiller(settings=settings, batch_size=64)
        assert backfiller.batch_size == 64

    def test_dry_run_flag(self) -> None:
        """Test dry run flag."""
        settings = Settings()
        backfiller = TurnsBackfiller(settings=settings, dry_run=True)
        assert backfiller.dry_run is True


class TestTurnsBackfillerEdgeCases:
    """Tests for edge cases and error handling."""

    @pytest.fixture
    def mock_settings(self) -> Settings:
        """Create mock settings."""
        return Settings(
            qdrant_url="http://localhost:6333",
            qdrant_turns_collection="test_turns",
            falkordb_url="redis://localhost:6379",
            embedder_device="cpu",
            embedder_preload=False,
        )

    def test_turn_to_document_files_touched_invalid_string(
        self, mock_settings: Settings
    ) -> None:
        """Test handling invalid string for files_touched."""
        backfiller = TurnsBackfiller(settings=mock_settings)
        turn = {
            "turn_id": "turn-123",
            "user_content": "Test",
            "assistant_preview": "Response",
            "files_touched": "not a valid list",  # Invalid string
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert doc.metadata["files_touched"] == []

    def test_turn_to_document_exception_handling(
        self, mock_settings: Settings
    ) -> None:
        """Test exception handling in turn_to_document."""
        backfiller = TurnsBackfiller(settings=mock_settings)

        # Create a mock turn that will cause an exception during processing
        # Using a property that raises an exception when accessed
        class BadDict(dict):
            def get(self, key, default=None):
                if key == "turn_id":
                    return "turn-123"
                if key == "user_content":
                    raise ValueError("Test exception")
                return super().get(key, default)

        turn = BadDict()

        doc = backfiller.turn_to_document(turn)

        assert doc is None

    def test_turn_to_document_only_user_content(
        self, mock_settings: Settings
    ) -> None:
        """Test document with only user content."""
        backfiller = TurnsBackfiller(settings=mock_settings)
        turn = {
            "turn_id": "turn-123",
            "user_content": "Only user message",
            "assistant_preview": "",
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert "User: Only user message" in doc.content
        assert "Assistant:" not in doc.content

    def test_turn_to_document_only_assistant_content(
        self, mock_settings: Settings
    ) -> None:
        """Test document with only assistant content."""
        backfiller = TurnsBackfiller(settings=mock_settings)
        turn = {
            "turn_id": "turn-123",
            "user_content": "",
            "assistant_preview": "Only assistant message",
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert "Assistant: Only assistant message" in doc.content
        assert "User:" not in doc.content

    def test_turn_to_document_null_token_counts(
        self, mock_settings: Settings
    ) -> None:
        """Test handling null token counts."""
        backfiller = TurnsBackfiller(settings=mock_settings)
        turn = {
            "turn_id": "turn-123",
            "user_content": "Test",
            "assistant_preview": "Response",
            "input_tokens": None,
            "output_tokens": None,
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert doc.metadata["input_tokens"] == 0
        assert doc.metadata["output_tokens"] == 0

    def test_turn_to_document_null_timestamp(
        self, mock_settings: Settings
    ) -> None:
        """Test handling null timestamp."""
        backfiller = TurnsBackfiller(settings=mock_settings)
        turn = {
            "turn_id": "turn-123",
            "user_content": "Test",
            "assistant_preview": "Response",
            "timestamp": None,
        }

        doc = backfiller.turn_to_document(turn)

        assert doc is not None
        assert doc.metadata["timestamp"] == 0

    @pytest.mark.asyncio
    async def test_connect_non_dry_run(self, mock_settings: Settings) -> None:
        """Test connecting with non-dry-run mode initializes all services."""
        backfiller = TurnsBackfiller(settings=mock_settings, dry_run=False)

        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.close = AsyncMock()

        mock_qdrant = MagicMock()
        mock_qdrant.connect = AsyncMock()

        mock_embedders = MagicMock()

        mock_indexer = MagicMock()

        with (
            patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis),
            patch(
                "src.scripts.backfill_turns.QdrantClientWrapper",
                return_value=mock_qdrant,
            ),
            patch(
                "src.scripts.backfill_turns.EmbedderFactory", return_value=mock_embedders
            ),
            patch("src.scripts.backfill_turns.TurnsIndexer", return_value=mock_indexer),
        ):
            await backfiller.connect()

            # Verify all services were initialized
            mock_redis.ping.assert_called_once()
            mock_qdrant.connect.assert_called_once()

            await backfiller.disconnect()
            mock_redis.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_query_turns_not_connected(self, mock_settings: Settings) -> None:
        """Test querying turns when not connected raises error."""
        backfiller = TurnsBackfiller(settings=mock_settings)

        with pytest.raises(RuntimeError, match="Not connected to FalkorDB"):
            await backfiller.query_turns()

    @pytest.mark.asyncio
    async def test_query_turns_with_limit(self, mock_settings: Settings) -> None:
        """Test querying turns with limit."""
        backfiller = TurnsBackfiller(settings=mock_settings, dry_run=True)

        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id"],
                [[b"turn-1"]],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis):
            await backfiller.connect()
            turns = await backfiller.query_turns(limit=5)
            await backfiller.disconnect()

        # Verify LIMIT was added to query
        call_args = mock_redis.execute_command.call_args
        assert "LIMIT 5" in call_args[0][2]

    @pytest.mark.asyncio
    async def test_query_turns_string_headers(self, mock_settings: Settings) -> None:
        """Test parsing FalkorDB response with string headers."""
        backfiller = TurnsBackfiller(settings=mock_settings, dry_run=True)

        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                ["turn_id", "user_content"],  # String headers instead of bytes
                [[b"turn-1", b"Question"]],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis):
            await backfiller.connect()
            turns = await backfiller.query_turns()
            await backfiller.disconnect()

        assert len(turns) == 1
        assert turns[0]["turn_id"] == "turn-1"

    @pytest.mark.asyncio
    async def test_query_turns_string_values(self, mock_settings: Settings) -> None:
        """Test parsing FalkorDB response with string values."""
        backfiller = TurnsBackfiller(settings=mock_settings, dry_run=True)

        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content"],
                [["turn-1", "Question"]],  # String values instead of bytes
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis):
            await backfiller.connect()
            turns = await backfiller.query_turns()
            await backfiller.disconnect()

        assert len(turns) == 1
        assert turns[0]["turn_id"] == "turn-1"
        assert turns[0]["user_content"] == "Question"

    @pytest.mark.asyncio
    async def test_query_turns_short_response(self, mock_settings: Settings) -> None:
        """Test handling short FalkorDB response."""
        backfiller = TurnsBackfiller(settings=mock_settings, dry_run=True)

        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[[b"turn_id"]]  # Only headers, no data
        )
        mock_redis.close = AsyncMock()

        with patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis):
            await backfiller.connect()
            turns = await backfiller.query_turns()
            await backfiller.disconnect()

        assert len(turns) == 0

    @pytest.mark.asyncio
    async def test_backfill_no_turns(self, mock_settings: Settings) -> None:
        """Test backfill when no turns are found."""
        backfiller = TurnsBackfiller(settings=mock_settings, dry_run=True)

        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id"],
                [],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis):
            await backfiller.connect()
            total, indexed = await backfiller.backfill()
            await backfiller.disconnect()

        assert total == 0
        assert indexed == 0

    @pytest.mark.asyncio
    async def test_backfill_with_invalid_documents(
        self, mock_settings: Settings
    ) -> None:
        """Test backfill filters out invalid documents."""
        backfiller = TurnsBackfiller(settings=mock_settings, dry_run=True)

        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content", b"assistant_preview", b"session_id"],
                [
                    [b"turn-1", b"", b"", b"session-1"],  # No content
                    [b"", b"Hello", b"Hi", b"session-1"],  # No ID
                    [b"turn-3", b"Valid", b"Response", b"session-1"],  # Valid
                ],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis):
            await backfiller.connect()
            total, indexed = await backfiller.backfill()
            await backfiller.disconnect()

        assert total == 3
        assert indexed == 0  # Dry run doesn't index

    @pytest.mark.asyncio
    async def test_backfill_with_batching(self, mock_settings: Settings) -> None:
        """Test backfill indexes in batches."""
        backfiller = TurnsBackfiller(settings=mock_settings, batch_size=2, dry_run=False)

        # Create multiple valid turns
        turns_data = []
        for i in range(5):
            turns_data.append(
                [f"turn-{i}".encode(), f"User {i}".encode(), f"Assistant {i}".encode(), b"session-1"]
            )

        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content", b"assistant_preview", b"session_id"],
                turns_data,
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        mock_qdrant = MagicMock()
        mock_qdrant.connect = AsyncMock()

        mock_embedders = MagicMock()

        mock_indexer = MagicMock()
        mock_indexer.index_documents = AsyncMock(return_value=2)  # Return batch size

        with (
            patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis),
            patch(
                "src.scripts.backfill_turns.QdrantClientWrapper",
                return_value=mock_qdrant,
            ),
            patch(
                "src.scripts.backfill_turns.EmbedderFactory", return_value=mock_embedders
            ),
            patch("src.scripts.backfill_turns.TurnsIndexer", return_value=mock_indexer),
        ):
            await backfiller.connect()
            total, indexed = await backfiller.backfill()
            await backfiller.disconnect()

        assert total == 5
        assert indexed == 6  # 3 batches: 2 + 2 + 2 (last batch returns 2 even though only 1 doc)
        # index_documents should be called 3 times (ceiling of 5/2)
        assert mock_indexer.index_documents.call_count == 3


class TestMainFunction:
    """Tests for the main entry point."""

    @pytest.mark.asyncio
    async def test_main_dry_run_success(self) -> None:
        """Test main function with dry run."""
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content", b"assistant_preview", b"session_id"],
                [[b"turn-1", b"Hello", b"Hi!", b"session-1"]],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with (
            patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis),
            patch("sys.argv", ["backfill_turns.py", "--dry-run"]),
        ):
            exit_code = await main()

        assert exit_code == 0

    @pytest.mark.asyncio
    async def test_main_with_limit(self) -> None:
        """Test main function with limit argument."""
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content", b"assistant_preview", b"session_id"],
                [[b"turn-1", b"Hello", b"Hi!", b"session-1"]],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with (
            patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis),
            patch("sys.argv", ["backfill_turns.py", "--dry-run", "--limit=5"]),
        ):
            exit_code = await main()

        assert exit_code == 0

    @pytest.mark.asyncio
    async def test_main_with_batch_size(self) -> None:
        """Test main function with batch size argument."""
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content", b"assistant_preview", b"session_id"],
                [[b"turn-1", b"Hello", b"Hi!", b"session-1"]],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        with (
            patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis),
            patch("sys.argv", ["backfill_turns.py", "--dry-run", "--batch-size=64"]),
        ):
            exit_code = await main()

        assert exit_code == 0

    @pytest.mark.asyncio
    async def test_main_exception_handling(self) -> None:
        """Test main function handles exceptions."""
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock(side_effect=Exception("Connection failed"))
        mock_redis.close = AsyncMock()

        with (
            patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis),
            patch("sys.argv", ["backfill_turns.py", "--dry-run"]),
        ):
            exit_code = await main()

        assert exit_code == 1
        mock_redis.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_main_partial_success(self) -> None:
        """Test main function with partial indexing success."""
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock()
        mock_redis.execute_command = AsyncMock(
            return_value=[
                [b"turn_id", b"user_content", b"assistant_preview", b"session_id"],
                [
                    [b"turn-1", b"Hello", b"Hi!", b"session-1"],
                    [b"turn-2", b"", b"", b"session-1"],  # Invalid
                ],
                [b"Stats"],
            ]
        )
        mock_redis.close = AsyncMock()

        mock_qdrant = MagicMock()
        mock_qdrant.connect = AsyncMock()

        mock_embedders = MagicMock()

        mock_indexer = MagicMock()
        mock_indexer.index_documents = AsyncMock(return_value=1)  # Only 1 indexed

        with (
            patch("src.scripts.backfill_turns.redis.from_url", return_value=mock_redis),
            patch(
                "src.scripts.backfill_turns.QdrantClientWrapper",
                return_value=mock_qdrant,
            ),
            patch(
                "src.scripts.backfill_turns.EmbedderFactory", return_value=mock_embedders
            ),
            patch("src.scripts.backfill_turns.TurnsIndexer", return_value=mock_indexer),
            patch("sys.argv", ["backfill_turns.py"]),
        ):
            exit_code = await main()

        # Exit code 1 because indexed (1) != total (2)
        assert exit_code == 1
