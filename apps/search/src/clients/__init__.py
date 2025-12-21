"""Client wrappers for external services.

Provides async client wrappers for:
- Qdrant: Vector database for multi-vector search
- Kafka: Event streaming for indexing pipeline
- Redis: Pub/sub for consumer status and notifications
- HuggingFace: Embeddings and reranking via Inference API
"""

from src.clients.huggingface import HuggingFaceEmbedder, HuggingFaceReranker
from src.clients.kafka import ConsumerConfig, KafkaClient, ProducerConfig
from src.clients.qdrant import QdrantClientWrapper
from src.clients.redis import (
    ConsumerStatusUpdate,
    RedisPublisher,
    RedisSubscriber,
    SessionUpdate,
)

__all__ = [
    "ConsumerConfig",
    "ConsumerStatusUpdate",
    "HuggingFaceEmbedder",
    "HuggingFaceReranker",
    "KafkaClient",
    "ProducerConfig",
    "QdrantClientWrapper",
    "RedisPublisher",
    "RedisSubscriber",
    "SessionUpdate",
]
