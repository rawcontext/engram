import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorNode, GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { FalkorTurnRepository } from "./falkor-turn.repository";
import type { Turn } from "./types";

describe("FalkorTurnRepository", () => {
	let mockClient: GraphClient;
	let repository: FalkorTurnRepository;
	const mockNow = 1640000000000;

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new FalkorTurnRepository(mockClient);
	});

	describe("findById", () => {
		it("should return turn when found", async () => {
			const turnId = "turn-123";
			const sessionId = "session-456";
			const turnProps = {
				id: turnId,
				user_content: "Hello",
				user_content_hash: "hash123",
				assistant_preview: "Hi there",
				sequence_index: 0,
				files_touched: [],
				tool_calls_count: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ t: { properties: turnProps } as FalkorNode, sessionId },
			]);

			const result = await repository.findById(turnId);

			expect(result).not.toBeNull();
			expect(result?.id).toBe(turnId);
			expect(result?.sessionId).toBe(sessionId);
			expect(result?.userContent).toBe("Hello");
			expect(result?.assistantPreview).toBe("Hi there");
		});

		it("should return null when turn not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findById("nonexistent");

			expect(result).toBeNull();
		});

		it("should query with HAS_TURN edge", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findById("turn-123");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("(s:Session)-[:HAS_TURN]->(t:Turn {id: $id})");
		});
	});

	describe("findBySession", () => {
		it("should return all turns for a session ordered by sequence_index", async () => {
			const sessionId = "session-123";
			const turns = [
				{
					id: "turn-1",
					user_content: "First",
					user_content_hash: "hash1",
					assistant_preview: "First response",
					sequence_index: 0,
					files_touched: [],
					tool_calls_count: 0,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
				{
					id: "turn-2",
					user_content: "Second",
					user_content_hash: "hash2",
					assistant_preview: "Second response",
					sequence_index: 1,
					files_touched: [],
					tool_calls_count: 0,
					vt_start: mockNow + 1000,
					vt_end: MAX_DATE,
					tt_start: mockNow + 1000,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				turns.map((t) => ({ t: { properties: t } as FalkorNode })),
			);

			const result = await repository.findBySession(sessionId);

			expect(result).toHaveLength(2);
			expect(result[0].sequenceIndex).toBe(0);
			expect(result[1].sequenceIndex).toBe(1);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY t.sequence_index ASC");
		});

		it("should return empty array when session has no turns", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findBySession("empty-session");

			expect(result).toEqual([]);
		});
	});

	describe("findByTimeRange", () => {
		it("should return turns within time range", async () => {
			const sessionId = "session-123";
			const start = new Date(mockNow);
			const end = new Date(mockNow + 5000);

			const turnProps = {
				id: "turn-1",
				user_content: "Hello",
				user_content_hash: "hash1",
				assistant_preview: "Hi",
				sequence_index: 0,
				files_touched: [],
				tool_calls_count: 0,
				vt_start: mockNow + 1000,
				vt_end: MAX_DATE,
				tt_start: mockNow + 1000,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ t: { properties: turnProps } as FalkorNode },
			]);

			const result = await repository.findByTimeRange(sessionId, start, end);

			expect(result).toHaveLength(1);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("t.vt_start >= $startTime");
			expect(query).toContain("t.vt_start < $endTime");
			expect(params.startTime).toBe(start.getTime());
			expect(params.endTime).toBe(end.getTime());
		});
	});

	describe("findLatest", () => {
		it("should return latest turns in chronological order", async () => {
			const sessionId = "session-123";
			const turns = [
				{
					id: "turn-10",
					user_content: "Latest",
					user_content_hash: "hash10",
					assistant_preview: "Response",
					sequence_index: 9,
					files_touched: [],
					tool_calls_count: 0,
					vt_start: mockNow + 9000,
					vt_end: MAX_DATE,
					tt_start: mockNow + 9000,
					tt_end: MAX_DATE,
				},
				{
					id: "turn-9",
					user_content: "Second latest",
					user_content_hash: "hash9",
					assistant_preview: "Response",
					sequence_index: 8,
					files_touched: [],
					tool_calls_count: 0,
					vt_start: mockNow + 8000,
					vt_end: MAX_DATE,
					tt_start: mockNow + 8000,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				turns.map((t) => ({ t: { properties: t } as FalkorNode })),
			);

			const result = await repository.findLatest(sessionId, 2);

			// Should be reversed to chronological order
			expect(result).toHaveLength(2);
			expect(result[0].sequenceIndex).toBe(8);
			expect(result[1].sequenceIndex).toBe(9);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY t.sequence_index DESC");
			expect(query).toContain("LIMIT $limit");
			expect(params.limit).toBe(2);
		});

		it("should use default limit of 10", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findLatest("session-123");

			const [, params] = (mockClient.query as any).mock.calls[0];
			expect(params.limit).toBe(10);
		});
	});

	describe("findByFilePath", () => {
		it("should find turns that touched a specific file", async () => {
			const sessionId = "session-123";
			const filePath = "/src/index.ts";

			const turnProps = {
				id: "turn-1",
				user_content: "Edit index.ts",
				user_content_hash: "hash1",
				assistant_preview: "Done",
				sequence_index: 0,
				files_touched: [filePath, "/src/utils.ts"],
				tool_calls_count: 1,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ t: { properties: turnProps } as FalkorNode },
			]);

			const result = await repository.findByFilePath(sessionId, filePath);

			expect(result).toHaveLength(1);
			expect(result[0].filesTouched).toContain(filePath);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("$filePath IN t.files_touched");
			expect(params.filePath).toBe(filePath);
		});
	});

	describe("create", () => {
		it("should create turn with required fields", async () => {
			const input = {
				sessionId: "session-123",
				userContent: "Hello",
				userContentHash: "hash123",
				assistantPreview: "Hi there",
				sequenceIndex: 0,
			};

			spyOn(mockClient, "query")
				// Create turn and link to session
				.mockResolvedValueOnce([]);

			const result = await repository.create(input);

			expect(result.sessionId).toBe(input.sessionId);
			expect(result.userContent).toBe(input.userContent);
			expect(result.assistantPreview).toBe(input.assistantPreview);
			expect(result.sequenceIndex).toBe(0);
			expect(result.filesTouched).toEqual([]);
			expect(result.toolCallsCount).toBe(0);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (s:Session {id: $sessionId})");
			expect(query).toContain("CREATE (t:Turn");
			expect(query).toContain("CREATE (s)-[:HAS_TURN");
		});

		it("should create turn with all optional fields", async () => {
			const input = {
				sessionId: "session-123",
				userContent: "Hello",
				userContentHash: "hash123",
				assistantPreview: "Hi there",
				sequenceIndex: 5,
				assistantBlobRef: "blob-ref-123",
				embedding: [0.1, 0.2, 0.3],
				filesTouched: ["/src/index.ts"],
				toolCallsCount: 2,
				inputTokens: 100,
				outputTokens: 200,
				cacheReadTokens: 50,
				cacheWriteTokens: 25,
				reasoningTokens: 150,
				costUsd: 0.05,
				durationMs: 1500,
				gitCommit: "abc123",
			};

			spyOn(mockClient, "query")
				// Create turn
				.mockResolvedValueOnce([])
				// Link to previous turn
				.mockResolvedValueOnce([]);

			const result = await repository.create(input);

			expect(result.assistantBlobRef).toBe(input.assistantBlobRef);
			expect(result.embedding).toEqual(input.embedding);
			expect(result.filesTouched).toEqual(input.filesTouched);
			expect(result.toolCallsCount).toBe(input.toolCallsCount);
			expect(result.inputTokens).toBe(input.inputTokens);
			expect(result.outputTokens).toBe(input.outputTokens);
			expect(result.cacheReadTokens).toBe(input.cacheReadTokens);
			expect(result.cacheWriteTokens).toBe(input.cacheWriteTokens);
			expect(result.reasoningTokens).toBe(input.reasoningTokens);
			expect(result.costUsd).toBe(input.costUsd);
			expect(result.durationMs).toBe(input.durationMs);
			expect(result.gitCommit).toBe(input.gitCommit);
		});

		it("should link to previous turn when sequenceIndex > 0", async () => {
			const input = {
				sessionId: "session-123",
				userContent: "Second message",
				userContentHash: "hash456",
				assistantPreview: "Response",
				sequenceIndex: 1,
			};

			spyOn(mockClient, "query")
				// Create turn
				.mockResolvedValueOnce([])
				// Link to previous turn
				.mockResolvedValueOnce([]);

			await repository.create(input);

			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(2);

			const [linkQuery, linkParams] = calls[1];
			expect(linkQuery).toContain("(prev:Turn {sequence_index: $prevIndex})");
			expect(linkQuery).toContain("CREATE (prev)-[:NEXT");
			expect(linkParams.prevIndex).toBe(0);
		});

		it("should not link to previous turn when sequenceIndex is 0", async () => {
			const input = {
				sessionId: "session-123",
				userContent: "First message",
				userContentHash: "hash123",
				assistantPreview: "Response",
				sequenceIndex: 0,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.create(input);

			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(1); // Only create, no link
		});
	});

	describe("update", () => {
		it("should update turn with bitemporal versioning", async () => {
			const existingTurn: Turn = {
				id: "turn-123",
				sessionId: "session-456",
				userContent: "Hello",
				userContentHash: "hash123",
				assistantPreview: "Hi",
				sequenceIndex: 0,
				filesTouched: [],
				toolCallsCount: 0,
				vtStart: mockNow - 1000,
				vtEnd: MAX_DATE,
				ttStart: mockNow - 1000,
				ttEnd: MAX_DATE,
			};

			const updates = {
				assistantPreview: "Updated response",
				toolCallsCount: 1,
			};

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([
					{
						t: {
							properties: {
								id: existingTurn.id,
								user_content: existingTurn.userContent,
								user_content_hash: existingTurn.userContentHash,
								assistant_preview: existingTurn.assistantPreview,
								sequence_index: existingTurn.sequenceIndex,
								files_touched: existingTurn.filesTouched,
								tool_calls_count: existingTurn.toolCallsCount,
								vt_start: existingTurn.vtStart,
								vt_end: existingTurn.vtEnd,
								tt_start: existingTurn.ttStart,
								tt_end: existingTurn.ttEnd,
							},
						} as FalkorNode,
						sessionId: existingTurn.sessionId,
					},
				])
				// close old version
				.mockResolvedValueOnce([{ count: 1 }])
				// create new version
				.mockResolvedValueOnce([])
				// link REPLACES edge
				.mockResolvedValueOnce([])
				// check for next turn (none)
				.mockResolvedValueOnce([]);

			const result = await repository.update(existingTurn.id, updates);

			expect(result.assistantPreview).toBe(updates.assistantPreview);
			expect(result.toolCallsCount).toBe(updates.toolCallsCount);
			expect(result.userContent).toBe(existingTurn.userContent);
		});

		it("should return existing turn when no updates provided", async () => {
			const existingTurn = {
				id: "turn-123",
				user_content: "Hello",
				user_content_hash: "hash123",
				assistant_preview: "Hi",
				sequence_index: 0,
				files_touched: [],
				tool_calls_count: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ t: { properties: existingTurn } as FalkorNode, sessionId: "session-123" },
			]);

			const result = await repository.update("turn-123", {});

			expect(result.id).toBe("turn-123");
			// Should only have 1 call (findById), no update
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(1);
		});

		it("should throw error if turn not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.update("nonexistent", { assistantPreview: "New" })).rejects.toThrow(
				"Turn not found: nonexistent",
			);
		});

		it("should retry on concurrent modification", async () => {
			const existingTurn = {
				id: "turn-123",
				user_content: "Hello",
				user_content_hash: "hash123",
				assistant_preview: "Hi",
				sequence_index: 0,
				files_touched: [],
				tool_calls_count: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query")
				// First attempt - findById
				.mockResolvedValueOnce([
					{ t: { properties: existingTurn } as FalkorNode, sessionId: "session-123" },
				])
				// First attempt - close fails
				.mockResolvedValueOnce([{ count: 0 }])
				// Second attempt - findById
				.mockResolvedValueOnce([
					{ t: { properties: existingTurn } as FalkorNode, sessionId: "session-123" },
				])
				// Second attempt - close succeeds
				.mockResolvedValueOnce([{ count: 1 }])
				// create new version
				.mockResolvedValueOnce([])
				// link REPLACES edge
				.mockResolvedValueOnce([])
				// check for next turn
				.mockResolvedValueOnce([]);

			const result = await repository.update("turn-123", { assistantPreview: "Updated" });

			expect(result.assistantPreview).toBe("Updated");
		});

		it("should re-establish NEXT edges after update", async () => {
			const existingTurn = {
				id: "turn-123",
				user_content: "Hello",
				user_content_hash: "hash123",
				assistant_preview: "Hi",
				sequence_index: 1, // Not first turn
				files_touched: [],
				tool_calls_count: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([
					{ t: { properties: existingTurn } as FalkorNode, sessionId: "session-123" },
				])
				// close old version
				.mockResolvedValueOnce([{ count: 1 }])
				// create new version
				.mockResolvedValueOnce([])
				// link REPLACES edge
				.mockResolvedValueOnce([])
				// link from previous turn
				.mockResolvedValueOnce([])
				// check for next turn
				.mockResolvedValueOnce([{ nextId: "turn-456" }])
				// link to next turn
				.mockResolvedValueOnce([]);

			await repository.update("turn-123", { assistantPreview: "Updated" });

			const calls = (mockClient.query as any).mock.calls;
			// Should have linked to both previous and next turns
			expect(calls.length).toBe(7);
		});
	});

	describe("count", () => {
		it("should return count of turns in session", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 5 }]);

			const result = await repository.count("session-123");

			expect(result).toBe(5);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("count(t) as cnt");
			expect(params.sessionId).toBe("session-123");
		});

		it("should return 0 when session has no turns", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 0 }]);

			const result = await repository.count("empty-session");

			expect(result).toBe(0);
		});

		it("should return 0 when query returns empty", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.count("nonexistent");

			expect(result).toBe(0);
		});
	});

	describe("mapToTurn", () => {
		it("should correctly map all fields", async () => {
			const turnProps = {
				id: "turn-123",
				user_content: "Hello",
				user_content_hash: "hash123",
				assistant_preview: "Hi",
				assistant_blob_ref: "blob-ref",
				embedding: [0.1, 0.2],
				sequence_index: 5,
				files_touched: ["/src/index.ts"],
				tool_calls_count: 2,
				input_tokens: 100,
				output_tokens: 200,
				cache_read_tokens: 50,
				cache_write_tokens: 25,
				reasoning_tokens: 150,
				cost_usd: 0.05,
				duration_ms: 1500,
				git_commit: "abc123",
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ t: { properties: turnProps } as FalkorNode, sessionId: "session-456" },
			]);

			const result = await repository.findById("turn-123");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("turn-123");
			expect(result?.sessionId).toBe("session-456");
			expect(result?.userContent).toBe("Hello");
			expect(result?.userContentHash).toBe("hash123");
			expect(result?.assistantPreview).toBe("Hi");
			expect(result?.assistantBlobRef).toBe("blob-ref");
			expect(result?.embedding).toEqual([0.1, 0.2]);
			expect(result?.sequenceIndex).toBe(5);
			expect(result?.filesTouched).toEqual(["/src/index.ts"]);
			expect(result?.toolCallsCount).toBe(2);
			expect(result?.inputTokens).toBe(100);
			expect(result?.outputTokens).toBe(200);
			expect(result?.cacheReadTokens).toBe(50);
			expect(result?.cacheWriteTokens).toBe(25);
			expect(result?.reasoningTokens).toBe(150);
			expect(result?.costUsd).toBe(0.05);
			expect(result?.durationMs).toBe(1500);
			expect(result?.gitCommit).toBe("abc123");
			expect(result?.vtStart).toBe(mockNow);
			expect(result?.vtEnd).toBe(MAX_DATE);
		});

		it("should handle missing optional fields", async () => {
			const turnProps = {
				id: "turn-123",
				user_content: "Hello",
				user_content_hash: "hash123",
				assistant_preview: "Hi",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ t: { properties: turnProps } as FalkorNode, sessionId: "session-456" },
			]);

			const result = await repository.findById("turn-123");

			expect(result).not.toBeNull();
			expect(result?.filesTouched).toEqual([]);
			expect(result?.toolCallsCount).toBe(0);
			expect(result?.assistantBlobRef).toBeUndefined();
			expect(result?.embedding).toBeUndefined();
		});
	});
});
