import { beforeEach, describe, expect, it, mock } from "bun:test";
import { isHttpTransport, isStdioTransport, createTransport } from "./index";
import type { Config } from "../config";

// Mock StdioServerTransport
mock.module("@modelcontextprotocol/sdk/server/stdio.js", () => ({
	StdioServerTransport: class {
		close = mock(() => Promise.resolve());
	},
}));

// Mock Express for HTTP transport
mock.module("express", () => {
	const mockApp = {
		use: mock(() => {}),
		get: mock(() => {}),
		post: mock(() => {}),
		delete: mock(() => {}),
		listen: mock((port: number, cb: () => void) => {
			cb();
			return { close: mock((cb: () => void) => cb()) };
		}),
	};
	const express = mock(() => mockApp);
	(express as any).default = express;
	(express as any).json = mock(() => mock(() => {}));
	return { default: express };
});

// Mock StreamableHTTPServerTransport
mock.module("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
	StreamableHTTPServerTransport: class {
		sessionId = "test-session";
		close = mock(() => {});
		handleRequest = mock(() => Promise.resolve());
	},
}));

describe("Transport Type Guards", () => {
	describe("isHttpTransport", () => {
		it("should return true for HTTP transport", () => {
			const httpTransport = {
				app: {},
				start: () => Promise.resolve(),
				stop: () => Promise.resolve(),
			};

			expect(isHttpTransport(httpTransport as any)).toBe(true);
		});

		it("should return false for stdio transport", () => {
			const stdioTransport = {
				transport: {},
				start: () => Promise.resolve(),
				stop: () => Promise.resolve(),
			};

			expect(isHttpTransport(stdioTransport as any)).toBe(false);
		});
	});

	describe("isStdioTransport", () => {
		it("should return true for stdio transport", () => {
			const stdioTransport = {
				transport: {},
				start: () => Promise.resolve(),
				stop: () => Promise.resolve(),
			};

			expect(isStdioTransport(stdioTransport as any)).toBe(true);
		});

		it("should return false for HTTP transport", () => {
			const httpTransport = {
				app: {},
				start: () => Promise.resolve(),
				stop: () => Promise.resolve(),
			};

			expect(isStdioTransport(httpTransport as any)).toBe(false);
		});
	});
});

describe("createTransport", () => {
	let mockLogger: { info: ReturnType<typeof mock>; debug: ReturnType<typeof mock> };
	let mockMcpServer: { connect: ReturnType<typeof mock> };

	beforeEach(() => {
		mockLogger = {
			info: mock(() => {}),
			debug: mock(() => {}),
		};

		mockMcpServer = {
			connect: mock(() => Promise.resolve()),
		};
	});

	describe("stdio transport", () => {
		it("should create stdio transport when config.transport is stdio", async () => {
			const config: Partial<Config> = {
				transport: "stdio",
				httpPort: 3010,
				engramApiUrl: "http://localhost:6174",
				observatoryUrl: "http://localhost:6178",
				searchUrl: "http://localhost:6176",
				authEnabled: false,
				entityExtraction: {
					enabled: true,
					resolutionThreshold: 0.9,
					maxEntitiesPerMemory: 10,
					detectRelationships: true,
				},
				graphRetrieval: { enabled: true, maxDepth: 2, graphWeight: 0.3 },
				logLevel: "info",
				sessionTtlSeconds: 3600,
				maxSessionsPerUser: 10,
			};

			const result = await createTransport({
				config: config as Config,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
			});

			expect(isStdioTransport(result)).toBe(true);
			expect(isHttpTransport(result)).toBe(false);
		});
	});

	describe("http transport", () => {
		it("should create HTTP transport when config.transport is http", async () => {
			const config: Partial<Config> = {
				transport: "http",
				httpPort: 3010,
				mcpServerUrl: "http://localhost:3010",
				authServerUrl: "http://localhost:6178",
				engramApiUrl: "http://localhost:6174",
				observatoryUrl: "http://localhost:6178",
				searchUrl: "http://localhost:6176",
				authEnabled: false,
				entityExtraction: {
					enabled: true,
					resolutionThreshold: 0.9,
					maxEntitiesPerMemory: 10,
					detectRelationships: true,
				},
				graphRetrieval: { enabled: true, maxDepth: 2, graphWeight: 0.3 },
				logLevel: "info",
				sessionTtlSeconds: 3600,
				maxSessionsPerUser: 10,
			};

			const result = await createTransport({
				config: config as Config,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
			});

			expect(isHttpTransport(result)).toBe(true);
			expect(isStdioTransport(result)).toBe(false);
		});

		it("should use default server URL when mcpServerUrl not provided", async () => {
			const config: Partial<Config> = {
				transport: "http",
				httpPort: 4000,
				// mcpServerUrl not provided - should use default
				authServerUrl: "http://localhost:6178",
				engramApiUrl: "http://localhost:6174",
				observatoryUrl: "http://localhost:6178",
				searchUrl: "http://localhost:6176",
				authEnabled: true,
				entityExtraction: {
					enabled: true,
					resolutionThreshold: 0.9,
					maxEntitiesPerMemory: 10,
					detectRelationships: true,
				},
				graphRetrieval: { enabled: true, maxDepth: 2, graphWeight: 0.3 },
				logLevel: "info",
				sessionTtlSeconds: 3600,
				maxSessionsPerUser: 10,
			};

			const result = await createTransport({
				config: config as Config,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
			});

			expect(isHttpTransport(result)).toBe(true);
		});
	});
});
