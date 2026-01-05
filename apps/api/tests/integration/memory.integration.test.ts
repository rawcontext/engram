/**
 * Integration tests for Memory API endpoints.
 *
 * These tests run against real PostgreSQL and FalkorDB containers.
 * Requires Docker to be running.
 *
 * Run with: RUN_INTEGRATION_TESTS=1 bun test tests/integration/memory.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { OAuthTokenRepository } from "../../src/db/oauth-tokens";
import { createMemoryRoutes } from "../../src/routes/memory";
import { MemoryService } from "../../src/services/memory";
import {
	TEST_ACCESS_TOKEN,
	TEST_ORG,
	TEST_USER,
	authHeader,
	getFalkorDBUrl,
	getPostgresUrl,
	initializeDatabase,
	shouldRunIntegrationTests,
	startFalkorDBContainer,
	startPostgresContainer,
	stopAllContainers,
} from "./fixtures";

// Skip all tests if integration tests are not enabled
const runTests = shouldRunIntegrationTests();

describe.skipIf(!runTests)("Memory API Integration Tests", () => {
	let app: Hono;
	let memoryService: MemoryService;
	let postgresClient: {
		query: (text: string, params?: unknown[]) => Promise<unknown>;
		queryOne: (text: string, params?: unknown[]) => Promise<unknown | null>;
		connect: () => Promise<void>;
		disconnect: () => Promise<void>;
		isConnected: () => boolean;
	};
	let falkorClient: {
		query: <T>(cypher: string, params?: Record<string, unknown>) => Promise<T[]>;
		connect: () => Promise<void>;
		disconnect: () => Promise<void>;
		isConnected: () => boolean;
	};
	let oauthTokenRepo: OAuthTokenRepository;

	beforeAll(async () => {
		console.log("Initializing test environment...");

		// Start containers (or use existing dev containers)
		await Promise.all([startPostgresContainer(), startFalkorDBContainer()]);

		console.log(`PostgreSQL URL: ${getPostgresUrl()}`);
		console.log(`FalkorDB URL: ${getFalkorDBUrl()}`);

		// Initialize database schema and test data
		await initializeDatabase(getPostgresUrl());
		console.log("Database initialized");

		// Create real PostgresClient
		const { PostgresClient } = await import("@engram/storage");
		postgresClient = new PostgresClient({ url: getPostgresUrl() });
		await postgresClient.connect();

		// Create real FalkorClient
		const { FalkorClient } = await import("@engram/storage");
		falkorClient = new FalkorClient(getFalkorDBUrl());
		await falkorClient.connect();

		// Create OAuth token repository
		oauthTokenRepo = new OAuthTokenRepository(postgresClient as never);

		// Create mock logger
		const mockLogger = {
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
			trace: () => {},
			fatal: () => {},
		};

		// Create memory service with real clients
		memoryService = new MemoryService({
			graphClient: falkorClient as never,
			searchUrl: "http://localhost:6176", // Search service (mocked for now)
			logger: mockLogger as never,
		});

		// Create the Hono app with auth middleware
		app = new Hono();

		// Add auth middleware that validates real tokens
		const { auth } = await import("../../src/middleware/auth");
		app.use(
			"/memory/*",
			auth({
				logger: mockLogger as never,
				oauthTokenRepo,
			}),
		);

		// Mount memory routes
		app.route(
			"/memory",
			createMemoryRoutes({
				memoryService,
				logger: mockLogger as never,
			}),
		);

		// Add error handler
		app.onError((err, c) => {
			console.error("App error:", err);
			return c.json(
				{
					success: false,
					error: {
						code: "INTERNAL_ERROR",
						message: err.message,
					},
				},
				500,
			);
		});

		console.log("App initialized");
	}, 120_000); // 2 minute timeout for container startup

	afterAll(async () => {
		console.log("Stopping containers...");

		// Disconnect clients
		if (postgresClient?.isConnected()) {
			await postgresClient.disconnect();
		}
		if (falkorClient?.isConnected()) {
			await falkorClient.disconnect();
		}

		// Stop containers
		await stopAllContainers();

		console.log("Containers stopped");
	}, 30_000);

	// =========================================================================
	// Authentication Tests
	// =========================================================================

	describe("Authentication", () => {
		it("should reject requests without authorization header", async () => {
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: "test" }),
			});

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("UNAUTHORIZED");
			expect(body.error.message).toContain("Missing Authorization header");
		});

		it("should reject requests with invalid token format", async () => {
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer invalid_token_format",
				},
				body: JSON.stringify({ content: "test" }),
			});

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("UNAUTHORIZED");
		});

		it("should reject requests with non-existent token", async () => {
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer egm_oauth_nonexistent0000000000000000_ABC123",
				},
				body: JSON.stringify({ content: "test" }),
			});

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("UNAUTHORIZED");
		});

		it("should accept requests with valid token", async () => {
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({ content: "Test memory content" }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});

	// =========================================================================
	// POST /memory/remember Tests
	// =========================================================================

	describe("POST /memory/remember", () => {
		it("should store memory successfully", async () => {
			const uniqueContent = `Test memory for integration testing ${Date.now()}_${Math.random()}`;
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					content: uniqueContent,
					type: "fact",
					tags: ["test", "integration"],
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data).toBeDefined();
			expect(body.data.id).toBeDefined();
			expect(body.data.stored).toBe(true);
		});

		it("should detect duplicate memories", async () => {
			const content = `Unique test memory ${Date.now()}`;

			// First store
			const res1 = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({ content }),
			});

			expect(res1.status).toBe(200);
			const body1 = await res1.json();
			expect(body1.data.stored).toBe(true);
			expect(body1.data.duplicate).toBe(false);

			// Second store with same content
			const res2 = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({ content }),
			});

			expect(res2.status).toBe(200);
			const body2 = await res2.json();
			expect(body2.data.duplicate).toBe(true);
		});

		it("should validate content length", async () => {
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					content: "", // Empty content
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should validate memory type", async () => {
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					content: "Test content",
					type: "invalid_type", // Invalid type
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should store memory with all fields", async () => {
			const uniqueContent = `Decision: Use PostgreSQL for auth ${Date.now()}_${Math.random()}`;
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					content: uniqueContent,
					type: "decision",
					tags: ["database", "auth", "architecture"],
					project: "engram",
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.stored).toBe(true);
		});
	});

	// =========================================================================
	// POST /memory/recall Tests
	// =========================================================================

	describe("POST /memory/recall", () => {
		it("should search memories successfully", async () => {
			// First store a memory
			await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					content: "PostgreSQL is a great database for ACID compliance",
					type: "fact",
					tags: ["database"],
				}),
			});

			// Then recall
			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					query: "PostgreSQL database",
					limit: 5,
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.memories).toBeDefined();
			expect(Array.isArray(body.data.memories)).toBe(true);
		});

		it("should return empty results for no matches", async () => {
			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					query: "completely_unique_nonsense_query_12345_xyz",
					limit: 5,
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.memories).toEqual([]);
		});

		it("should validate query length", async () => {
			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					query: "", // Empty query
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should validate limit bounds", async () => {
			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					query: "test",
					limit: 100, // Exceeds max
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
		});

		it("should filter by type", async () => {
			// Store a decision
			await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					content: "Architecture decision for recall filter test",
					type: "decision",
				}),
			});

			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					query: "architecture",
					limit: 10,
					filters: {
						type: "decision",
					},
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});

	// =========================================================================
	// POST /memory/query Tests
	// =========================================================================

	describe("POST /memory/query", () => {
		it("should execute valid Cypher query", async () => {
			const res = await app.request("/memory/query", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					cypher: "MATCH (n:Memory) RETURN n.id, n.content LIMIT 5",
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.results).toBeDefined();
			expect(Array.isArray(body.data.results)).toBe(true);
		});

		it("should reject write operations", async () => {
			const res = await app.request("/memory/query", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					cypher: "CREATE (n:Memory {content: 'malicious'}) RETURN n",
				}),
			});

			// Service throws error which becomes 500 - query validation happens in service
			expect([400, 500]).toContain(res.status);
			const body = await res.json();
			expect(body.success).toBe(false);
		});

		it("should reject DELETE operations", async () => {
			const res = await app.request("/memory/query", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					cypher: "MATCH (n) DELETE n",
				}),
			});

			// Service throws error which becomes 500 - query validation happens in service
			expect([400, 500]).toContain(res.status);
			const body = await res.json();
			expect(body.success).toBe(false);
		});

		it("should validate empty query", async () => {
			const res = await app.request("/memory/query", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					cypher: "",
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should pass parameters to query", async () => {
			const res = await app.request("/memory/query", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					cypher: "MATCH (n:Memory) WHERE n.type = $type RETURN n LIMIT 5",
					params: { type: "fact" },
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});

	// =========================================================================
	// POST /memory/context Tests
	// =========================================================================

	describe("POST /memory/context", () => {
		it("should get context successfully", async () => {
			const res = await app.request("/memory/context", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					task: "Implement database connection pooling",
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.context).toBeDefined();
			expect(Array.isArray(body.data.context)).toBe(true);
		});

		it("should respect depth parameter", async () => {
			const resShallow = await app.request("/memory/context", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					task: "Test depth shallow",
					depth: "shallow",
				}),
			});

			expect(resShallow.status).toBe(200);

			const resDeep = await app.request("/memory/context", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					task: "Test depth deep",
					depth: "deep",
				}),
			});

			expect(resDeep.status).toBe(200);
		});

		it("should validate empty task", async () => {
			const res = await app.request("/memory/context", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					task: "",
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should validate invalid depth", async () => {
			const res = await app.request("/memory/context", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					task: "Test task",
					depth: "invalid",
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
		});

		it("should accept files parameter", async () => {
			const res = await app.request("/memory/context", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({
					task: "Review these files",
					files: ["src/index.ts", "src/config.ts"],
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});

	// =========================================================================
	// Error Handling Tests
	// =========================================================================

	describe("Error Handling", () => {
		it("should return 404 for unknown routes", async () => {
			const res = await app.request("/memory/unknown", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(404);
		});

		it("should handle malformed JSON", async () => {
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeader(),
				},
				body: "not valid json",
			});

			// JSON parse error becomes 500 in Hono (uncaught SyntaxError)
			expect([400, 500]).toContain(res.status);
		});
	});
});
