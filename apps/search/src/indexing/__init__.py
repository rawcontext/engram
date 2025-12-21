"""Document indexing pipeline for Engram search service.

This module provides Kafka consumers that index memory nodes to Qdrant
with multi-vector embeddings (dense, sparse, ColBERT).

Components:
    - BatchQueue: Efficient batching queue with automatic flushing
    - DocumentIndexer: Multi-vector embedding generation and Qdrant upsertion
    - MemoryEventConsumer: Kafka consumer for memory.node_created events (legacy)
    - TurnFinalizedConsumer: Kafka consumer for memory.turn_finalized events
    - TurnsIndexer: Turn-level document indexer for engram_turns collection

Usage:
    from src.indexing import TurnFinalizedConsumer, create_turns_consumer
    from src.clients.kafka import KafkaClient
    from src.clients.qdrant import QdrantClientWrapper
    from src.clients.redis import RedisPublisher
    from src.embedders.factory import EmbedderFactory

    # Initialize dependencies
    kafka = KafkaClient()
    qdrant = QdrantClientWrapper(settings)
    redis = RedisPublisher()
    embedders = EmbedderFactory(settings)

    # Create and start turn consumer
    consumer = create_turns_consumer(settings, qdrant, embedders, kafka, redis)
    await consumer.start()
"""

from src.indexing.batch import BatchConfig, BatchQueue, Document
from src.indexing.consumer import MemoryConsumerConfig, MemoryEventConsumer
from src.indexing.indexer import DocumentIndexer, IndexerConfig
from src.indexing.turns import (
    TurnFinalizedConsumer,
    TurnFinalizedConsumerConfig,
    TurnsIndexer,
    TurnsIndexerConfig,
    create_turns_consumer,
)

__all__ = [
    "BatchConfig",
    "BatchQueue",
    "Document",
    "DocumentIndexer",
    "IndexerConfig",
    "MemoryConsumerConfig",
    "MemoryEventConsumer",
    "TurnFinalizedConsumer",
    "TurnFinalizedConsumerConfig",
    "TurnsIndexer",
    "TurnsIndexerConfig",
    "create_turns_consumer",
]
