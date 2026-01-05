/**
 * E2E test fixtures for full memory lifecycle testing.
 *
 * Orchestrates all required services:
 * - PostgreSQL (OAuth tokens)
 * - NATS (event streaming)
 * - FalkorDB (graph storage)
 * - Qdrant (vector search)
 */

import type { BlobStore, GraphClient } from "@engram/storage";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { FalkorDB, type Graph } from "falkordb";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

// Container instances (session-scoped)
let postgresContainer: StartedPostgreSqlContainer | null = null;
let natsContainer: StartedTestContainer | null = null;
let falkordbContainer: StartedTestContainer | null = null;
let qdrantContainer: StartedTestContainer | null = null;
let usingDevContainers = false;

// Test credentials
export const TEST_USER = {
	id: "e2e-test-user",
	name: "E2E Test User",
	email: "e2e@test.example.com",
};

export const TEST_ORG = {
	id: "e2e-test-org",
	slug: "e2e-test",
	name: "E2E Test Organization",
};

export const TEST_ACCESS_TOKEN = "egm_oauth_e2e1d4e5f6a1b2c3d4e5f6a1b2c3d4e5_A1bC2d";
export const TEST_REFRESH_TOKEN = "egm_refresh_e2e2d4e5f6a1b2c3d4e5f6a1b2c3d4e5_B2cD3e";

export function hashToken(token: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(token);
	return hasher.digest("hex");
}

export function shouldRunIntegrationTests(): boolean {
	return process.env.RUN_INTEGRATION_TESTS === "1";
}

export function shouldUseTestcontainers(): boolean {
	return process.env.USE_TESTCONTAINERS === "1";
}

// =============================================================================
// PostgreSQL
// =============================================================================

export async function startPostgresContainer(): Promise<StartedPostgreSqlContainer | null> {
	if (postgresContainer) return postgresContainer;

	if (!shouldUseTestcontainers()) {
		usingDevContainers = true;
		console.log("Using existing dev PostgreSQL at localhost:6183");
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

export function getPostgresUrl(): string {
	if (usingDevContainers || !shouldUseTestcontainers()) {
		return "postgresql://postgres:postgres@localhost:6183/engram";
	}
	if (!postgresContainer) throw new Error("PostgreSQL container not started");
	return postgresContainer.getConnectionUri();
}

// =============================================================================
// NATS
// =============================================================================

export async function startNatsContainer(): Promise<StartedTestContainer | null> {
	if (natsContainer) return natsContainer;

	if (!shouldUseTestcontainers()) {
		usingDevContainers = true;
		console.log("Using existing dev NATS at localhost:6181");
		return null;
	}

	natsContainer = await new GenericContainer("nats:2.12-alpine")
		.withCommand(["--jetstream", "--store_dir=/data", "-m", "8222"])
		.withExposedPorts(4222, 8222)
		.withWaitStrategy(Wait.forHttp("/healthz", 8222))
		.withStartupTimeout(60_000)
		.start();

	return natsContainer;
}

export function getNatsUrl(): string {
	if (usingDevContainers || !shouldUseTestcontainers()) {
		return "localhost:6181";
	}
	if (!natsContainer) throw new Error("NATS container not started");
	return `${natsContainer.getHost()}:${natsContainer.getMappedPort(4222)}`;
}

// =============================================================================
// FalkorDB
// =============================================================================

export async function startFalkorDBContainer(): Promise<StartedTestContainer | null> {
	if (falkordbContainer) return falkordbContainer;

	if (!shouldUseTestcontainers()) {
		usingDevContainers = true;
		console.log("Using existing dev FalkorDB at localhost:6179");
		return null;
	}

	falkordbContainer = await new GenericContainer("falkordb/falkordb:latest")
		.withExposedPorts(6379)
		.withWaitStrategy(Wait.forListeningPorts())
		.withStartupTimeout(60_000)
		.start();

	return falkordbContainer;
}

export function getFalkorDBUrl(): string {
	if (usingDevContainers || !shouldUseTestcontainers()) {
		return "redis://localhost:6179";
	}
	if (!falkordbContainer) throw new Error("FalkorDB container not started");
	return `redis://${falkordbContainer.getHost()}:${falkordbContainer.getMappedPort(6379)}`;
}

// =============================================================================
// Qdrant
// =============================================================================

export async function startQdrantContainer(): Promise<StartedTestContainer | null> {
	if (qdrantContainer) return qdrantContainer;

	if (!shouldUseTestcontainers()) {
		usingDevContainers = true;
		console.log("Using existing dev Qdrant at localhost:6180");
		return null;
	}

	qdrantContainer = await new GenericContainer("qdrant/qdrant:latest")
		.withExposedPorts(6333, 6334)
		.withWaitStrategy(Wait.forHttp("/healthz", 6333))
		.withStartupTimeout(60_000)
		.start();

	return qdrantContainer;
}

export function getQdrantUrl(): string {
	if (usingDevContainers || !shouldUseTestcontainers()) {
		return "http://localhost:6180";
	}
	if (!qdrantContainer) throw new Error("Qdrant container not started");
	return `http://${qdrantContainer.getHost()}:${qdrantContainer.getMappedPort(6333)}`;
}

// =============================================================================
// Test FalkorDB Client
// =============================================================================

export class TestFalkorClient implements GraphClient {
	private db: FalkorDB | null = null;
	private graph: Graph | null = null;
	private connected = false;
	private url: string;
	private graphName: string;

	constructor(url: string, graphName: string) {
		this.url = url;
		this.graphName = graphName;
	}

	async connect(): Promise<void> {
		if (this.connected && this.db) return;

		const urlObj = new URL(this.url);
		this.db = await FalkorDB.connect({
			username: urlObj.username,
			password: urlObj.password,
			socket: {
				host: urlObj.hostname,
				port: Number(urlObj.port) || 6379,
			},
		});
		this.graph = this.db.selectGraph(this.graphName);
		this.connected = true;
	}

	isConnected(): boolean {
		return this.connected && this.db !== null;
	}

	async query<T = Record<string, unknown>>(
		cypher: string,
		params: Record<string, unknown> = {},
	): Promise<T[]> {
		if (!this.graph) await this.connect();
		if (!this.graph) throw new Error("Graph connection failed");
		const result = await this.graph.query(cypher, { params });
		return result.data as T[];
	}

	async disconnect(): Promise<void> {
		try {
			if (this.db) {
				await this.db.close();
			}
		} finally {
			this.db = null;
			this.graph = null;
			this.connected = false;
		}
	}
}

// =============================================================================
// Test Blob Store
// =============================================================================

export class TestBlobStore implements BlobStore {
	private blobs: Map<string, Buffer> = new Map();

	async save(content: string | Buffer): Promise<string> {
		const buffer = typeof content === "string" ? Buffer.from(content) : content;
		const hasher = new Bun.CryptoHasher("sha256");
		hasher.update(buffer);
		const hash = hasher.digest("hex");
		const uri = `test://${hash}`;
		this.blobs.set(uri, buffer);
		return uri;
	}

	async load(uri: string): Promise<string> {
		const buffer = this.blobs.get(uri);
		if (!buffer) throw new Error(`Blob not found: ${uri}`);
		return buffer.toString("utf-8");
	}

	clear(): void {
		this.blobs.clear();
	}
}

// =============================================================================
// Database Initialization
// =============================================================================

export async function initializeDatabase(postgresUrl: string): Promise<void> {
	const pool = new pg.Pool({ connectionString: postgresUrl });

	try {
		// Drop and recreate tables for clean test state
		await pool.query(`DROP TABLE IF EXISTS oauth_tokens CASCADE`);
		await pool.query(`DROP TABLE IF EXISTS organizations CASCADE`);
		await pool.query(`DROP TABLE IF EXISTS "user" CASCADE`);

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

		await pool.query(`
			CREATE TABLE IF NOT EXISTS organizations (
				id TEXT PRIMARY KEY,
				slug TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
			)
		`);

		await pool.query(`
			CREATE TABLE IF NOT EXISTS oauth_tokens (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				access_token_hash TEXT NOT NULL UNIQUE,
				refresh_token_hash TEXT NOT NULL UNIQUE,
				access_token_prefix TEXT NOT NULL,
				user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
				scopes TEXT[] NOT NULL DEFAULT ARRAY['memory:read', 'memory:write', 'ingest:write'],
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

		// Insert test user
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

		// Insert test token
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
				["memory:read", "memory:write", "ingest:write", "query:read"],
				60,
				TEST_ORG.id,
				TEST_ORG.slug,
				new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
				new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
				"mcp",
				"device_code",
			],
		);

		console.log("E2E Database initialized with test data");
	} finally {
		await pool.end();
	}
}

// =============================================================================
// Cleanup
// =============================================================================

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
	if (natsContainer) {
		promises.push(
			natsContainer.stop().then(() => {
				natsContainer = null;
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
	if (qdrantContainer) {
		promises.push(
			qdrantContainer.stop().then(() => {
				qdrantContainer = null;
			}),
		);
	}

	await Promise.all(promises);
}

export async function cleanupTestGraphData(graphClient: GraphClient): Promise<void> {
	await graphClient.query("MATCH (n) DETACH DELETE n");
}

// =============================================================================
// Test Helpers
// =============================================================================

export function createTestGraphName(): string {
	return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTestSessionId(): string {
	return `session-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function authHeader(token: string = TEST_ACCESS_TOKEN): { Authorization: string } {
	return { Authorization: `Bearer ${token}` };
}

export const BITEMPORAL = {
	TT_INFINITY: 253402300799000,
	VT_INFINITY: 253402300799000,
};

export function createMockParsedEvent(overrides: {
	sessionId: string;
	type?: string;
	content?: string;
	thought?: string;
	toolCall?: { id: string; name: string; arguments_delta: string };
	usage?: { input_tokens: number; output_tokens: number };
}) {
	return {
		event_id: crypto.randomUUID(),
		type: overrides.type || "content",
		role: "assistant",
		content: overrides.content,
		thought: overrides.thought,
		tool_call: overrides.toolCall,
		usage: overrides.usage,
		timestamp: new Date().toISOString(),
		metadata: {
			session_id: overrides.sessionId,
			working_dir: "/test/project",
			git_remote: "git@github.com:test/repo.git",
			agent_type: "claude-code",
		},
		org_id: TEST_ORG.id,
		org_slug: TEST_ORG.slug,
		vt_start: Date.now(),
	};
}
