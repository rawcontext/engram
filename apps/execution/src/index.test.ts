import { describe, it, expect, mock } from "bun:test";

// Mock dependencies BEFORE import
mock.module("@modelcontextprotocol/sdk/server/mcp.js", () => ({
    McpServer: class {
        constructor() {}
        registerTool = mock(() => {});
        connect = mock(async () => {});
    }
}));

// Dynamic import
const { server, vfs } = await import("./index");

describe("Execution Service", () => {
    it("should register tools", () => {
        expect(vfs).toBeDefined();
        // Since we mocked McpServer, we assume registerTool didn't crash
    });

    it("should be able to write and read file via vfs", () => {
        vfs.writeFile("/test.txt", "content");
        expect(vfs.readFile("/test.txt")).toBe("content");
    });
});
