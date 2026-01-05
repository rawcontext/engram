/**
 * Integration test fixtures.
 *
 * These fixtures can use either:
 * 1. Real testcontainers (if RUN_INTEGRATION_TESTS=1 and USE_TESTCONTAINERS=1)
 * 2. Existing dev containers (if RUN_INTEGRATION_TESTS=1)
 *
 * For local development, use existing dev containers for speed.
 * For CI, use testcontainers for isolation.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { hashToken } from "../../src/db/oauth-tokens";

// Container instances (session-scoped)
let postgresContainer: StartedPostgreSqlContainer | null = null;
let falkordbContainer: StartedTestContainer | null = null;
let usingDevContainers = false;

// Test credentials
export const TEST_USER = {
	id: "test-user-123",
	name: "Test User",
	email: "test@example.com",
};

export const TEST_ORG = {
	id: "test-org-123",
	slug: "test-org",
	name: "Test Organization",
};

// Test token - follows egm_oauth_* format
export const TEST_ACCESS_TOKEN = "egm_oauth_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4_X7kM2p";
export const TEST_REFRESH_TOKEN = "egm_refresh_b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5_Y8nL3q";

/**
 * Check if integration tests should run.
 * Tests are skipped unless RUN_INTEGRATION_TESTS=1 is set.
 */
export function shouldRunIntegrationTests(): boolean {
	return process.env.RUN_INTEGRATION_TESTS === "1";
}

/**
 * Check if we should use testcontainers or existing dev containers.
 */
export function shouldUseTestcontainers(): boolean {
	return process.env.USE_TESTCONTAINERS === "1";
}

/**
 * Start PostgreSQL - either testcontainer or use existing dev container.
 */
export async function startPostgresContainer(): Promise<StartedPostgreSqlContainer | null> {
	if (postgresContainer) {
		return postgresContainer;
	}

	if (!shouldUseTestcontainers()) {
		// Use existing dev container
		usingDevContainers = true;
		console.log("Using existing dev PostgreSQL container at localhost:6183");
		return null;
	}

	postgresContainer = await new PostgreSqlContainer("postgres:16-alpine")
		.withDatabase("engram")
		.withUsername("test")
		.withPassword("test")
		.withStartupTimeout(60_000)
		.start();

	return postgresContainer;
}

/**
 * Get PostgreSQL connection URL.
 */
export function getPostgresUrl(): string {
	if (usingDevContainers || !shouldUseTestcontainers()) {
		return "postgresql://postgres:postgres@localhost:6183/engram";
	}
	if (!postgresContainer) {
		throw new Error("PostgreSQL container not started");
	}
	return postgresContainer.getConnectionUri();
}

/**
 * Start FalkorDB - either testcontainer or use existing dev container.
 */
export async function startFalkorDBContainer(): Promise<StartedTestContainer | null> {
	if (falkordbContainer) {
		return falkordbContainer;
	}

	if (!shouldUseTestcontainers()) {
		// Use existing dev container
		usingDevContainers = true;
		console.log("Using existing dev FalkorDB container at localhost:6179");
		return null;
	}

	falkordbContainer = await new GenericContainer("falkordb/falkordb:latest")
		.withExposedPorts(6379)
		.withWaitStrategy(Wait.forListeningPorts())
		.withStartupTimeout(60_000)
		.start();

	return falkordbContainer;
}

/**
 * Get FalkorDB Redis URL.
 */
export function getFalkorDBUrl(): string {
	if (usingDevContainers || !shouldUseTestcontainers()) {
		return "redis://localhost:6179";
	}
	if (!falkordbContainer) {
		throw new Error("FalkorDB container not started");
	}
	const host = falkordbContainer.getHost();
	const port = falkordbContainer.getMappedPort(6379);
	return `redis://${host}:${port}`;
}

/**
 * Initialize the database schema for tests.
 */
export async function initializeDatabase(postgresUrl: string): Promise<void> {
	const pool = new pg.Pool({ connectionString: postgresUrl });

	try {
		// Drop existing tables for clean test state
		await pool.query(`DROP TABLE IF EXISTS oauth_tokens CASCADE`);
		await pool.query(`DROP TABLE IF EXISTS organizations CASCADE`);
		await pool.query(`DROP TABLE IF EXISTS "user" CASCADE`);

		// Create user table
		await pool.query(`
			CREATE TABLE IF NOT EXISTS "user" (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT NOT NULL UNIQUE,
				"emailVerified" BOOLEAN DEFAULT FALSE NOT NULL,
				image TEXT,
				role TEXT DEFAULT 'user',
				"createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
				"updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
			)
		`);

		// Create organizations table
		await pool.query(`
			CREATE TABLE IF NOT EXISTS organizations (
				id TEXT PRIMARY KEY,
				slug TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
			)
		`);

		// Create oauth_tokens table
		await pool.query(`
			CREATE TABLE IF NOT EXISTS oauth_tokens (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				access_token_hash TEXT NOT NULL UNIQUE,
				refresh_token_hash TEXT NOT NULL UNIQUE,
				access_token_prefix TEXT NOT NULL,
				user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
				scopes TEXT[] NOT NULL DEFAULT ARRAY['memory:read', 'memory:write', 'query:read'],
				rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
				access_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
				refresh_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
				created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
				last_used_at TIMESTAMP WITH TIME ZONE,
				revoked_at TIMESTAMP WITH TIME ZONE,
				revoked_reason TEXT,
				client_id TEXT NOT NULL DEFAULT 'mcp',
				grant_type TEXT NOT NULL DEFAULT 'device_code',
				client_id_ref UUID,
				org_id TEXT REFERENCES organizations(id),
				org_slug TEXT
			)
		`);

		// Insert test user (ignore conflict - may exist from previous runs)
		await pool.query(
			`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)
			 ON CONFLICT (id) DO UPDATE SET name = $2, email = $3`,
			[TEST_USER.id, TEST_USER.name, TEST_USER.email],
		);

		// Insert test organization
		await pool.query(
			`INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)
			 ON CONFLICT (id) DO UPDATE SET slug = $2, name = $3`,
			[TEST_ORG.id, TEST_ORG.slug, TEST_ORG.name],
		);

		// Delete existing test token and insert fresh one
		const accessTokenHash = hashToken(TEST_ACCESS_TOKEN);
		const refreshTokenHash = hashToken(TEST_REFRESH_TOKEN);
		const accessTokenPrefix = TEST_ACCESS_TOKEN.slice(0, 16);

		await pool.query(`DELETE FROM oauth_tokens WHERE access_token_hash = $1`, [accessTokenHash]);

		await pool.query(
			`INSERT INTO oauth_tokens (
				access_token_hash, refresh_token_hash, access_token_prefix,
				user_id, scopes, rate_limit_rpm, org_id, org_slug,
				access_token_expires_at, refresh_token_expires_at,
				client_id, grant_type
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			[
				accessTokenHash,
				refreshTokenHash,
				accessTokenPrefix,
				TEST_USER.id,
				["memory:read", "memory:write", "query:read"],
				60,
				TEST_ORG.id,
				TEST_ORG.slug,
				new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
				new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
				"mcp",
				"device_code",
			],
		);

		console.log("Database initialized with test data");
	} finally {
		await pool.end();
	}
}

/**
 * Stop all containers (only if using testcontainers).
 */
export async function stopAllContainers(): Promise<void> {
	if (!shouldUseTestcontainers()) {
		console.log("Using dev containers - nothing to stop");
		return;
	}

	const promises: Promise<void>[] = [];

	if (postgresContainer) {
		promises.push(
			postgresContainer.stop().then(() => {
				postgresContainer = null;
			}),
		);
	}

	if (falkordbContainer) {
		promises.push(
			falkordbContainer.stop().then(() => {
				falkordbContainer = null;
			}),
		);
	}

	await Promise.all(promises);
}

/**
 * Create an auth header with the test token.
 */
export function authHeader(token: string = TEST_ACCESS_TOKEN): { Authorization: string } {
	return { Authorization: `Bearer ${token}` };
}
