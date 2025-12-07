# Bead: Implement Qdrant Snapshot Manager

## Context
Backing up the vector index.

## Goal
Automate Qdrant snapshots.

## Logic
-   **Cron**: Daily.
-   **API**: `POST /collections/{name}/snapshots`.
-   **Storage**: Download snapshot and upload to GCS (same as BlobStore).

## Acceptance Criteria
-   [ ] `SnapshotService` class.
-   [ ] `createSnapshot()` and `restoreSnapshot()` methods.
