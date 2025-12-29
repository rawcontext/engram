import { describe, expect, it } from "bun:test";
import { isHttpTransport, isStdioTransport } from "./index";

// Mock MCP server
function createMockMcpServer() {
	return {
		connect: mock().mockResolvedValue(undefined),
	};
}

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

// Note: Full integration tests for createTransport would require mocking express
// and the MCP SDK, which is complex. The HTTP transport is better tested via
// integration tests that actually start the server.
