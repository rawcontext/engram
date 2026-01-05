import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IEngramClient } from "../services/interfaces";
import { registerMemoryResource } from "./memory";

describe("registerMemoryResource", () => {
	let mockServer: McpServer;
	let mockClient: IEngramClient;
	let registeredReadHandler: (uri: URL, params: Record<string, unknown>) => Promise<unknown>;
	let resourceTemplate: { listCallback: () => Promise<{ resources: unknown[] }> };

	beforeEach(() => {
		mockServer = {
			registerResource: mock((_name, template, _options, handler) => {
				resourceTemplate = template;
				registeredReadHandler = handler;
			}),
		} as unknown as McpServer;

		mockClient = {
			query: mock(async () => []),
		} as unknown as IEngramClient;
	});

	describe("registration", () => {
		it("should register the memory resource with correct name", () => {
			registerMemoryResource(mockServer, mockClient);

			expect(mockServer.registerResource).toHaveBeenCalledWith(
				"memory",
				expect.any(Object), // ResourceTemplate
				expect.objectContaining({
					title: "Memory",
					description: expect.stringContaining("stored memories"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("read handler", () => {
		beforeEach(() => {
			registerMemoryResource(mockServer, mockClient);
		});

		it("should query for specific memory by ID", async () => {
			spyOn(mockClient, "query").mockResolvedValue([
				{
					m: {
						properties: {
							id: "mem-123",
							content: "Memory content",
							type: "decision",
							tags: ["auth"],
							source: "user",
							project: "engram",
							vt_start: 1704067200000,
						},
					},
				},
			]);

			const uri = new URL("memory://mem-123");
			await registeredReadHandler(uri, { id: "mem-123" });

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("Memory {id: $id}"),
				expect.objectContaining({ id: "mem-123" }),
			);
		});

		it("should return memory content as JSON", async () => {
			spyOn(mockClient, "query").mockResolvedValue([
				{
					m: {
						properties: {
							id: "mem-123",
							content: "Memory content",
							type: "decision",
							tags: ["auth", "security"],
							source: "user",
							project: "engram",
							vt_start: 1704067200000,
						},
					},
				},
			]);

			const uri = new URL("memory://mem-123");
			const result = (await registeredReadHandler(uri, { id: "mem-123" })) as any;

			expect(result.contents).toHaveLength(1);
			expect(result.contents[0].mimeType).toBe("application/json");

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.id).toBe("mem-123");
			expect(parsed.content).toBe("Memory content");
			expect(parsed.type).toBe("decision");
			expect(parsed.tags).toEqual(["auth", "security"]);
		});

		it("should return error when memory not found", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);

			const uri = new URL("memory://nonexistent");
			const result = (await registeredReadHandler(uri, { id: "nonexistent" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.error).toContain("Memory not found");
		});

		it("should handle null query result", async () => {
			spyOn(mockClient, "query").mockResolvedValue(null as any);

			const uri = new URL("memory://mem-123");
			const result = (await registeredReadHandler(uri, { id: "mem-123" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.error).toContain("Memory not found");
		});

		it("should format creation date as ISO string", async () => {
			const timestamp = 1704067200000; // 2024-01-01
			spyOn(mockClient, "query").mockResolvedValue([
				{
					m: {
						properties: {
							id: "mem-123",
							content: "Memory content",
							type: "fact",
							tags: [],
							source: "user",
							project: null,
							vt_start: timestamp,
						},
					},
				},
			]);

			const uri = new URL("memory://mem-123");
			const result = (await registeredReadHandler(uri, { id: "mem-123" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.created_at).toBe(new Date(timestamp).toISOString());
		});
	});

	describe("list handler", () => {
		beforeEach(() => {
			registerMemoryResource(mockServer, mockClient);
		});

		it("should query for all memories", async () => {
			spyOn(mockClient, "query").mockResolvedValue([
				{
					m: {
						properties: {
							id: "mem-1",
							content: "First memory content",
							type: "decision",
							vt_start: 1704067200000,
						},
					},
				},
				{
					m: {
						properties: {
							id: "mem-2",
							content:
								"Second memory content that is longer than 100 characters to test truncation behavior in the preview generation logic",
							type: "insight",
							vt_start: 1704153600000,
						},
					},
				},
			]);

			const result = await resourceTemplate.listCallback();

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("MATCH (m:Memory)"),
				expect.objectContaining({ now: expect.any(Number), limit: 100 }),
			);
			expect(result.resources).toHaveLength(2);
		});

		it("should format memory resources with uri, name, and description", async () => {
			const timestamp = 1704067200000;
			spyOn(mockClient, "query").mockResolvedValue([
				{
					m: {
						properties: {
							id: "mem-123",
							content: "Memory content here",
							type: "decision",
							vt_start: timestamp,
						},
					},
				},
			]);

			const result = await resourceTemplate.listCallback();

			expect(result.resources[0]).toEqual({
				uri: "memory://mem-123",
				name: "decision: Memory content here",
				description: `Memory created ${new Date(timestamp).toISOString()}`,
			});
		});

		it("should truncate long content in preview", async () => {
			const longContent = "A".repeat(150);
			spyOn(mockClient, "query").mockResolvedValue([
				{
					m: {
						properties: {
							id: "mem-long",
							content: longContent,
							type: "insight",
							vt_start: 1704067200000,
						},
					},
				},
			]);

			const result = await resourceTemplate.listCallback();

			expect((result.resources[0] as any).name).toBe(`insight: ${"A".repeat(100)}...`);
		});

		it("should return empty array when query returns null", async () => {
			spyOn(mockClient, "query").mockResolvedValue(null as any);

			const result = await resourceTemplate.listCallback();

			expect(result.resources).toEqual([]);
		});

		it("should return empty array when no memories exist", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);

			const result = await resourceTemplate.listCallback();

			expect(result.resources).toEqual([]);
		});
	});
});
