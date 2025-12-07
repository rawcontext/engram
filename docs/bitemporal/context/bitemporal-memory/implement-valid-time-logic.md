# Bead: Implement Valid Time Logic

## Context
Sometimes we learn a fact that was true in the past (e.g., "User was actually in NY yesterday").

## Goal
Allow inserting nodes with specific `vt_start` and `vt_end` that differs from `now()`.

## Logic
-   The `writeNode` function must accept optional `validFrom` params.
-   If not provided, default to `now()`.

## Acceptance Criteria
-   [ ] `writeNode` updated to support custom valid-time windows.
