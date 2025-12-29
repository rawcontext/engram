#!/bin/bash
# Test script that handles CI-specific exclusions
#
# Files that use mock.module("pg") fail in CI due to Bun limitations.
# This script temporarily renames those files before running tests.

set -e

# Files that use mock.module("pg") and fail in CI due to Bun limitations
EXCLUDED_FILES=(
  "apps/ingestion/src/auth.test.ts"
  "apps/ingestion/src/index.test.ts"
  "packages/storage/src/postgres.test.ts"
  "apps/observatory/lib/client-registration.test.ts"
  "apps/observatory/lib/register.test.ts"
)

cleanup() {
  # Restore renamed files
  for file in "${EXCLUDED_FILES[@]}"; do
    if [ -f "${file}.skip" ]; then
      mv "${file}.skip" "$file"
    fi
  done
}

if [ "$CI" = "true" ]; then
  echo "Running in CI mode - temporarily hiding mock.module tests"

  # Temporarily rename excluded files so they won't be discovered
  for file in "${EXCLUDED_FILES[@]}"; do
    if [ -f "$file" ]; then
      mv "$file" "${file}.skip"
    fi
  done

  # Set trap to restore files on exit
  trap cleanup EXIT

  # Run tests normally - bunfig.toml handles preload
  bun test
else
  # Local mode - run all tests
  bun test
fi
