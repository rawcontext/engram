# Bead: Implement RBAC Authorization Logic

## Context
Differentiate between "Viewer" (ReadOnly) and "Admin" (Can Replay/Edit Memory).

## Goal
Enforce roles.

## Logic
-   Check `auth().claims.metadata.role`.
-   If `Admin` required and missing -> `403 Forbidden`.

## Acceptance Criteria
-   [ ] `checkRole` utility implemented.
