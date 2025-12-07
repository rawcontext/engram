# Bead: Create Similarity Score Threshold Configuration

## Context
When is a search result "irrelevant"?

## Goal
Define dynamic thresholds.

## Logic
-   **Config**: `min_score` per model type.
-   **Dynamic**: If top result score < `min_score`, return "No knowledge found".
-   **Calibration**: Needs manual testing to find the "knee" of the curve for `e5-small`.

## Acceptance Criteria
-   [ ] Config file with thresholds.
-   [ ] Filter logic in `SearchService`.
