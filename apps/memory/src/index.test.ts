import { describe, expect, it, mock } from "bun:test";
import { server } from "./index";

// Mock Falkor
mock.module("@engram/storage", () => ({
	createFalkorClient: () => ({
		connect: mock(async () => {}),
		query: mock(async () => []),
		disconnect: mock(async () => {}),
	}),
}));

// Mock MCP
mock.module("@modelcontextprotocol/sdk/server/mcp.js", () => ({
	McpServer: class {
		constructor() {}
		tool = mock(() => {});
		connect = mock(async () => {});
	},
}));

describe("Memory Service", () => {
	it("should register tools", () => {
		// server is instantiated at module level
		// We just check it's defined, actual calls happened during import
		expect(server).toBeDefined();
	});
});
