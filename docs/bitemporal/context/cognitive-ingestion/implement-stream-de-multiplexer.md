# Bead: Implement Stream De-multiplexer

## Context
If multiple users/agents generate events simultaneously, the "Raw Stream" contains interleaved chunks.

## Goal
Ensure downstream processors can reconstruct the linear stream for a single `event_id` or `session_id`.

## Strategy
-   **Partitioning**: Use `session_id` as the Kafka/Redpanda Message Key.
-   **Effect**: Redpanda guarantees order within a partition. All events for `session_A` go to Partition 1. The consumer reading Partition 1 sees them in order.
-   **Implementation**: In the Producer configuration, ensure `send()` includes `key: event.metadata.session_id`.

## Acceptance Criteria
-   [ ] `sendEvent` function requires a `key` (session ID).
-   [ ] Documentation highlights the importance of partitioning for ordering.
