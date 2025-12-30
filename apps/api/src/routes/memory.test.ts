import { describe, expect, it, mock } from "bun:test";
import type { TenantContext } from "@engram/common";
import { Hono } from "hono";
import { createMemoryRoutes } from "./memory";

// Mock auth context middleware
const mockAuthContext = {
	id: "token-123",
	prefix: "engram_oauth_...",
	method: "oauth" as const,
	type: "oauth" as const,
	userId: "user-123",
	scopes: ["memory:read", "memory:write", "query:read"],
	rateLimit: 60,
};

// Mock tenant context
const mockTenantContext: TenantContext = {
	orgId: "test-org-123",
	orgSlug: "test-org",
	userId: "user-123",
	isAdmin: false,
};

function createApp(memoryService: any) {
	const mockLogger = {
		debug: mock(),
		info: mock(),
		warn: mock(),
		error: mock(),
	};

	const app = new Hono();

	// Mock auth middleware (sets both auth and tenant contexts)
	app.use("*", async (c, next) => {
		c.set("auth", mockAuthContext);
		c.set("tenant", mockTenantContext);
		await next();
	});

	app.route("/memory", createMemoryRoutes({ memoryService, logger: mockLogger as any }));

	return app;
}

describe("Memory Routes", () => {
	describe("POST /memory/remember", () => {
		it("should store memory successfully", async () => {
			const mockMemoryService = {
				remember: mock().mockResolvedValue({
					id: "memory-123",
					stored: true,
					duplicate: false,
				}),
			};

			const app = createApp(mockMemoryService);
			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content: "This is a test memory",
					type: "fact",
					tags: ["test"],
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.id).toBe("memory-123");
			expect(body.data.stored).toBe(true);
			expect(mockMemoryService.remember).toHaveBeenCalledWith(
				{
					content: "This is a test memory",
					type: "fact",
					tags: ["test"],
				},
				mockTenantContext,
			);
		});

		it("should return 400 for invalid request body", async () => {
			const mockMemoryService = { remember: mock() };
			const app = createApp(mockMemoryService);

			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content: "", // Empty content is invalid
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should return 400 for content exceeding max length", async () => {
			const mockMemoryService = { remember: mock() };
			const app = createApp(mockMemoryService);

			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content: "x".repeat(50001), // Exceeds 50000 limit
				}),
			});

			expect(res.status).toBe(400);
		});

		it("should accept valid memory types", async () => {
			const mockMemoryService = {
				remember: mock().mockResolvedValue({ id: "m1", stored: true, duplicate: false }),
			};
			const app = createApp(mockMemoryService);

			const types = ["decision", "context", "insight", "preference", "fact"];
			for (const type of types) {
				const res = await app.request("/memory/remember", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ content: "test", type }),
				});
				expect(res.status).toBe(200);
			}
		});
	});

	describe("POST /memory/recall", () => {
		it("should search memories successfully", async () => {
			const mockMemoryService = {
				recall: mock().mockResolvedValue([
					{ id: "m1", content: "Test memory", type: "fact", tags: [], score: 0.95 },
				]),
			};

			const app = createApp(mockMemoryService);
			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test query", limit: 5 }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.memories).toHaveLength(1);
			expect(body.data.memories[0].id).toBe("m1");
			expect(mockMemoryService.recall).toHaveBeenCalledWith(
				"test query",
				5,
				undefined,
				{
					rerank: true,
					rerank_tier: "fast",
				},
				mockTenantContext,
			);
		});

		it("should pass filters to recall", async () => {
			const mockMemoryService = {
				recall: mock().mockResolvedValue([]),
			};

			const app = createApp(mockMemoryService);
			await app.request("/memory/recall", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "test",
					limit: 10,
					filters: {
						type: "decision",
						project: "my-project",
					},
				}),
			});

			expect(mockMemoryService.recall).toHaveBeenCalledWith(
				"test",
				10,
				{
					type: "decision",
					project: "my-project",
				},
				{
					rerank: true,
					rerank_tier: "fast",
				},
				mockTenantContext,
			);
		});

		it("should return 400 for empty query", async () => {
			const mockMemoryService = { recall: mock() };
			const app = createApp(mockMemoryService);

			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "" }),
			});

			expect(res.status).toBe(400);
		});

		it("should enforce limit bounds", async () => {
			const mockMemoryService = { recall: mock() };
			const app = createApp(mockMemoryService);

			// Limit too high
			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test", limit: 100 }),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("POST /memory/query", () => {
		it("should execute valid Cypher query", async () => {
			const mockMemoryService = {
				query: mock().mockResolvedValue([{ id: "node-1" }]),
			};

			const app = createApp(mockMemoryService);
			const res = await app.request("/memory/query", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					cypher: "MATCH (n:Memory) RETURN n LIMIT 10",
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.results).toHaveLength(1);
			expect(mockMemoryService.query).toHaveBeenCalledWith(
				"MATCH (n:Memory) RETURN n LIMIT 10",
				undefined,
				mockTenantContext,
			);
		});

		it("should pass params to query", async () => {
			const mockMemoryService = {
				query: mock().mockResolvedValue([]),
			};

			const app = createApp(mockMemoryService);
			await app.request("/memory/query", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					cypher: "MATCH (n:Memory {id: $id}) RETURN n",
					params: { id: "memory-123" },
				}),
			});

			expect(mockMemoryService.query).toHaveBeenCalledWith(
				"MATCH (n:Memory {id: $id}) RETURN n",
				{
					id: "memory-123",
				},
				mockTenantContext,
			);
		});

		it("should return 400 for empty query", async () => {
			const mockMemoryService = { query: mock() };
			const app = createApp(mockMemoryService);

			const res = await app.request("/memory/query", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cypher: "" }),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("POST /memory/context", () => {
		it("should get context successfully", async () => {
			const mockMemoryService = {
				getContext: mock().mockResolvedValue([
					{ type: "memory", content: "Relevant memory", relevance: 0.9, source: "memory:1" },
				]),
			};

			const app = createApp(mockMemoryService);
			const res = await app.request("/memory/context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: "Implement feature X" }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.context).toHaveLength(1);
			expect(mockMemoryService.getContext).toHaveBeenCalledWith(
				"Implement feature X",
				undefined,
				"medium",
				mockTenantContext,
			);
		});

		it("should pass depth parameter", async () => {
			const mockMemoryService = {
				getContext: mock().mockResolvedValue([]),
			};

			const app = createApp(mockMemoryService);
			await app.request("/memory/context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: "Task", depth: "deep" }),
			});

			expect(mockMemoryService.getContext).toHaveBeenCalledWith(
				"Task",
				undefined,
				"deep",
				mockTenantContext,
			);
		});

		it("should return 400 for invalid depth", async () => {
			const mockMemoryService = { getContext: mock() };
			const app = createApp(mockMemoryService);

			const res = await app.request("/memory/context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: "Task", depth: "invalid" }),
			});

			expect(res.status).toBe(400);
		});

		it("should pass files parameter", async () => {
			const mockMemoryService = {
				getContext: mock().mockResolvedValue([]),
			};

			const app = createApp(mockMemoryService);
			await app.request("/memory/context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: "Task", files: ["file1.ts", "file2.ts"] }),
			});

			expect(mockMemoryService.getContext).toHaveBeenCalledWith(
				"Task",
				["file1.ts", "file2.ts"],
				"medium",
				mockTenantContext,
			);
		});

		it("should return 400 for empty task", async () => {
			const mockMemoryService = { getContext: mock() };
			const app = createApp(mockMemoryService);

			const res = await app.request("/memory/context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: "" }),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("Error handling", () => {
		it("should handle service error in remember endpoint", async () => {
			const mockLogger = {
				debug: mock(),
				info: mock(),
				warn: mock(),
				error: mock(),
			};

			const mockMemoryService = {
				remember: mock().mockRejectedValue(new Error("Service error")),
			};

			const app = new Hono();
			app.use("*", async (c, next) => {
				c.set("auth", mockAuthContext);
				c.set("tenant", mockTenantContext);
				await next();
			});
			app.route(
				"/memory",
				createMemoryRoutes({ memoryService: mockMemoryService, logger: mockLogger as any }),
			);

			// Add error handler to catch thrown errors
			app.onError((err, c) => {
				return c.json({ error: err.message }, 500);
			});

			const res = await app.request("/memory/remember", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: "test" }),
			});

			expect(res.status).toBe(500);
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it("should handle service error in recall endpoint", async () => {
			const mockLogger = {
				debug: mock(),
				info: mock(),
				warn: mock(),
				error: mock(),
			};

			const mockMemoryService = {
				recall: mock().mockRejectedValue(new Error("Service error")),
			};

			const app = new Hono();
			app.use("*", async (c, next) => {
				c.set("auth", mockAuthContext);
				c.set("tenant", mockTenantContext);
				await next();
			});
			app.route(
				"/memory",
				createMemoryRoutes({ memoryService: mockMemoryService, logger: mockLogger as any }),
			);

			// Add error handler to catch thrown errors
			app.onError((err, c) => {
				return c.json({ error: err.message }, 500);
			});

			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test" }),
			});

			expect(res.status).toBe(500);
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it("should handle service error in query endpoint", async () => {
			const mockLogger = {
				debug: mock(),
				info: mock(),
				warn: mock(),
				error: mock(),
			};

			const mockMemoryService = {
				query: mock().mockRejectedValue(new Error("Service error")),
			};

			const app = new Hono();
			app.use("*", async (c, next) => {
				c.set("auth", mockAuthContext);
				c.set("tenant", mockTenantContext);
				await next();
			});
			app.route(
				"/memory",
				createMemoryRoutes({ memoryService: mockMemoryService, logger: mockLogger as any }),
			);

			// Add error handler to catch thrown errors
			app.onError((err, c) => {
				return c.json({ error: err.message }, 500);
			});

			const res = await app.request("/memory/query", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cypher: "MATCH (n) RETURN n" }),
			});

			expect(res.status).toBe(500);
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it("should handle service error in context endpoint", async () => {
			const mockLogger = {
				debug: mock(),
				info: mock(),
				warn: mock(),
				error: mock(),
			};

			const mockMemoryService = {
				getContext: mock().mockRejectedValue(new Error("Service error")),
			};

			const app = new Hono();
			app.use("*", async (c, next) => {
				c.set("auth", mockAuthContext);
				c.set("tenant", mockTenantContext);
				await next();
			});
			app.route(
				"/memory",
				createMemoryRoutes({ memoryService: mockMemoryService, logger: mockLogger as any }),
			);

			// Add error handler to catch thrown errors
			app.onError((err, c) => {
				return c.json({ error: err.message }, 500);
			});

			const res = await app.request("/memory/context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: "test task" }),
			});

			expect(res.status).toBe(500);
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});
});
