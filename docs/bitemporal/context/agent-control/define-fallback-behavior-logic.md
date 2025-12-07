# Bead: Define Fallback Behavior Logic

## Context
What if the LLM hallucinates a tool that doesn't exist? Or outputs malformed JSON?

## Goal
Robust error recovery.

## Strategy
-   **Parsing Error**: Feed the raw output back to the LLM with a system message: "You generated invalid JSON. Please fix it."
-   **Hallucinated Tool**: Feed back: "Tool X does not exist. Available tools: [A, B, C]."
-   **Refusal**: If LLM refuses (safety), log it and inform user.

## Acceptance Criteria
-   [ ] `ErrorHandler` workflow step implemented.
-   [ ] Retries max 3 times before giving up.
