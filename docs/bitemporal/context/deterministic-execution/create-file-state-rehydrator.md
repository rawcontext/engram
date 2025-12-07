# Bead: Create File State Rehydrator

## Context
To execute code at Time T, we need the VFS state at Time T.

## Goal
Implement the logic to reconstruct VFS from a base Snapshot + Chain of Diffs.

## Logic
1.  **Query Memory**: Find the latest `SnapshotNode` where `tt_end <= T`.
2.  **Load Snapshot**: Initialize VFS.
3.  **Query Memory**: Find all `DiffHunkNode` events between Snapshot Time and T, ordered by time.
4.  **Replay**: Sequentially apply each Diff to the VFS.
5.  **Result**: VFS is ready for execution.

## Acceptance Criteria
-   [ ] `Rehydrator` service implemented.
-   [ ] Integration test with mock Memory client: Snapshot -> Diff -> Diff -> Verify State.
