# Bead: Implement Diff Application Logic

## Context
Code changes arrive as "Diff Hunks" (Memory). The Execution engine must apply these to the VFS to reach the next state.

## Goal
Apply unified diffs or search/replace blocks to VFS files.

## Strategy
-   **Library**: `diff` (npmjs) or `diff-match-patch-ts` (Google's algo).
-   **Robustness**: If a patch fails (fuzzy match), we must decide:
    -   *Strict*: Fail execution.
    -   *Fuzzy*: Attempt best-effort application (like `patch` command).
    -   *Decision*: **Strict** for now. Determinism requires exact matches.

## Logic
1.  Read target file from VFS.
2.  Apply Patch.
3.  Write result back to VFS.
4.  Update `lastModified`.

## Acceptance Criteria
-   [ ] `PatchManager` class implemented in `packages/vfs`.
-   [ ] Supports standard Unified Diff format.
-   [ ] Throws explicit error on patch failure (line mismatch).
