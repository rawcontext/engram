"""Turn-level document indexing for semantic search.

This module handles indexing of complete conversation turns (user + assistant)
instead of individual streaming fragments, providing better semantic content
for retrieval and reranking.
"""

import asyncio
import contextlib
import logging
import uuid
from typing import Any

from pydantic import BaseModel, Field
from qdrant_client.http import models

from src.clients.nats import NatsClient
from src.clients.nats_pubsub import NatsPubSubPublisher
from src.clients.qdrant import QdrantClientWrapper
from src.config import Settings
from src.embedders.factory import EmbedderFactory
from src.indexing.batch import BatchConfig, BatchQueue, Document

logger = logging.getLogger(__name__)


class TurnsIndexerConfig(BaseModel):
    """Configuration for turn-level document indexer."""

    collection_name: str = Field(default="engram_turns", description="Qdrant collection")
    dense_vector_name: str = Field(default="turn_dense", description="Dense vector field")
    sparse_vector_name: str = Field(default="turn_sparse", description="Sparse vector field")
    colbert_vector_name: str = Field(default="turn_colbert", description="ColBERT vector field")
    enable_sparse: bool = Field(
        default=True, description="Enable sparse embeddings (requires local ML dependencies)"
    )
    enable_colbert: bool = Field(
        default=True, description="Enable ColBERT embeddings (requires local ML dependencies)"
    )
    batch_size: int = Field(default=32, description="Embedding batch size")


class TurnsIndexer:
    """Indexes turn-level documents with multi-vector embeddings to Qdrant.

    Generates three types of embeddings for each turn document:
    1. Dense embeddings for semantic search (BGE-small, 384 dims)
    2. Sparse embeddings (SPLADE) for keyword-based search
    3. ColBERT multi-vector embeddings for late interaction (optional)
    """

    def __init__(
        self,
        qdrant_client: QdrantClientWrapper,
        embedder_factory: EmbedderFactory,
        config: TurnsIndexerConfig | None = None,
    ) -> None:
        """Initialize the turns indexer.

        Args:
            qdrant_client: Qdrant client wrapper.
            embedder_factory: Factory for creating embedder instances.
            config: Indexer configuration.
        """
        self.qdrant = qdrant_client
        self.embedders = embedder_factory
        self.config = config or TurnsIndexerConfig()

    async def index_documents(self, documents: list[Document]) -> int:
        """Index a batch of turn documents with multi-vector embeddings.

        Args:
            documents: List of documents to index.

        Returns:
            Count of successfully indexed documents.
        """
        if not documents:
            return 0

        logger.info(f"Indexing batch of {len(documents)} turn documents")

        try:
            # Extract text content for embedding
            texts = [doc.content for doc in documents]

            # Generate dense embeddings
            logger.debug("Generating dense embeddings...")
            text_embedder = await self.embedders.get_text_embedder()
            await text_embedder.load()
            dense_embeddings = await text_embedder.embed_batch(texts, is_query=False)

            # Generate sparse embeddings (optional, requires local ML dependencies)
            sparse_embeddings: list[dict[int, float]] = [{} for _ in documents]
            if self.config.enable_sparse:
                logger.debug("Generating sparse embeddings...")
                sparse_embedder = await self.embedders.get_sparse_embedder()
                await sparse_embedder.load()
                sparse_embeddings = sparse_embedder.embed_sparse_batch(texts)

            # Generate ColBERT embeddings (optional, requires local ML dependencies)
            colbert_embeddings: list[list[list[float]] | None] = [None] * len(documents)
            if self.config.enable_sparse and self.config.enable_colbert:
                logger.debug("Generating ColBERT embeddings...")
                colbert_embedder = await self.embedders.get_colbert_embedder()
                await colbert_embedder.load()
                colbert_embeddings = [
                    emb if emb else None for emb in colbert_embedder.embed_document_batch(texts)
                ]

            # Build Qdrant points
            points = []
            for i, doc in enumerate(documents):
                point = self._build_point(
                    doc=doc,
                    dense_vec=dense_embeddings[i],
                    sparse_vec=sparse_embeddings[i],
                    colbert_vecs=colbert_embeddings[i],
                )
                points.append(point)

            # Upsert to Qdrant
            logger.debug(f"Upserting {len(points)} points to Qdrant")
            await self.qdrant.client.upsert(
                collection_name=self.config.collection_name,
                points=points,
            )

            logger.info(f"Successfully indexed {len(documents)} turn documents")
            return len(documents)

        except Exception as e:
            logger.error(f"Error indexing turn documents: {e}", exc_info=True)
            return 0

    def _build_point(
        self,
        doc: Document,
        dense_vec: list[float],
        sparse_vec: dict[int, float],
        colbert_vecs: list[list[float]] | None,
    ) -> models.PointStruct:
        """Build a Qdrant point from document and embeddings.

        Args:
            doc: Source document.
            dense_vec: Dense embedding vector.
            sparse_vec: Sparse embedding dictionary (token_id -> weight).
            colbert_vecs: Optional ColBERT multi-vector embeddings.

        Returns:
            Qdrant PointStruct ready for upsertion.
        """
        # Build vector dictionary with turn-specific names
        vectors: dict[str, Any] = {
            self.config.dense_vector_name: dense_vec,
            self.config.sparse_vector_name: models.SparseVector(
                indices=list(sparse_vec.keys()),
                values=list(sparse_vec.values()),
            ),
        }

        # Add ColBERT vectors if available
        # Multi-vectors are passed as list of lists directly
        if colbert_vecs and self.config.enable_colbert:
            vectors[self.config.colbert_vector_name] = colbert_vecs

        # Build payload with content, org_id (required for tenant isolation), and metadata
        payload = {
            "content": doc.content,
            "org_id": doc.org_id,  # Required for tenant filtering
            **doc.metadata,
        }

        # Add session_id to payload if present
        if doc.session_id:
            payload["session_id"] = doc.session_id

        # Create and return the point
        return models.PointStruct(
            id=doc.id,
            vector=vectors,
            payload=payload,
        )


class TurnFinalizedConsumerConfig(BaseModel):
    """Configuration for turn finalized event consumer."""

    topic: str = Field(default="memory.turn_finalized", description="Topic to consume")
    group_id: str = Field(default="search-turns-indexer", description="Consumer group ID")
    batch_config: BatchConfig = Field(default_factory=BatchConfig)
    indexer_config: TurnsIndexerConfig = Field(default_factory=TurnsIndexerConfig)
    heartbeat_interval_ms: int = Field(default=10000, description="NATS heartbeat interval")
    service_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])


class TurnFinalizedConsumer:
    """Consumes turn_finalized events from NATS JetStream and indexes them to Qdrant.

    Subscribes to the memory.turns.finalized NATS subject, builds complete
    turn documents from user + assistant + reasoning content, and batches
    them for efficient indexing with multi-vector embeddings.
    """

    def __init__(
        self,
        nats_client: NatsClient,
        indexer: TurnsIndexer,
        nats_pubsub: NatsPubSubPublisher | None = None,
        config: TurnFinalizedConsumerConfig | None = None,
    ) -> None:
        """Initialize the turn finalized consumer.

        Args:
            nats_client: NATS client for consuming events.
            indexer: Turns indexer for generating embeddings and upserting.
            nats_pubsub: Optional NATS pub/sub publisher for status updates.
            config: Consumer configuration.
        """
        self.nats = nats_client
        self.indexer = indexer
        self.nats_pubsub = nats_pubsub
        self.config = config or TurnFinalizedConsumerConfig()
        self._batch_queue: BatchQueue | None = None
        self._running = False
        self._heartbeat_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the consumer and begin processing events."""
        if self._running:
            logger.warning("Turn consumer already running")
            return

        logger.info(
            f"Starting turn_finalized consumer for topic '{self.config.topic}' "
            f"(group: {self.config.group_id}, service: {self.config.service_id})"
        )

        # Connect to NATS
        await self.nats.connect()

        # Create batch queue with indexing callback
        self._batch_queue = BatchQueue(
            config=self.config.batch_config,
            flush_callback=self.indexer.index_documents,
        )

        # Start batch queue
        await self._batch_queue.start()

        # Publish consumer_ready via NATS pub/sub
        if self.nats_pubsub:
            try:
                await self.nats_pubsub.publish_consumer_status(
                    status_type="consumer_ready",
                    group_id=self.config.group_id,
                    service_id=self.config.service_id,
                )
            except Exception as e:
                logger.warning(f"Failed to publish consumer_ready status: {e}")

        # Start heartbeat task
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        # Begin consuming messages
        self._running = True
        logger.info("Turn consumer started, beginning message consumption")

        try:
            await self.nats.subscribe(
                topic=self.config.topic,
                group_id=self.config.group_id,
                handler=self._handle_message,
            )
        except asyncio.CancelledError:
            logger.info("Turn consumer task cancelled")
        except Exception as e:
            logger.error(f"Error in turn consumer loop: {e}", exc_info=True)
        finally:
            await self.stop()

    async def stop(self) -> None:
        """Stop the consumer gracefully."""
        if not self._running:
            return

        logger.info("Stopping turn consumer...")
        self._running = False

        # Stop heartbeat
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._heartbeat_task
            self._heartbeat_task = None

        # Flush batch queue
        if self._batch_queue is not None:
            await self._batch_queue.stop()
            self._batch_queue = None

        # Publish consumer_disconnected via NATS pub/sub
        if self.nats_pubsub:
            try:
                await self.nats_pubsub.publish_consumer_status(
                    status_type="consumer_disconnected",
                    group_id=self.config.group_id,
                    service_id=self.config.service_id,
                )
            except Exception as e:
                logger.warning(f"Failed to publish consumer_disconnected status: {e}")

        # Close NATS connection
        await self.nats.close()

        logger.info("Turn consumer stopped")

    async def _handle_message(self, subject: str, data: dict[str, Any]) -> None:
        """Handle a single message from NATS.

        Args:
            subject: NATS subject the message was received on.
            data: Parsed message payload.
        """
        try:
            # Extract document from turn_finalized event
            document = self._parse_turn_finalized(data)
            if document is None:
                logger.warning(f"Failed to parse turn_finalized event: {data}")
                return

            # Add to batch queue
            if self._batch_queue is not None:
                await self._batch_queue.add(document)
                logger.debug(f"Added turn document {document.id} to batch queue")

        except Exception as e:
            logger.error(f"Error processing turn message: {e}", exc_info=True)

    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats via NATS pub/sub."""
        heartbeat_interval_s = self.config.heartbeat_interval_ms / 1000.0

        try:
            while self._running:
                await asyncio.sleep(heartbeat_interval_s)

                if self.nats_pubsub:
                    try:
                        await self.nats_pubsub.publish_consumer_status(
                            status_type="consumer_heartbeat",
                            group_id=self.config.group_id,
                            service_id=self.config.service_id,
                        )
                        logger.debug("Published turn consumer heartbeat")
                    except Exception as e:
                        logger.warning(f"Failed to publish heartbeat: {e}")

        except asyncio.CancelledError:
            logger.debug("Heartbeat loop cancelled")
        except Exception as e:
            logger.error(f"Error in heartbeat loop: {e}", exc_info=True)

    def _parse_turn_finalized(self, data: dict[str, Any]) -> Document | None:
        """Parse a turn_finalized event into a Document.

        Expected event structure from memory.turns.finalized subject:
        {
            "id": "turn-id",
            "session_id": "session-id",
            "org_id": "org-id",
            "sequence_index": 0,
            "user_content": "complete user message",
            "assistant_content": "complete assistant response",
            "reasoning_preview": "first 500 chars of reasoning",
            "tool_calls": ["tool1", "tool2"],
            "files_touched": ["file1.ts", "file2.ts"],
            "input_tokens": 100,
            "output_tokens": 500,
            "timestamp": 1234567890
        }

        Args:
            data: Turn finalized event payload.

        Returns:
            Document instance with complete turn content, or None if parsing fails.
        """
        try:
            # Extract required fields
            turn_id = data.get("id")
            if not turn_id:
                logger.warning("Missing turn id in turn_finalized event")
                return None

            org_id = data.get("org_id")
            if not org_id:
                logger.error(
                    f"Missing org_id in turn_finalized event {turn_id} - "
                    "required for tenant isolation"
                )
                return None

            # Build complete content from user + assistant + reasoning
            content_parts = []

            user_content = data.get("user_content", "")
            if user_content:
                content_parts.append(f"User: {user_content}")

            assistant_content = data.get("assistant_content", "")
            if assistant_content:
                content_parts.append(f"Assistant: {assistant_content}")

            reasoning_preview = data.get("reasoning_preview", "")
            if reasoning_preview:
                content_parts.append(f"Reasoning: {reasoning_preview}")

            # Combine all content parts
            full_content = "\n\n".join(content_parts)

            if not full_content:
                logger.warning(f"No content in turn_finalized event: {turn_id}")
                return None

            # Extract metadata
            tool_calls = data.get("tool_calls", [])
            files_touched = data.get("files_touched", [])
            sequence_index = data.get("sequence_index", 0)

            metadata = {
                "type": "turn",
                "sequence_index": sequence_index,
                "tool_calls": tool_calls,
                "files_touched": files_touched,
                "has_code": "```" in full_content,
                "has_reasoning": bool(reasoning_preview),
                "input_tokens": data.get("input_tokens", 0),
                "output_tokens": data.get("output_tokens", 0),
                "timestamp": data.get("timestamp", 0),
            }

            return Document(
                id=str(turn_id),
                content=full_content,
                org_id=str(org_id),
                metadata=metadata,
                session_id=data.get("session_id"),
            )

        except Exception as e:
            logger.error(f"Error parsing turn_finalized event: {e}", exc_info=True)
            return None


def create_turns_consumer(
    settings: Settings,
    qdrant_client: QdrantClientWrapper,
    embedder_factory: EmbedderFactory,
    nats_client: NatsClient,
    nats_pubsub: NatsPubSubPublisher | None = None,
) -> TurnFinalizedConsumer:
    """Create a configured TurnFinalizedConsumer instance.

    Args:
        settings: Application settings.
        qdrant_client: Qdrant client wrapper.
        embedder_factory: Factory for creating embedder instances.
        nats_client: NATS client for consuming events.
        nats_pubsub: Optional NATS pub/sub publisher for status updates.

    Returns:
        Configured TurnFinalizedConsumer ready to start.
    """
    indexer_config = TurnsIndexerConfig(
        collection_name=settings.qdrant_collection,
    )

    indexer = TurnsIndexer(
        qdrant_client=qdrant_client,
        embedder_factory=embedder_factory,
        config=indexer_config,
    )

    consumer_config = TurnFinalizedConsumerConfig(
        indexer_config=indexer_config,
    )

    return TurnFinalizedConsumer(
        nats_client=nats_client,
        indexer=indexer,
        nats_pubsub=nats_pubsub,
        config=consumer_config,
    )
