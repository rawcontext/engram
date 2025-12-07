# Bead: Create Time-Travel State Reconstruction

## Context
Debugging often requires inspecting the file system at a point in the past.

## Goal
Expose an API to download/view the VFS as it existed at `event_id`.

## Logic
1.  Use `Rehydrator` to build VFS at `event_id`.
2.  Zip the VFS.
3.  Return the Zip or serve a file listing.

## Acceptance Criteria
-   [ ] `TimeTravelService` implemented.
-   [ ] `getFilesystemState(eventId)` returns a traversable object.
