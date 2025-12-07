# Bead: Develop Output Capture (Stdout/Stderr)

## Context
The result of a tool is its standard output.

## Goal
Capture `stdout` and `stderr` streams from the WASI instance.

## Implementation
-   **Bun WASI**: Allows passing custom file descriptors.
-   Create a custom `File` object or `Pipe` for `stdout` (fd 1) and `stderr` (fd 2).
-   Read from these pipes after execution finishes.

## Acceptance Criteria
-   [ ] Capture logic implemented.
-   [ ] Output is parsed (JSON extracted from stdout).
-   [ ] Raw logs stored for debugging.
