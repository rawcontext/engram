"""Document indexing pipeline for Engram search service.

This module provides a Kafka consumer that indexes memory nodes to Qdrant
with multi-vector embeddings (dense, sparse, ColBERT).

Components:
    - BatchQueue: Efficient batching queue with automatic flushing
    - DocumentIndexer: Multi-vector embedding generation and Qdrant upsertion
    - MemoryEventConsumer: Kafka consumer for memory.node_created events

Usage:
    from search.indexing import MemoryEventConsumer, MemoryConsumerConfig
    from search.clients.kafka import KafkaClient
    from search.clients.qdrant import QdrantClientWrapper
    from search.clients.redis import RedisPublisher
    from search.embedders.factory import EmbedderFactory
    from search.indexing.indexer import DocumentIndexer

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

from search.indexing.batch import BatchConfig, BatchQueue, Document
from search.indexing.consumer import MemoryConsumerConfig, MemoryEventConsumer
from search.indexing.indexer import DocumentIndexer, IndexerConfig

__all__ = [
    "BatchConfig",
    "BatchQueue",
    "Document",
    "DocumentIndexer",
    "IndexerConfig",
    "MemoryConsumerConfig",
    "MemoryEventConsumer",
]
