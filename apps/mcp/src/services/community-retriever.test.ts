import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Logger } from "@engram/logger";
import { CommunityRetrieverService } from "./community-retriever";
import type { IEngramClient } from "./interfaces";

describe("CommunityRetrieverService", () => {
	let mockClient: IEngramClient;
	let mockLogger: Logger;
	let service: CommunityRetrieverService;
	const searchUrl = "http://localhost:6176";

	beforeEach(() => {
		mockClient = {
			query: mock(async () => []),
		} as unknown as IEngramClient;

		mockLogger = {
			debug: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		} as unknown as Logger;

		service = new CommunityRetrieverService(mockClient, searchUrl, mockLogger);
	});

	describe("search", () => {
		it("should return empty array when no communities exist", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);

			const results = await service.search("test query");

			expect(results).toEqual([]);
		});

		it("should return empty array when no communities have embeddings", async () => {
			spyOn(mockClient, "query").mockResolvedValue([
				{
					c: {
						properties: {
							id: "comm-1",
							name: "Test Community",
							summary: "A test community",
							keywords: [],
							member_count: 3,
							memory_count: 5,
							// No embedding
						},
					},
				},
			]);

			const results = await service.search("test query");

			expect(results).toEqual([]);
		});

		it("should filter communities by similarity threshold", async () => {
			const mockEmbedding = Array(384).fill(0.1);

			spyOn(mockClient, "query").mockResolvedValue([
				{
					c: {
						properties: {
							id: "comm-1",
							name: "High Match",
							summary: "High similarity community",
							keywords: ["test"],
							member_count: 5,
							memory_count: 10,
							embedding: mockEmbedding,
						},
					},
				},
				{
					c: {
						properties: {
							id: "comm-2",
							name: "Low Match",
							summary: "Low similarity community",
							keywords: ["other"],
							member_count: 3,
							memory_count: 5,
							embedding: Array(384).fill(-0.9), // Very different embedding
						},
					},
				},
			]);

			// Mock the embed endpoint
			const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
				json: async () => ({ embedding: mockEmbedding }),
			} as Response);

			const results = await service.search("test query", { threshold: 0.9 });

			// Should only return the high match community
			expect(results.length).toBeLessThanOrEqual(1);

			fetchMock.mockRestore();
		});

		it("should respect limit option", async () => {
			const mockEmbedding = Array(384).fill(0.1);
			const communities = Array(5)
				.fill(null)
				.map((_, i) => ({
					c: {
						properties: {
							id: `comm-${i}`,
							name: `Community ${i}`,
							summary: `Summary ${i}`,
							keywords: ["test"],
							member_count: 3,
							memory_count: 5,
							embedding: mockEmbedding,
						},
					},
				}));

			spyOn(mockClient, "query").mockResolvedValue(communities);

			// Mock the embed endpoint
			const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
				json: async () => ({ embedding: mockEmbedding }),
			} as Response);

			const results = await service.search("test query", { limit: 2, threshold: 0 });

			expect(results.length).toBe(2);

			fetchMock.mockRestore();
		});

		it("should include project filter in graph query", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);

			await service.search("test query", { project: "my-project" });

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("project: $project"),
				expect.objectContaining({ project: "my-project" }),
			);
		});

		it("should handle embed endpoint failure gracefully", async () => {
			const mockEmbedding = Array(384).fill(0.1);

			spyOn(mockClient, "query").mockResolvedValue([
				{
					c: {
						properties: {
							id: "comm-1",
							name: "Test Community",
							summary: "A test community",
							keywords: ["test"],
							member_count: 3,
							memory_count: 5,
							embedding: mockEmbedding,
						},
					},
				},
			]);

			// Mock embed endpoint failure
			const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue({
				ok: false,
				status: 500,
			} as Response);

			const results = await service.search("test query");

			expect(results).toEqual([]);
			expect(mockLogger.warn).toHaveBeenCalled();

			fetchMock.mockRestore();
		});

		it("should handle graph query failure gracefully", async () => {
			spyOn(mockClient, "query").mockRejectedValue(new Error("Graph error"));

			const results = await service.search("test query");

			expect(results).toEqual([]);
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});
});
