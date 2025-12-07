# Bead: Create Blob Storage Adapter

## Context
Large text bodies (LLM outputs > 1KB) shouldn't live in Redis RAM.

## Goal
Implement an adapter that saves content to a Blob Store (File System locally, GCS in prod) and returns a URI.

## Interface
```typescript
interface BlobStore {
  save(content: string): Promise<string>; // returns blob://<hash> or gs://<bucket>/<hash>
  read(uri: string): Promise<string>;
}
```

## Implementation (FileSystem)
-   Hash content (SHA256).
-   Write to `data/blobs/<hash>`.
-   Return `file://data/blobs/<hash>`.

## Acceptance Criteria
-   [ ] `BlobStore` interface defined.
-   [ ] `FileSystemAdapter` implemented.
-   [ ] `GCSAdapter` stubbed for future implementation.
