/**
 * Integration test fixtures for Memory service.
 *
 * These fixtures can use either:
 * 1. Real testcontainers (if RUN_INTEGRATION_TESTS=1 and USE_TESTCONTAINERS=1)
 * 2. Existing dev containers (if RUN_INTEGRATION_TESTS=1)
 *
 * For local development, use existing dev containers for speed.
 * For CI, use testcontainers for isolation.
 */

import type { GraphClient } from "@engram/storage";
import { FalkorDB, type Graph } from "falkordb";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

// Container instances (session-scoped)
let falkordbContainer: StartedTestContainer | null = null;
let natsContainer: StartedTestContainer | null = null;
let usingDevContainers = false;

// Test organization for multi-tenant testing
export const TEST_ORG = {
	id: "test-org-memory",
	slug: "test-org-mem",
	name: "Memory Test Organization",
};

export const TEST_ORG_2 = {
	id: "test-org-memory-2",
	slug: "test-org-mem-2",
	name: "Memory Test Organization 2",
};

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
 * Test-specific FalkorDB client that allows custom graph names.
 * Implements GraphClient interface for use with TurnAggregator.
 */
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

/**
 * Start NATS - either testcontainer or use existing dev container.
 */
export async function startNatsContainer(): Promise<StartedTestContainer | null> {
	if (natsContainer) {
		return natsContainer;
	}

	if (!shouldUseTestcontainers()) {
		// Use existing dev container
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

/**
 * Get NATS connection URL.
 */
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
 * Stop all containers (only if using testcontainers).
 */
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

	await Promise.all(promises);
}

/**
 * Create a unique test graph name to isolate tests.
 */
export function createTestGraphName(): string {
	return `test_memory_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a unique session ID for tests.
 */
export function createTestSessionId(): string {
	return `session-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a mock parsed event for testing.
 */
export function createMockParsedEvent(overrides: {
	sessionId: string;
	type?: string;
	content?: string;
	thought?: string;
	toolCall?: { id: string; name: string; arguments_delta: string };
	usage?: { input_tokens: number; output_tokens: number };
	orgId?: string;
	orgSlug?: string;
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
		org_id: overrides.orgId || TEST_ORG.id,
		org_slug: overrides.orgSlug || TEST_ORG.slug,
		vt_start: Date.now(),
	};
}
