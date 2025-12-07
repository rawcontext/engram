# Bead: Implement Secret Masking Regex

## Context
Specific focus on API Keys and Secrets, which are dangerous if leaked into logs/memory.

## Goal
Detect and redact high-entropy strings or known key formats.

## Strategy
-   **OpenAI Key**: `sk-[a-zA-Z0-9]{48}`.
-   **Anthropic Key**: `sk-ant-[a-zA-Z0-9-_]+`.
-   **AWS Key**: `AKIA...`.
-   **Generic**: Strings > 32 chars with mixed case/numbers and high entropy (if feasible, otherwise stick to known patterns to avoid false positives in code generation).

## Acceptance Criteria
-   [ ] Regex patterns added to `Redactor` class.
-   [ ] Validates against dummy keys.
