"""Client wrappers for external services.

Provides async client wrappers for:
- Qdrant: Vector database for multi-vector search
- NATS: JetStream messaging for indexing pipeline
- Redis: Pub/sub for consumer status and notifications
- HuggingFace: Embeddings and reranking via Inference API
"""

from src.clients.huggingface import HuggingFaceEmbedder, HuggingFaceReranker
from src.clients.nats import NatsClient, NatsClientConfig
from src.clients.qdrant import QdrantClientWrapper
from src.clients.redis import (
    ConsumerStatusUpdate,
    RedisPublisher,
    RedisSubscriber,
    SessionUpdate,
)

__all__ = [
    "ConsumerStatusUpdate",
    "HuggingFaceEmbedder",
    "HuggingFaceReranker",
    "NatsClient",
    "NatsClientConfig",
    "QdrantClientWrapper",
    "RedisPublisher",
    "RedisSubscriber",
    "SessionUpdate",
]
