import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createStdioTransport, type StdioTransportOptions } from "./stdio";

// Mock MCP SDK's StdioServerTransport
const mockClose = mock(() => Promise.resolve());
const mockStdioTransport = {
	close: mockClose,
};

mock.module("@modelcontextprotocol/sdk/server/stdio.js", () => ({
	StdioServerTransport: class {
		close = mockClose;
	},
}));

describe("createStdioTransport", () => {
	let mockLogger: { info: ReturnType<typeof mock>; debug: ReturnType<typeof mock> };
	let mockMcpServer: { connect: ReturnType<typeof mock> };

	beforeEach(() => {
		mockClose.mockClear();

		mockLogger = {
			info: mock(() => {}),
			debug: mock(() => {}),
		};

		mockMcpServer = {
			connect: mock(() => Promise.resolve()),
		};
	});

	it("should create a stdio transport with transport object", async () => {
		const options: StdioTransportOptions = {
			mcpServer: mockMcpServer as any,
			logger: mockLogger as any,
		};

		const result = await createStdioTransport(options);

		expect(result.transport).toBeDefined();
		expect(typeof result.start).toBe("function");
		expect(typeof result.stop).toBe("function");
	});

	describe("start", () => {
		it("should connect MCP server to transport and log", async () => {
			const options: StdioTransportOptions = {
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
			};

			const result = await createStdioTransport(options);
			await result.start();

			expect(mockMcpServer.connect).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith("Stdio transport connected");
		});
	});

	describe("stop", () => {
		it("should close transport and log", async () => {
			const options: StdioTransportOptions = {
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
			};

			const result = await createStdioTransport(options);
			await result.stop();

			expect(mockClose).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith("Stdio transport closed");
		});
	});
});
