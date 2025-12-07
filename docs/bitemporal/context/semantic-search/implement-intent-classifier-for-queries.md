# Bead: Implement Intent Classifier for Queries

## Context
Is the user asking for "exact code string" (Sparse) or "concepts" (Dense)?

## Goal
A micro-classifier (RegEx or Zero-shot) to route queries.

## Logic
-   If query is quoted `"function foo()"` -> **Sparse** boost.
-   If query is natural language "how do I..." -> **Dense** boost.
-   If mixed -> **Hybrid**.

## Acceptance Criteria
-   [ ] `QueryClassifier` class.
-   [ ] Returns weights for dense vs sparse fusion (alpha parameter).
