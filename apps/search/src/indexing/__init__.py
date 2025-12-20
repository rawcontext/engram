"""Document indexing pipeline for Engram search service.

This module provides a Kafka consumer that indexes memory nodes to Qdrant
with multi-vector embeddings (dense, sparse, ColBERT).

Components:
    - BatchQueue: Efficient batching queue with automatic flushing
    - DocumentIndexer: Multi-vector embedding generation and Qdrant upsertion
    - MemoryEventConsumer: Kafka consumer for memory.node_created events

Usage:
    from src.indexing import MemoryEventConsumer, MemoryConsumerConfig
    from src.clients.kafka import KafkaClient
    from src.clients.qdrant import QdrantClientWrapper
    from src.clients.redis import RedisPublisher
    from src.embedders.factory import EmbedderFactory
    from src.indexing.indexer import DocumentIndexer

    # Initialize dependencies
    kafka = KafkaClient()
    qdrant = QdrantClientWrapper(settings)
    redis = RedisPublisher()
    embedders = EmbedderFactory(settings)

    # Create indexer
    indexer = DocumentIndexer(qdrant, embedders)

    # Create and start consumer
    consumer = MemoryEventConsumer(kafka, indexer, redis)
    await consumer.start()
"""

from src.indexing.batch import BatchConfig, BatchQueue, Document
from src.indexing.consumer import MemoryConsumerConfig, MemoryEventConsumer
from src.indexing.indexer import DocumentIndexer, IndexerConfig

__all__ = [
    "BatchConfig",
    "BatchQueue",
    "Document",
    "DocumentIndexer",
    "IndexerConfig",
    "MemoryConsumerConfig",
    "MemoryEventConsumer",
]
