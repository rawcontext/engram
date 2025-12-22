"""Tests for turn backfill script."""

from unittest.mock import AsyncMock, patch

import pytest

from src.config import Settings
from src.scripts.backfill_turns import TurnsBackfiller


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
