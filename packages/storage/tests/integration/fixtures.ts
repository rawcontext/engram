/**
 * Integration test fixtures for Storage package.
 *
 * Uses testcontainers for isolated testing of storage clients.
 * Supports both testcontainers (CI) and existing dev containers (local dev).
 */

import { jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { FalkorDB, type Graph } from "falkordb";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

// Container instances (session-scoped)
let falkordbContainer: StartedTestContainer | null = null;
let natsContainer: StartedTestContainer | null = null;
let postgresContainer: StartedTestContainer | null = null;
let usingDevContainers = false;

/**
 * Check if integration tests should run.
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

// =============================================================================
// FalkorDB Fixtures
// =============================================================================

export async function startFalkorDBContainer(): Promise<StartedTestContainer | null> {
	if (falkordbContainer) {
		return falkordbContainer;
	}

	if (!shouldUseTestcontainers()) {
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
 * Create a FalkorDB connection for testing.
 */
export async function createTestFalkorConnection(graphName: string): Promise<{
	db: FalkorDB;
	graph: Graph;
	cleanup: () => Promise<void>;
}> {
	const url = getFalkorDBUrl();
	const urlObj = new URL(url);

	const db = await FalkorDB.connect({
		username: urlObj.username,
		password: urlObj.password,
		socket: {
			host: urlObj.hostname,
			port: Number(urlObj.port) || 6379,
		},
	});

	const graph = db.selectGraph(graphName);

	return {
		db,
		graph,
		cleanup: async () => {
			try {
				// Delete the test graph
				await graph.query("MATCH (n) DETACH DELETE n");
			} catch {
				// Graph may not exist
			}
			await db.close();
		},
	};
}

// =============================================================================
// NATS Fixtures
// =============================================================================

export async function startNatsContainer(): Promise<StartedTestContainer | null> {
	if (natsContainer) {
		return natsContainer;
	}

	if (!shouldUseTestcontainers()) {
		usingDevContainers = true;
		console.log("Using existing dev NATS container at localhost:6181");
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
	if (!natsContainer) {
		throw new Error("NATS container not started");
	}
	const host = natsContainer.getHost();
	const port = natsContainer.getMappedPort(4222);
	return `${host}:${port}`;
}

/**
 * Create a NATS connection for testing with JetStream streams.
 */
export async function createTestNatsConnection(): Promise<{
	nc: NatsConnection;
	cleanup: () => Promise<void>;
}> {
	const url = getNatsUrl();
	const nc = await connect({ servers: url });

	// Ensure test streams exist
	const jsm = await jetstreamManager(nc);

	// Create EVENTS stream if it doesn't exist
	try {
		await jsm.streams.add({
			name: "EVENTS",
			subjects: ["events.>"],
			retention: "limits",
			max_msgs: 10000,
			max_age: 3600 * 1e9, // 1 hour in nanoseconds
		});
	} catch (err) {
		const error = err as Error;
		if (!error.message?.includes("already in use")) {
			throw err;
		}
	}

	return {
		nc,
		cleanup: async () => {
			try {
				await nc.drain();
				await nc.close();
			} catch {
				// Connection may already be closed
			}
		},
	};
}

// =============================================================================
// PostgreSQL Fixtures
// =============================================================================

export async function startPostgresContainer(): Promise<StartedTestContainer | null> {
	if (postgresContainer) {
		return postgresContainer;
	}

	if (!shouldUseTestcontainers()) {
		usingDevContainers = true;
		console.log("Using existing dev PostgreSQL container at localhost:6183");
		return null;
	}

	postgresContainer = await new GenericContainer("postgres:16-alpine")
		.withEnvironment({
			POSTGRES_USER: "engram",
			POSTGRES_PASSWORD: "engram",
			POSTGRES_DB: "engram_test",
		})
		.withExposedPorts(5432)
		.withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections"))
		.withStartupTimeout(60_000)
		.start();

	return postgresContainer;
}

export function getPostgresUrl(): string {
	if (usingDevContainers || !shouldUseTestcontainers()) {
		return "postgresql://postgres:postgres@localhost:6183/postgres";
	}
	if (!postgresContainer) {
		throw new Error("PostgreSQL container not started");
	}
	const host = postgresContainer.getHost();
	const port = postgresContainer.getMappedPort(5432);
	return `postgresql://engram:engram@${host}:${port}/engram_test`;
}

/**
 * Create a PostgreSQL connection for testing.
 */
export async function createTestPostgresConnection(): Promise<{
	pool: pg.Pool;
	cleanup: () => Promise<void>;
}> {
	const url = getPostgresUrl();
	const pool = new pg.Pool({
		connectionString: url,
		max: 5,
		idleTimeoutMillis: 10000,
		connectionTimeoutMillis: 5000,
	});

	// Test connection
	const client = await pool.connect();
	await client.query("SELECT 1");
	client.release();

	return {
		pool,
		cleanup: async () => {
			await pool.end();
		},
	};
}

// =============================================================================
// Container Lifecycle
// =============================================================================

export async function stopAllContainers(): Promise<void> {
	if (!shouldUseTestcontainers()) {
		console.log("Using dev containers - nothing to stop");
		return;
	}

	const promises: Promise<void>[] = [];

	if (falkordbContainer) {
		promises.push(
			falkordbContainer.stop().then(() => {
				falkordbContainer = null;
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

	if (postgresContainer) {
		promises.push(
			postgresContainer.stop().then(() => {
				postgresContainer = null;
			}),
		);
	}

	await Promise.all(promises);
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Generate a unique test graph name.
 */
export function createTestGraphName(): string {
	return `test_storage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a unique test ID.
 */
export function createTestId(prefix = "test"): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
