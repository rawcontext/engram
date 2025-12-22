# Indexing Pipeline

The indexing pipeline consumes memory node creation events from NATS JetStream and indexes them to Qdrant with multi-vector embeddings (dense, sparse, and ColBERT).

## Architecture

```
NATS Subject: memory.nodes.created
         │
         ▼
  MemoryEventConsumer
         │
         ▼
    BatchQueue (batch_size=100, flush_interval=5s)
         │
         ▼
  DocumentIndexer
    ├─ Dense Embeddings (text_dense)
    ├─ Sparse Embeddings (text_sparse)
    └─ ColBERT Embeddings (text_colbert)
         │
         ▼
   Qdrant Collection: engram_memory
```

## Components

### BatchQueue (`batch.py`)

Efficient batching queue that collects documents and flushes to the indexer when:
- Batch size is reached (default: 100 documents)
- Flush interval has elapsed (default: 5000ms)
- Queue is stopped (final flush)

### DocumentIndexer (`indexer.py`)

Generates multi-vector embeddings and upserts to Qdrant:
1. **Dense embeddings** - Semantic search (BAAI/bge-base-en-v1.5)
2. **Sparse embeddings** - Keyword-based search (SPLADE)
3. **ColBERT embeddings** - Late interaction multi-vector (optional)

### MemoryEventConsumer (`consumer.py`)

NATS JetStream consumer that:
- Subscribes to `memory.nodes.created` subject
- Parses memory node events into Documents
- Batches documents for efficient indexing
- Publishes consumer status via NATS pub/sub for monitoring
- Sends periodic heartbeats

## Usage

```python
from src.config import get_settings
from src.clients.nats import NatsClient
from src.clients.nats_pubsub import NatsPubSubPublisher
from src.clients.qdrant import QdrantClientWrapper
from src.embedders.factory import EmbedderFactory
from src.indexing import (
    DocumentIndexer,
    MemoryEventConsumer,
    MemoryConsumerConfig,
)

# Initialize dependencies
settings = get_settings()
nats = NatsClient()
qdrant = QdrantClientWrapper(settings)
await qdrant.connect()

nats_pubsub = NatsPubSubPublisher()
await nats_pubsub.connect()

embedders = EmbedderFactory(settings)
await embedders.preload_all()  # Optional: preload models

# Create indexer
indexer = DocumentIndexer(qdrant, embedders)

# Create and start consumer
config = MemoryConsumerConfig(
    topic="memory.node_created",
    group_id="search-indexer",
)
consumer = MemoryEventConsumer(nats, indexer, nats_pubsub, config)

# Start consuming (blocks until stopped)
await consumer.start()
```

## Configuration

### MemoryConsumerConfig

- `topic` - NATS subject to consume (default: `memory.node_created`)
- `group_id` - Consumer group ID (default: `search-indexer`)
- `batch_config` - BatchQueue configuration
- `indexer_config` - DocumentIndexer configuration
- `heartbeat_interval_ms` - NATS heartbeat interval (default: 30000ms)
- `service_id` - Unique service instance ID (auto-generated)

### BatchConfig

- `batch_size` - Max documents per batch (default: 100)
- `flush_interval_ms` - Max ms before flush (default: 5000)
- `max_queue_size` - Max pending documents (default: 1000)

### IndexerConfig

- `collection_name` - Qdrant collection (default: `engram_memory`)
- `dense_vector_name` - Dense vector field (default: `text_dense`)
- `sparse_vector_name` - Sparse vector field (default: `text_sparse`)
- `colbert_vector_name` - ColBERT vector field (default: `text_colbert`)
- `enable_colbert` - Enable ColBERT embeddings (default: `true`)
- `batch_size` - Embedding batch size (default: 32)

## Event Format

Expected NATS message structure for `memory.nodes.created`:

```json
{
  "id": "node-uuid",
  "content": "The actual text content to be indexed",
  "type": "thought|code|doc",
  "sessionId": "session-uuid",
  "metadata": {
    "timestamp": 1234567890,
    "vt_start": "2024-01-01T00:00:00Z",
    "tt_start": "2024-01-01T00:00:00Z"
  }
}
```

## Monitoring

The consumer publishes status updates to NATS subject `observatory.consumers.status`:

- `consumer_ready` - Published when consumer starts
- `consumer_heartbeat` - Published periodically (every 30s)
- `consumer_disconnected` - Published when consumer stops

Monitor with NATS CLI:
```bash
nats sub observatory.consumers.status
```

## Error Handling

- Batch flush errors are logged but don't crash the queue
- Message parsing errors are logged and skipped
- Indexing errors are logged and return 0 for failed documents
- NATS connection failures log warnings but don't stop indexing

## Performance Tuning

For high throughput:
1. Increase `batch_size` (100-500 documents)
2. Reduce `flush_interval_ms` (1000-3000ms)
3. Disable ColBERT embeddings if not needed
4. Use GPU for embedding inference (`embedder_device=cuda`)
5. Increase `embedder_batch_size` (32-128)

For low latency:
1. Decrease `batch_size` (10-50 documents)
2. Decrease `flush_interval_ms` (500-2000ms)
3. Keep ColBERT enabled for better ranking quality
