import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchClient } from "../clients/index.js";
import { type Tool, ToolRegistry } from "./registry.js";

// Mock search client
const createMockSearchClient = (): SearchClient => {
	const mockEmbeddings = new Map<string, number[]>();

	// Pre-computed embeddings for deterministic testing
	// Simulating embeddings where similar concepts are closer in vector space
	mockEmbeddings.set("Read a file from the virtual file system", [1.0, 0.5, 0.2, 0.1, 0.0, 0.0]);
	mockEmbeddings.set("Execute a script in the sandbox", [0.1, 1.0, 0.3, 0.5, 0.2, 0.0]);
	mockEmbeddings.set(
		"Search for information in the knowledge graph",
		[0.0, 0.2, 1.0, 0.8, 0.6, 0.4],
	);
	mockEmbeddings.set("I need to read a file", [0.9, 0.4, 0.1, 0.0, 0.0, 0.0]); // Similar to read_file
	mockEmbeddings.set("search the memory", [0.0, 0.1, 0.9, 0.7, 0.5, 0.3]); // Similar to search_memory

	return {
		search: vi.fn(),
		embed: vi.fn((options) => {
			const embedding = mockEmbeddings.get(options.text) || [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
			return Promise.resolve({
				embedding,
				dimensions: embedding.length,
				embedder_type: "text",
				took_ms: 10,
			});
		}),
		health: vi.fn(),
	} as unknown as SearchClient;
};

describe("ToolRegistry", () => {
	let registry: ToolRegistry;
	let mockSearchClient: SearchClient;

	const testTools: Tool[] = [
		{
			name: "read_file",
			description: "Read a file from the virtual file system",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
				},
				required: ["path"],
			},
		},
		{
			name: "execute_tool",
			description: "Execute a script in the sandbox",
			parameters: {
				type: "object",
				properties: {
					tool_name: { type: "string" },
					args_json: { type: "string" },
				},
				required: ["tool_name", "args_json"],
			},
		},
		{
			name: "search_memory",
			description: "Search for information in the knowledge graph",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string" },
				},
				required: ["query"],
			},
		},
	];

	beforeEach(() => {
		vi.clearAllMocks();
		mockSearchClient = createMockSearchClient();
		registry = new ToolRegistry(mockSearchClient);

		// Register test tools
		for (const tool of testTools) {
			registry.register(tool);
		}
	});

	describe("register", () => {
		it("should register a tool", () => {
			const newTool: Tool = {
				name: "new_tool",
				description: "A new tool",
				parameters: {},
			};

			registry.register(newTool);

			expect(registry.get("new_tool")).toEqual(newTool);
		});

		it("should invalidate cache when registering a tool", async () => {
			// First call to populate cache
			await registry.selectTools("I need to read a file", 1);

			// Register new version of tool
			const updatedTool: Tool = {
				name: "read_file",
				description: "Updated description",
				parameters: {},
			};
			registry.register(updatedTool);

			// Second call should use new embedding (not cached)
			await registry.selectTools("I need to read a file", 1);

			// Embed should be called 6 times total:
			// 1. Query embedding (first selectTools)
			// 2-4. Tool embeddings (first selectTools - 3 tools)
			// 5. Query embedding (second selectTools)
			// 6. read_file embedding (second selectTools - only this one cache invalidated, other 2 cached)
			expect(mockSearchClient.embed).toHaveBeenCalledTimes(6);
		});
	});

	describe("get", () => {
		it("should retrieve a registered tool", () => {
			expect(registry.get("read_file")).toEqual(testTools[0]);
		});

		it("should return undefined for non-existent tool", () => {
			expect(registry.get("nonexistent")).toBeUndefined();
		});
	});

	describe("list", () => {
		it("should return all registered tools", () => {
			const tools = registry.list();

			expect(tools).toHaveLength(3);
			expect(tools.map((t) => t.name)).toEqual(["read_file", "execute_tool", "search_memory"]);
		});
	});

	describe("selectTools", () => {
		it("should return empty array when no tools registered", async () => {
			const emptyRegistry = new ToolRegistry(mockSearchClient);
			const selected = await emptyRegistry.selectTools("test query");

			expect(selected).toEqual([]);
		});

		it("should return all tools when fewer than topK", async () => {
			const selected = await registry.selectTools("test query", 5);

			expect(selected).toHaveLength(3);
		});

		it("should select most semantically similar tools", async () => {
			const selected = await registry.selectTools("I need to read a file", 1);

			// Should select read_file as most similar
			expect(selected).toHaveLength(1);
			expect(selected[0].name).toBe("read_file");
		});

		it("should select correct tool for search query", async () => {
			const selected = await registry.selectTools("search the memory", 1);

			// Should select search_memory as most similar
			expect(selected).toHaveLength(1);
			expect(selected[0].name).toBe("search_memory");
		});

		it("should return top K tools sorted by relevance", async () => {
			const selected = await registry.selectTools("I need to read a file", 2);

			expect(selected).toHaveLength(2);
			// First should be read_file (most similar)
			expect(selected[0].name).toBe("read_file");
		});

		it("should cache tool embeddings", async () => {
			// First call
			await registry.selectTools("test query", 2);

			// Clear mock call count
			vi.clearAllMocks();

			// Second call with different query
			await registry.selectTools("another query", 2);

			// Should only call embed for the query, not for tools (cached)
			expect(mockSearchClient.embed).toHaveBeenCalledTimes(1);
			expect(mockSearchClient.embed).toHaveBeenCalledWith({
				text: "another query",
				embedder_type: "text",
				is_query: true,
			});
		});

		it("should use default topK of 3", async () => {
			const selected = await registry.selectTools("test query");

			expect(selected).toHaveLength(3); // All tools since we only have 3
		});
	});
});
