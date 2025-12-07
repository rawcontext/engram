# Bead: Implement PII Redaction Logic

## Context
We must scrub sensitive data. We'll use a `Redactor` service class in the Ingestion app.

## Goal
Sanitize text/thoughts before they are put into `ParsedStreamEvent`.

## Strategy
-   **Library**: `google-libphonenumber` for phones, simple Regex for emails/credit cards/keys.
-   **Performance**: Since this runs in the `Ingestion Service` (Bun), we can use fast regexes.
-   **Rules**:
    -   `EMAIL`: `/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g` -> `[EMAIL]`
    -   `CREDIT_CARD`: Regex with Luhn check (optional, or just broad regex). -> `[CREDIT_CARD]`
    -   `SSN`: Regex. -> `[SSN]`

## Acceptance Criteria
-   [ ] `Redactor` class implemented in `packages/ingestion-core`.
-   [ ] Unit tests with sample PII strings.
-   [ ] Performance test ensures minimal latency overhead.
