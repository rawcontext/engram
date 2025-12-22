"""Client wrappers for external services.

Provides async client wrappers for:
- Qdrant: Vector database for multi-vector search
- NATS: JetStream messaging for indexing pipeline
- NATS PubSub: Core NATS pub/sub for real-time updates (replaces Redis)
- HuggingFace: Embeddings and reranking via Inference API
"""

from src.clients.huggingface import HuggingFaceEmbedder, HuggingFaceReranker
from src.clients.nats import NatsClient, NatsClientConfig
from src.clients.nats_pubsub import (
    ConsumerStatusUpdate,
    NatsPubSubPublisher,
    NatsPubSubSubscriber,
    SessionUpdate,
)
from src.clients.qdrant import QdrantClientWrapper

__all__ = [
    "ConsumerStatusUpdate",
    "HuggingFaceEmbedder",
    "HuggingFaceReranker",
    "NatsClient",
    "NatsClientConfig",
    "NatsPubSubPublisher",
    "NatsPubSubSubscriber",
    "QdrantClientWrapper",
    "SessionUpdate",
]
