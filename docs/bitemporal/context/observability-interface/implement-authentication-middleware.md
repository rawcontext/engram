# Bead: Implement Authentication Middleware

## Context
This is an internal admin tool, but it needs protection.

## Goal
Secure the routes.

## Strategy
-   **Clerk** or **NextAuth**.
-   *Decision*: **Clerk** is faster to setup for a "Soul" project.
-   **Middleware**: `clerkMiddleware()` protects `/api` and `/dashboard`.

## Acceptance Criteria
-   [ ] Clerk added to `apps/interface`.
-   [ ] Middleware configured.
