"""Backfill turn embeddings from FalkorDB to Qdrant.

This script reads existing Turn nodes from FalkorDB and indexes them
into the engram_turns Qdrant collection with multi-vector embeddings.

Usage:
    uv run python -m src.scripts.backfill_turns [--dry-run] [--batch-size=32] [--limit=100]
"""

import argparse
import asyncio
import logging
import sys
from typing import Any

import redis.asyncio as redis

from src.clients.qdrant import QdrantClientWrapper
from src.config import Settings
from src.embedders.factory import EmbedderFactory
from src.indexing.batch import Document
from src.indexing.turns import TurnsIndexer, TurnsIndexerConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# Cypher query to get all turns with their session info
TURNS_QUERY = """
MATCH (s:Session)-[:HAS_TURN]->(t:Turn)
WHERE t.vt_end IS NULL
RETURN
    t.id AS turn_id,
    t.user_content AS user_content,
    t.assistant_preview AS assistant_preview,
    t.sequence_index AS sequence_index,
    t.files_touched AS files_touched,
    t.tool_calls_count AS tool_calls_count,
    t.input_tokens AS input_tokens,
    t.output_tokens AS output_tokens,
    t.vt_start AS timestamp,
    s.id AS session_id
ORDER BY s.started_at, t.sequence_index
"""


class TurnsBackfiller:
    """Backfills turn documents from FalkorDB to Qdrant."""

    def __init__(
        self,
        settings: Settings,
        batch_size: int = 32,
        dry_run: bool = False,
    ) -> None:
        """Initialize the backfiller.

        Args:
            settings: Application settings.
            batch_size: Number of documents to index per batch.
            dry_run: If True, don't actually index documents.
        """
        self.settings = settings
        self.batch_size = batch_size
        self.dry_run = dry_run
        self._redis: redis.Redis | None = None
        self._indexer: TurnsIndexer | None = None
        self._qdrant: QdrantClientWrapper | None = None
        self._embedders: EmbedderFactory | None = None

    async def connect(self) -> None:
        """Connect to FalkorDB and initialize indexer."""
        # Connect to FalkorDB (Redis protocol)
        falkor_url = self.settings.falkordb_url
        logger.info(f"Connecting to FalkorDB at {falkor_url}")
        self._redis = redis.from_url(falkor_url)

        # Verify connection
        await self._redis.ping()
        logger.info("Connected to FalkorDB")

        if not self.dry_run:
            # Initialize Qdrant client
            self._qdrant = QdrantClientWrapper(self.settings)
            await self._qdrant.connect()

            # Initialize embedder factory
            self._embedders = EmbedderFactory(self.settings)

            # Initialize indexer
            indexer_config = TurnsIndexerConfig(
                collection_name=self.settings.qdrant_collection,
                batch_size=self.batch_size,
            )
            self._indexer = TurnsIndexer(self._qdrant, self._embedders, indexer_config)

    async def disconnect(self) -> None:
        """Disconnect from services."""
        if self._redis:
            await self._redis.close()

    async def query_turns(self, limit: int | None = None) -> list[dict[str, Any]]:
        """Query turns from FalkorDB.

        Args:
            limit: Maximum number of turns to fetch. None for all.

        Returns:
            List of turn records.
        """
        if self._redis is None:
            raise RuntimeError("Not connected to FalkorDB")

        query = TURNS_QUERY
        if limit:
            query = f"{TURNS_QUERY} LIMIT {limit}"

        logger.info(f"Querying turns from FalkorDB (limit={limit})")

        # Execute graph query via Redis
        # FalkorDB uses GRAPH.QUERY command
        result = await self._redis.execute_command("GRAPH.QUERY", "EngramGraph", query)

        # Parse FalkorDB response
        # Response format: [headers, [[row1], [row2], ...], stats]
        turns = []
        if result and len(result) >= 2:
            headers = result[0]
            rows = result[1]

            # Convert to list of dicts
            for row in rows:
                turn = {}
                for i, header in enumerate(headers):
                    header_name = header.decode() if isinstance(header, bytes) else header
                    value = row[i]
                    if isinstance(value, bytes):
                        value = value.decode()
                    turn[header_name] = value
                turns.append(turn)

        logger.info(f"Found {len(turns)} turns in FalkorDB")
        return turns

    def turn_to_document(self, turn: dict[str, Any]) -> Document | None:
        """Convert a FalkorDB turn record to a Document.

        Args:
            turn: Turn record from FalkorDB query.

        Returns:
            Document instance or None if conversion fails.
        """
        try:
            turn_id = turn.get("turn_id")
            if not turn_id:
                logger.warning("Turn missing id, skipping")
                return None

            # Build content from user + assistant
            content_parts = []

            user_content = turn.get("user_content", "")
            if user_content:
                content_parts.append(f"User: {user_content}")

            assistant_preview = turn.get("assistant_preview", "")
            if assistant_preview:
                content_parts.append(f"Assistant: {assistant_preview}")

            full_content = "\n\n".join(content_parts)

            if not full_content:
                logger.warning(f"Turn {turn_id} has no content, skipping")
                return None

            # Parse files_touched - may be a string representation of a list
            files_touched = turn.get("files_touched", [])
            if isinstance(files_touched, str):
                # Handle string representation like "['file1.ts', 'file2.ts']"
                import ast

                try:
                    files_touched = ast.literal_eval(files_touched)
                except (ValueError, SyntaxError):
                    files_touched = []
            elif files_touched is None:
                files_touched = []

            # Build metadata
            metadata = {
                "type": "turn",
                "sequence_index": turn.get("sequence_index", 0),
                "files_touched": files_touched,
                "tool_calls_count": turn.get("tool_calls_count", 0),
                "has_code": "```" in full_content,
                "has_reasoning": False,  # Historical data may not have reasoning
                "input_tokens": turn.get("input_tokens", 0) or 0,
                "output_tokens": turn.get("output_tokens", 0) or 0,
                "timestamp": turn.get("timestamp", 0) or 0,
            }

            return Document(
                id=str(turn_id),
                content=full_content,
                metadata=metadata,
                session_id=turn.get("session_id"),
            )

        except Exception as e:
            logger.error(f"Error converting turn to document: {e}", exc_info=True)
            return None

    async def backfill(self, limit: int | None = None) -> tuple[int, int]:
        """Run the backfill process.

        Args:
            limit: Maximum number of turns to process. None for all.

        Returns:
            Tuple of (total_processed, successful_indexed).
        """
        # Query turns from FalkorDB
        turns = await self.query_turns(limit)
        total = len(turns)

        if total == 0:
            logger.info("No turns found to backfill")
            return 0, 0

        # Convert to documents
        documents: list[Document] = []
        for turn in turns:
            doc = self.turn_to_document(turn)
            if doc:
                documents.append(doc)

        logger.info(f"Converted {len(documents)} turns to documents")

        if self.dry_run:
            logger.info("[DRY RUN] Would index documents:")
            for doc in documents[:5]:  # Show first 5
                logger.info(f"  - {doc.id}: {doc.content[:100]}...")
            return total, 0

        # Index in batches
        indexed = 0
        for i in range(0, len(documents), self.batch_size):
            batch = documents[i : i + self.batch_size]
            logger.info(f"Indexing batch {i // self.batch_size + 1} ({len(batch)} documents)")

            if self._indexer:
                count = await self._indexer.index_documents(batch)
                indexed += count

        logger.info(f"Backfill complete: {indexed}/{total} turns indexed")
        return total, indexed


async def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Backfill turn embeddings from FalkorDB to Qdrant")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without actually indexing",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Number of documents to index per batch (default: 32)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of turns to process (default: all)",
    )

    args = parser.parse_args()

    settings = Settings()

    backfiller = TurnsBackfiller(
        settings=settings,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
    )

    try:
        await backfiller.connect()
        total, indexed = await backfiller.backfill(limit=args.limit)

        if args.dry_run:
            logger.info(f"[DRY RUN] Would process {total} turns")
        else:
            logger.info(f"Successfully indexed {indexed}/{total} turns")

        return 0 if indexed == total or args.dry_run else 1

    except Exception as e:
        logger.error(f"Backfill failed: {e}", exc_info=True)
        return 1
    finally:
        await backfiller.disconnect()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
