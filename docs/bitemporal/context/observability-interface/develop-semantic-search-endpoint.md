# Bead: Develop Semantic Search Endpoint

## Context
Frontend needs to search memory.

## Goal
`POST /api/search`

## Logic
1.  Accept query string.
2.  Call `SearchService` (via MCP or direct gRPC/HTTP).
3.  Return ranked results.

## Acceptance Criteria
-   [ ] Route implemented.
