#!/usr/bin/env bun
/**
 * Mock OAuth Server CLI
 *
 * Standalone CLI to start the mock OAuth server.
 * Usage: bun run auth-mock
 *
 * @module @engram/auth-mock/cli
 */

import { createMockAuthServer } from "./server";

const port = Number.parseInt(process.env.PORT || "3010", 10);

createMockAuthServer(port);
