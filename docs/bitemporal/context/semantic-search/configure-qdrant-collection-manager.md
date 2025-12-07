# Bead: Configure Qdrant Collection Manager

## Context
We need to set up the Qdrant collection with the right index parameters for Hybrid Search.

## Goal
Write a script/class to initialize the `soul_memory` collection.

## Configuration
```json
{
  "vectors": {
    "dense": {
      "size": 384, // e5-small
      "distance": "Cosine"
    }
  },
  "sparse_vectors": {
    "sparse": {
      "index": {
        "on_disk": false, // Keep sparse index in RAM for speed
        "datatype": "float16"
      }
    }
  }
}
```

## Acceptance Criteria
-   [ ] `SchemaManager` class.
-   [ ] `ensureCollection()` method checks existence and creates if missing.
