import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createMemoryRoutes } from "./memory";

// Mock API key context middleware
const mockApiKeyContext = {
	keyId: "key-123",
	keyPrefix: "engram_live_...",
	keyType: "live" as const,
	scopes: ["memory:read", "memory:write", "query:read"],
	rateLimit: 60,
};

function createApp(memoryService: any) {
	const mockLogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};

	const app = new Hono();

	// Mock auth middleware
	app.use("*", async (c, next) => {
		c.set("apiKey", mockApiKeyContext);
		await next();
	});

	app.route("/memory", createMemoryRoutes({ memoryService, logger: mockLogger as any }));

	return app;
}

describe("Memory Routes", () => {
	describe("POST /memory/remember", () => {
		it("should store memory successfully", async () => {
			const mockMemoryService = {
				remember: vi.fn().mockResolvedValue({
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
			expect(mockMemoryService.remember).toHaveBeenCalledWith({
				content: "This is a test memory",
				type: "fact",
				tags: ["test"],
			});
		});

		it("should return 400 for invalid request body", async () => {
			const mockMemoryService = { remember: vi.fn() };
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
			const mockMemoryService = { remember: vi.fn() };
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
				remember: vi.fn().mockResolvedValue({ id: "m1", stored: true, duplicate: false }),
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
				recall: vi
					.fn()
					.mockResolvedValue([
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
			expect(mockMemoryService.recall).toHaveBeenCalledWith("test query", 5, undefined);
		});

		it("should pass filters to recall", async () => {
			const mockMemoryService = {
				recall: vi.fn().mockResolvedValue([]),
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

			expect(mockMemoryService.recall).toHaveBeenCalledWith("test", 10, {
				type: "decision",
				project: "my-project",
			});
		});

		it("should return 400 for empty query", async () => {
			const mockMemoryService = { recall: vi.fn() };
			const app = createApp(mockMemoryService);

			const res = await app.request("/memory/recall", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "" }),
			});

			expect(res.status).toBe(400);
		});

		it("should enforce limit bounds", async () => {
			const mockMemoryService = { recall: vi.fn() };
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
				query: vi.fn().mockResolvedValue([{ id: "node-1" }]),
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
			);
		});

		it("should pass params to query", async () => {
			const mockMemoryService = {
				query: vi.fn().mockResolvedValue([]),
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

			expect(mockMemoryService.query).toHaveBeenCalledWith("MATCH (n:Memory {id: $id}) RETURN n", {
				id: "memory-123",
			});
		});

		it("should return 400 for empty query", async () => {
			const mockMemoryService = { query: vi.fn() };
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
				getContext: vi
					.fn()
					.mockResolvedValue([
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
			);
		});

		it("should pass depth parameter", async () => {
			const mockMemoryService = {
				getContext: vi.fn().mockResolvedValue([]),
			};

			const app = createApp(mockMemoryService);
			await app.request("/memory/context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: "Task", depth: "deep" }),
			});

			expect(mockMemoryService.getContext).toHaveBeenCalledWith("Task", undefined, "deep");
		});

		it("should return 400 for invalid depth", async () => {
			const mockMemoryService = { getContext: vi.fn() };
			const app = createApp(mockMemoryService);

			const res = await app.request("/memory/context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ task: "Task", depth: "invalid" }),
			});

			expect(res.status).toBe(400);
		});
	});
});
