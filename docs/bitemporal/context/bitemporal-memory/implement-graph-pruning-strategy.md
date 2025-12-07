# Bead: Implement Graph Pruning Strategy

## Context
Even with blob offloading, the graph will grow. We need a strategy to prune "Transaction History" (the `tt` axis) after a retention period, while keeping "Valid History".

## Goal
Define a cron job to remove old transaction versions.

## Logic
`MATCH (n) WHERE n.tt_end < $threshold DELETE n`
This permanently forgets that we *used to know* something differently. This destroys auditability but saves space.
*Policy*: Archive to cold storage (Parquet/S3) before delete.

## Acceptance Criteria
-   [ ] Pruning query defined.
-   [ ] Archive strategy (dump to JSONL) defined.
