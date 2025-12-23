import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { GraphClient } from "@engram/storage";
import { FalkorReasoningRepository } from "./falkor-reasoning.repository";
import { FalkorSessionRepository } from "./falkor-session.repository";
import { FalkorToolCallRepository } from "./falkor-tool-call.repository";
import { FalkorTurnRepository } from "./falkor-turn.repository";

// Mock GraphClient
const createMockGraphClient = () => ({
	connect: mock(async () => {}),
	disconnect: mock(async () => {}),
	query: mock(async () => []),
	isConnected: mock(() => true),
});

describe("FalkorSessionRepository", () => {
	let mockClient: ReturnType<typeof createMockGraphClient>;
	let repository: FalkorSessionRepository;

	beforeEach(() => {
		mockClient = createMockGraphClient();
		repository = new FalkorSessionRepository(mockClient as unknown as GraphClient);
	});

	describe("findById", () => {
		it("should return null when session not found", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.findById("non-existent");

			expect(result).toBeNull();
			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("MATCH (s:Session {id: $id})"),
				{ id: "non-existent" },
			);
		});

		it("should return mapped session when found", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findById("sess-123");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("sess-123");
			expect(result?.userId).toBe("user-1");
			expect(result?.agentType).toBe("claude-code");
		});
	});

	describe("create", () => {
		it("should create a session with required fields", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: expect.any(String),
							user_id: "user-1",
							started_at: expect.any(Number),
							agent_type: "opencode",
							vt_start: expect.any(Number),
							vt_end: 253402300799000,
							tt_start: expect.any(Number),
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.create({
				userId: "user-1",
				agentType: "opencode",
			});

			expect(mockClient.query).toHaveBeenCalled();
			const [query, params] = mockClient.query.mock.calls[0];
			expect(query).toContain("CREATE (s:Session");
			expect(params).toMatchObject({
				user_id: "user-1",
				agent_type: "opencode",
			});
		});

		it("should include optional fields when provided", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: expect.any(String),
							user_id: "user-1",
							external_id: "ext-123",
							title: "Test Session",
							working_dir: "/projects/test",
							started_at: expect.any(Number),
							agent_type: "claude-code",
							vt_start: expect.any(Number),
							vt_end: 253402300799000,
							tt_start: expect.any(Number),
							tt_end: 253402300799000,
						},
					},
				},
			]);

			await repository.create({
				userId: "user-1",
				externalId: "ext-123",
				title: "Test Session",
				workingDir: "/projects/test",
				agentType: "claude-code",
			});

			const [, params] = mockClient.query.mock.calls[0];
			expect(params).toMatchObject({
				external_id: "ext-123",
				title: "Test Session",
				working_dir: "/projects/test",
			});
		});
	});

	describe("delete", () => {
		it("should soft delete by setting tt_end", async () => {
			// First call for findById
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			// Second call for soft delete
			mockClient.query.mockResolvedValueOnce([]);

			await repository.delete("sess-123");

			expect(mockClient.query).toHaveBeenCalledTimes(2);
			const [deleteQuery] = mockClient.query.mock.calls[1];
			expect(deleteQuery).toContain("SET n.tt_end = $t");
		});

		it("should throw when session not found", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			await expect(repository.delete("non-existent")).rejects.toThrow(
				"Session not found: non-existent",
			);
		});
	});

	describe("findByIdAt", () => {
		it("should find session at specific valid time", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findByIdAt("sess-123", { vt: 1700000001000 });

			expect(result).not.toBeNull();
			expect(result?.id).toBe("sess-123");
		});

		it("should return null when session not found at time", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.findByIdAt("sess-123", { tt: "current" });

			expect(result).toBeNull();
		});
	});

	describe("findByUserAt", () => {
		it("should find sessions for user at specific time", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findByUserAt("user-1", { tt: "current" });

			expect(result).toHaveLength(1);
			expect(result[0].userId).toBe("user-1");
		});
	});

	describe("findByExternalId", () => {
		it("should find session by external ID", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							external_id: "ext-456",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findByExternalId("ext-456");

			expect(result).not.toBeNull();
			expect(result?.externalId).toBe("ext-456");
		});
	});

	describe("findActive", () => {
		it("should find all active sessions", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-1",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findActive();

			expect(result).toHaveLength(1);
		});
	});

	describe("findByProvider", () => {
		it("should find sessions by provider", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-1",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findByProvider("claude-code");

			expect(result).toHaveLength(1);
			expect(result[0].agentType).toBe("claude-code");
		});
	});

	describe("findByUser", () => {
		it("should find sessions by user ID", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-1",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findByUser("user-1");

			expect(result).toHaveLength(1);
			expect(result[0].userId).toBe("user-1");
		});
	});

	describe("findByWorkingDir", () => {
		it("should find sessions by working directory", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-1",
							user_id: "user-1",
							working_dir: "/projects/test",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findByWorkingDir("/projects/test");

			expect(result).toHaveLength(1);
			expect(result[0].workingDir).toBe("/projects/test");
		});
	});

	describe("update", () => {
		it("should update session with retry on concurrent modification", async () => {
			// First attempt: findById succeeds
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			// Close old version returns 0 (concurrent modification)
			mockClient.query.mockResolvedValueOnce([{ count: 0 }]);

			// Second attempt: findById succeeds
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			// Close old version succeeds
			mockClient.query.mockResolvedValueOnce([{ count: 1 }]);

			// Create new version
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 2,
						labels: ["Session"],
						properties: {
							id: expect.any(String),
							user_id: "user-1",
							title: "Updated",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: expect.any(Number),
							vt_end: 253402300799000,
							tt_start: expect.any(Number),
							tt_end: 253402300799000,
						},
					},
				},
			]);

			// Link new to old
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.update("sess-123", { title: "Updated" });

			expect(result.title).toBe("Updated");
		});

		it("should throw after max retries on concurrent modification", async () => {
			// All attempts fail due to concurrent modification
			for (let i = 0; i < 3; i++) {
				mockClient.query.mockResolvedValueOnce([
					{
						s: {
							id: 1,
							labels: ["Session"],
							properties: {
								id: "sess-123",
								user_id: "user-1",
								started_at: 1700000000000,
								agent_type: "claude-code",
								vt_start: 1700000000000,
								vt_end: 253402300799000,
								tt_start: 1700000000000,
								tt_end: 253402300799000,
							},
						},
					},
				]);
				mockClient.query.mockResolvedValueOnce([{ count: 0 }]);
			}

			await expect(repository.update("sess-123", { title: "Updated" })).rejects.toThrow(
				/Failed to update session sess-123 after 3 attempts/,
			);
		});

		it("should throw immediately on non-concurrent errors", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			mockClient.query.mockRejectedValueOnce(new Error("Database error"));

			await expect(repository.update("sess-123", { title: "Updated" })).rejects.toThrow(
				"Database error",
			);
		});

		it("should throw when session not found", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			await expect(repository.update("non-existent", { title: "Updated" })).rejects.toThrow(
				"Session not found: non-existent",
			);
		});

		it("should update with metadata", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			mockClient.query.mockResolvedValueOnce([{ count: 1 }]);

			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 2,
						labels: ["Session"],
						properties: {
							id: expect.any(String),
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							metadata: JSON.stringify({ key: "value" }),
							vt_start: expect.any(Number),
							vt_end: 253402300799000,
							tt_start: expect.any(Number),
							tt_end: 253402300799000,
						},
					},
				},
			]);

			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.update("sess-123", { metadata: { key: "value" } });

			expect(result.metadata).toEqual({ key: "value" });
		});
	});

	describe("mapToSession", () => {
		it("should handle invalid JSON metadata gracefully", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							metadata: "invalid-json{",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findById("sess-123");

			// Invalid JSON metadata should be set to undefined (graceful fallback)
			expect(result?.metadata).toBeUndefined();
		});

		it("should throw when node or properties is null", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: null,
					},
				},
			]);

			await expect(repository.findById("sess-123")).rejects.toThrow(
				"Invalid node: node or properties is null/undefined",
			);
		});

		it("should handle missing optional fields", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							user_id: "user-1",
							started_at: 1700000000000,
							agent_type: "claude-code",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findById("sess-123");

			expect(result).not.toBeNull();
			expect(result?.externalId).toBeUndefined();
			expect(result?.title).toBeUndefined();
			expect(result?.provider).toBeUndefined();
			expect(result?.workingDir).toBeUndefined();
			expect(result?.gitRemote).toBeUndefined();
			expect(result?.summary).toBeUndefined();
			expect(result?.embedding).toBeUndefined();
			expect(result?.metadata).toBeUndefined();
		});

		it("should handle session with all optional fields", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: "sess-123",
							external_id: "ext-456",
							title: "Test Session",
							user_id: "user-1",
							provider: "anthropic",
							started_at: 1700000000000,
							working_dir: "/test",
							git_remote: "git@github.com:test/test.git",
							agent_type: "claude-code",
							summary: "Test summary",
							embedding: [0.1, 0.2],
							metadata: JSON.stringify({ key: "value" }),
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findById("sess-123");

			expect(result).not.toBeNull();
			expect(result?.externalId).toBe("ext-456");
			expect(result?.title).toBe("Test Session");
			expect(result?.provider).toBe("anthropic");
			expect(result?.workingDir).toBe("/test");
			expect(result?.gitRemote).toBe("git@github.com:test/test.git");
			expect(result?.summary).toBe("Test summary");
			expect(result?.embedding).toEqual([0.1, 0.2]);
			expect(result?.metadata).toEqual({ key: "value" });
		});
	});

	describe("create with minimal fields", () => {
		it("should create session with only required fields", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					s: {
						id: 1,
						labels: ["Session"],
						properties: {
							id: expect.any(String),
							user_id: "user-1",
							started_at: expect.any(Number),
							agent_type: "unknown",
							vt_start: expect.any(Number),
							vt_end: 253402300799000,
							tt_start: expect.any(Number),
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.create({
				userId: "user-1",
			});

			expect(result.userId).toBe("user-1");
			expect(result.agentType).toBe("unknown");
		});
	});
});

describe("FalkorTurnRepository", () => {
	let mockClient: ReturnType<typeof createMockGraphClient>;
	let repository: FalkorTurnRepository;

	beforeEach(() => {
		mockClient = createMockGraphClient();
		repository = new FalkorTurnRepository(mockClient as unknown as GraphClient);
	});

	describe("findBySession", () => {
		it("should return turns ordered by sequence index", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-1",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi there!",
							sequence_index: 0,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
				{
					t: {
						id: 2,
						labels: ["Turn"],
						properties: {
							id: "turn-2",
							user_content: "How are you?",
							user_content_hash: "def456",
							assistant_preview: "I am fine!",
							sequence_index: 1,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000001000,
							vt_end: 253402300799000,
							tt_start: 1700000001000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findBySession("sess-123");

			expect(result).toHaveLength(2);
			expect(result[0].sequenceIndex).toBe(0);
			expect(result[1].sequenceIndex).toBe(1);
		});
	});

	describe("create", () => {
		it("should create turn and link to session", async () => {
			// Mock for create query
			mockClient.query.mockResolvedValueOnce([]);

			await repository.create({
				sessionId: "sess-123",
				userContent: "Hello",
				userContentHash: "abc123",
				assistantPreview: "Hi there!",
				sequenceIndex: 0,
				filesTouched: [],
				toolCallsCount: 0,
			});

			const [query] = mockClient.query.mock.calls[0];
			expect(query).toContain("MATCH (s:Session {id: $sessionId})");
			expect(query).toContain("CREATE (t:Turn");
			expect(query).toContain("CREATE (s)-[:HAS_TURN");
		});

		it("should link to previous turn when sequence > 0", async () => {
			// Mock for create query
			mockClient.query.mockResolvedValueOnce([]);
			// Mock for NEXT edge query
			mockClient.query.mockResolvedValueOnce([]);

			await repository.create({
				sessionId: "sess-123",
				userContent: "Follow up",
				userContentHash: "xyz789",
				assistantPreview: "Response",
				sequenceIndex: 1,
				filesTouched: [],
				toolCallsCount: 0,
			});

			expect(mockClient.query).toHaveBeenCalledTimes(2);
			const [nextQuery] = mockClient.query.mock.calls[1];
			expect(nextQuery).toContain("CREATE (prev)-[:NEXT");
		});
	});

	describe("count", () => {
		it("should return count of turns in session", async () => {
			mockClient.query.mockResolvedValueOnce([{ cnt: 5 }]);

			const result = await repository.count("sess-123");

			expect(result).toBe(5);
		});
	});

	describe("findByTimeRange", () => {
		it("should find turns in time range", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-1",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							sequence_index: 0,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findByTimeRange(
				"sess-123",
				new Date(1699999999000),
				new Date(1700000001000),
			);

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("turn-1");
		});
	});

	describe("findLatest", () => {
		it("should find latest turns in reverse chronological order", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 2,
						labels: ["Turn"],
						properties: {
							id: "turn-2",
							user_content: "Second",
							user_content_hash: "def456",
							assistant_preview: "Response",
							sequence_index: 1,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000001000,
							vt_end: 253402300799000,
							tt_start: 1700000001000,
							tt_end: 253402300799000,
						},
					},
				},
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-1",
							user_content: "First",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							sequence_index: 0,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findLatest("sess-123", 2);

			expect(result).toHaveLength(2);
			// Should be reversed to chronological order
			expect(result[0].sequenceIndex).toBe(0);
			expect(result[1].sequenceIndex).toBe(1);
		});
	});

	describe("findByFilePath", () => {
		it("should find turns that touched a specific file", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-1",
							user_content: "Edit file",
							user_content_hash: "abc123",
							assistant_preview: "Done",
							sequence_index: 0,
							files_touched: ["/test.ts", "/other.ts"],
							tool_calls_count: 1,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findByFilePath("sess-123", "/test.ts");

			expect(result).toHaveLength(1);
			expect(result[0].filesTouched).toContain("/test.ts");
		});
	});

	describe("update", () => {
		it("should update turn with retry on concurrent modification", async () => {
			// First attempt: findById
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-123",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							sequence_index: 0,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					sessionId: "sess-123",
				},
			]);

			// Close old version returns 0 (concurrent modification)
			mockClient.query.mockResolvedValueOnce([{ count: 0 }]);

			// Second attempt: findById
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-123",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							sequence_index: 0,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					sessionId: "sess-123",
				},
			]);

			// Close succeeds
			mockClient.query.mockResolvedValueOnce([{ count: 1 }]);

			// Create new version
			mockClient.query.mockResolvedValueOnce([]);

			// Link REPLACES edge
			mockClient.query.mockResolvedValueOnce([]);

			// Link NEXT edge (no previous turn)
			// Link to next turn query (returns nothing)
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.update("turn-123", { assistantPreview: "Updated" });

			expect(result.assistantPreview).toBe("Updated");
		});

		it("should link to previous turn when sequence > 0", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-123",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							sequence_index: 1, // Non-zero sequence
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					sessionId: "sess-123",
				},
			]);

			mockClient.query.mockResolvedValueOnce([{ count: 1 }]);
			mockClient.query.mockResolvedValueOnce([]); // Create
			mockClient.query.mockResolvedValueOnce([]); // REPLACES edge
			mockClient.query.mockResolvedValueOnce([]); // Previous NEXT edge
			mockClient.query.mockResolvedValueOnce([]); // Next turn query

			const result = await repository.update("turn-123", { assistantPreview: "Updated" });

			expect(result.assistantPreview).toBe("Updated");
			expect(result.sequenceIndex).toBe(1);
		});

		it("should return existing turn when no updates provided", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-123",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							sequence_index: 0,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					sessionId: "sess-123",
				},
			]);

			const result = await repository.update("turn-123", {});

			expect(result.id).toBe("turn-123");
		});

		it("should link to next turn when it exists", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-123",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							sequence_index: 0,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					sessionId: "sess-123",
				},
			]);

			mockClient.query.mockResolvedValueOnce([{ count: 1 }]);
			mockClient.query.mockResolvedValueOnce([]);
			mockClient.query.mockResolvedValueOnce([]);
			mockClient.query.mockResolvedValueOnce([{ nextId: "turn-124" }]);
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.update("turn-123", { assistantPreview: "Updated" });

			expect(result.assistantPreview).toBe("Updated");
		});

		it("should throw after max retries on concurrent modification", async () => {
			for (let i = 0; i < 3; i++) {
				mockClient.query.mockResolvedValueOnce([
					{
						t: {
							id: 1,
							labels: ["Turn"],
							properties: {
								id: "turn-123",
								user_content: "Hello",
								user_content_hash: "abc123",
								assistant_preview: "Hi",
								sequence_index: 0,
								files_touched: [],
								tool_calls_count: 0,
								vt_start: 1700000000000,
								vt_end: 253402300799000,
								tt_start: 1700000000000,
								tt_end: 253402300799000,
							},
						},
						sessionId: "sess-123",
					},
				]);
				mockClient.query.mockResolvedValueOnce([{ count: 0 }]);
			}

			await expect(repository.update("turn-123", { assistantPreview: "Updated" })).rejects.toThrow(
				/Failed to update turn turn-123 after 3 attempts/,
			);
		});

		it("should throw immediately on non-concurrent errors", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-123",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							sequence_index: 0,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					sessionId: "sess-123",
				},
			]);

			mockClient.query.mockRejectedValueOnce(new Error("Database error"));

			await expect(repository.update("turn-123", { assistantPreview: "Updated" })).rejects.toThrow(
				"Database error",
			);
		});

		it("should throw when turn not found", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			await expect(
				repository.update("non-existent", { assistantPreview: "Updated" }),
			).rejects.toThrow("Turn not found: non-existent");
		});

		it("should include all optional fields when creating turn", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.create({
				sessionId: "sess-123",
				userContent: "Hello",
				userContentHash: "abc123",
				assistantPreview: "Hi there!",
				assistantBlobRef: "blob://abc",
				embedding: [0.1, 0.2, 0.3],
				sequenceIndex: 0,
				filesTouched: ["/test.ts"],
				toolCallsCount: 2,
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 20,
				cacheWriteTokens: 10,
				reasoningTokens: 5,
				costUsd: 0.01,
				durationMs: 500,
				gitCommit: "abc123def",
			});

			expect(result.assistantBlobRef).toBe("blob://abc");
			expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
			expect(result.inputTokens).toBe(100);
			expect(result.outputTokens).toBe(50);
			expect(result.cacheReadTokens).toBe(20);
			expect(result.cacheWriteTokens).toBe(10);
			expect(result.reasoningTokens).toBe(5);
			expect(result.costUsd).toBe(0.01);
			expect(result.durationMs).toBe(500);
			expect(result.gitCommit).toBe("abc123def");
		});

		it("should update all optional fields", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-123",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							sequence_index: 0,
							files_touched: [],
							tool_calls_count: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					sessionId: "sess-123",
				},
			]);

			mockClient.query.mockResolvedValueOnce([{ count: 1 }]);
			mockClient.query.mockResolvedValueOnce([]);
			mockClient.query.mockResolvedValueOnce([]);
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.update("turn-123", {
				assistantPreview: "Updated",
				assistantBlobRef: "blob://new",
				embedding: [0.5, 0.6],
				filesTouched: ["/new.ts"],
				toolCallsCount: 3,
				inputTokens: 200,
				outputTokens: 100,
				cacheReadTokens: 30,
				cacheWriteTokens: 15,
				reasoningTokens: 10,
				costUsd: 0.02,
				durationMs: 1000,
				gitCommit: "def456",
			});

			expect(result.assistantPreview).toBe("Updated");
			expect(result.assistantBlobRef).toBe("blob://new");
			expect(result.embedding).toEqual([0.5, 0.6]);
			expect(result.filesTouched).toEqual(["/new.ts"]);
			expect(result.toolCallsCount).toBe(3);
			expect(result.inputTokens).toBe(200);
			expect(result.outputTokens).toBe(100);
			expect(result.cacheReadTokens).toBe(30);
			expect(result.cacheWriteTokens).toBe(15);
			expect(result.reasoningTokens).toBe(10);
			expect(result.costUsd).toBe(0.02);
			expect(result.durationMs).toBe(1000);
			expect(result.gitCommit).toBe("def456");
		});
	});

	describe("findById", () => {
		it("should return null when turn not found", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.findById("non-existent");

			expect(result).toBeNull();
		});

		it("should return turn with all fields", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: {
							id: "turn-123",
							user_content: "Hello",
							user_content_hash: "abc123",
							assistant_preview: "Hi",
							assistant_blob_ref: "blob://abc",
							embedding: [0.1, 0.2],
							sequence_index: 0,
							files_touched: ["/test.ts"],
							tool_calls_count: 2,
							input_tokens: 100,
							output_tokens: 50,
							cache_read_tokens: 20,
							cache_write_tokens: 10,
							reasoning_tokens: 5,
							cost_usd: 0.01,
							duration_ms: 500,
							git_commit: "abc123",
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					sessionId: "sess-123",
				},
			]);

			const result = await repository.findById("turn-123");

			expect(result).not.toBeNull();
			expect(result?.assistantBlobRef).toBe("blob://abc");
			expect(result?.embedding).toEqual([0.1, 0.2]);
			expect(result?.inputTokens).toBe(100);
			expect(result?.gitCommit).toBe("abc123");
		});
	});

	describe("mapToTurn", () => {
		it("should throw when node or properties is null", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					t: {
						id: 1,
						labels: ["Turn"],
						properties: null,
					},
					sessionId: "sess-123",
				},
			]);

			await expect(repository.findById("turn-123")).rejects.toThrow(
				"Invalid node: node or properties is null/undefined",
			);
		});
	});
});

describe("FalkorReasoningRepository", () => {
	let mockClient: ReturnType<typeof createMockGraphClient>;
	let repository: FalkorReasoningRepository;

	beforeEach(() => {
		mockClient = createMockGraphClient();
		repository = new FalkorReasoningRepository(mockClient as unknown as GraphClient);
	});

	describe("findByTurn", () => {
		it("should return reasoning blocks ordered by sequence", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					r: {
						id: 1,
						labels: ["Reasoning"],
						properties: {
							id: "reason-1",
							content_hash: "hash1",
							preview: "Let me think...",
							reasoning_type: "chain_of_thought",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
				},
			]);

			const result = await repository.findByTurn("turn-123");

			expect(result).toHaveLength(1);
			expect(result[0].reasoningType).toBe("chain_of_thought");
		});
	});

	describe("create", () => {
		it("should create reasoning and link to turn", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.create({
				turnId: "turn-123",
				contentHash: "hash123",
				preview: "Thinking about this...",
				reasoningType: "analysis",
				sequenceIndex: 0,
			});

			const [query, params] = mockClient.query.mock.calls[0];
			expect(query).toContain("MATCH (t:Turn {id: $turnId})");
			expect(query).toContain("CREATE (r:Reasoning");
			expect(query).toContain("CREATE (t)-[:CONTAINS");
			expect(params).toMatchObject({
				turnId: "turn-123",
				content_hash: "hash123",
			});
			expect(result.turnId).toBe("turn-123");
		});
	});

	describe("findBySession", () => {
		it("should find all reasoning blocks in a session", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					r: {
						id: 1,
						labels: ["Reasoning"],
						properties: {
							id: "reason-1",
							content_hash: "hash1",
							preview: "First thought",
							reasoning_type: "analysis",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-1",
					turnSeq: 0,
				},
			]);

			const result = await repository.findBySession("sess-123");

			expect(result).toHaveLength(1);
			expect(result[0].reasoningType).toBe("analysis");
		});
	});

	describe("findByType", () => {
		it("should find reasoning blocks by type", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					r: {
						id: 1,
						labels: ["Reasoning"],
						properties: {
							id: "reason-1",
							content_hash: "hash1",
							preview: "Analysis",
							reasoning_type: "chain_of_thought",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-1",
					turnSeq: 0,
				},
			]);

			const result = await repository.findByType("sess-123", "chain_of_thought");

			expect(result).toHaveLength(1);
			expect(result[0].reasoningType).toBe("chain_of_thought");
		});
	});

	describe("createBatch", () => {
		it("should create multiple reasoning blocks", async () => {
			mockClient.query.mockResolvedValueOnce([]);
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.createBatch([
				{
					turnId: "turn-123",
					contentHash: "hash1",
					preview: "First",
					reasoningType: "analysis",
					sequenceIndex: 0,
				},
				{
					turnId: "turn-123",
					contentHash: "hash2",
					preview: "Second",
					reasoningType: "synthesis",
					sequenceIndex: 1,
				},
			]);

			expect(result).toHaveLength(2);
			expect(mockClient.query).toHaveBeenCalledTimes(2);
		});
	});

	describe("count", () => {
		it("should return count of reasoning blocks in turn", async () => {
			mockClient.query.mockResolvedValueOnce([{ cnt: 3 }]);

			const result = await repository.count("turn-123");

			expect(result).toBe(3);
		});
	});

	describe("findById", () => {
		it("should return null when reasoning not found", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.findById("non-existent");

			expect(result).toBeNull();
		});

		it("should return reasoning with all fields", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					r: {
						id: 1,
						labels: ["Reasoning"],
						properties: {
							id: "reason-1",
							content_hash: "hash1",
							preview: "Thinking...",
							blob_ref: "blob://abc",
							reasoning_type: "analysis",
							sequence_index: 0,
							embedding: [0.1, 0.2],
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-123",
				},
			]);

			const result = await repository.findById("reason-1");

			expect(result).not.toBeNull();
			expect(result?.blobRef).toBe("blob://abc");
			expect(result?.embedding).toEqual([0.1, 0.2]);
		});
	});

	describe("create with optional fields", () => {
		it("should create reasoning with all optional fields", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.create({
				turnId: "turn-123",
				contentHash: "hash123",
				preview: "Thinking...",
				blobRef: "blob://xyz",
				reasoningType: "analysis",
				sequenceIndex: 0,
				embedding: [0.5, 0.6, 0.7],
			});

			expect(result.blobRef).toBe("blob://xyz");
			expect(result.embedding).toEqual([0.5, 0.6, 0.7]);
		});
	});

	describe("count with default value", () => {
		it("should return 0 when query returns empty", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.count("turn-123");

			expect(result).toBe(0);
		});

		it("should return 0 when query returns null count", async () => {
			mockClient.query.mockResolvedValueOnce([{ cnt: null }]);

			const result = await repository.count("turn-123");

			expect(result).toBe(0);
		});
	});

	describe("mapToReasoning", () => {
		it("should throw when node or properties is null", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					r: {
						id: 1,
						labels: ["Reasoning"],
						properties: null,
					},
					turnId: "turn-123",
				},
			]);

			await expect(repository.findById("reason-123")).rejects.toThrow(
				"Invalid node: node or properties is null/undefined",
			);
		});
	});
});

describe("FalkorToolCallRepository", () => {
	let mockClient: ReturnType<typeof createMockGraphClient>;
	let repository: FalkorToolCallRepository;

	beforeEach(() => {
		mockClient = createMockGraphClient();
		repository = new FalkorToolCallRepository(mockClient as unknown as GraphClient);
	});

	describe("findByCallId", () => {
		it("should find tool call by provider call ID", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					tc: {
						id: 1,
						labels: ["ToolCall"],
						properties: {
							id: "tc-123",
							call_id: "toolu_01ABC",
							tool_name: "Read",
							tool_type: "file_read",
							arguments_json: '{"path": "/test.ts"}',
							status: "success",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-123",
				},
			]);

			const result = await repository.findByCallId("toolu_01ABC");

			expect(result).not.toBeNull();
			expect(result?.callId).toBe("toolu_01ABC");
			expect(result?.toolType).toBe("file_read");
		});
	});

	describe("create", () => {
		it("should create tool call and link to turn", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.create({
				turnId: "turn-123",
				callId: "toolu_01XYZ",
				toolName: "Bash",
				toolType: "bash_exec",
				argumentsJson: '{"command": "ls"}',
				sequenceIndex: 0,
			});

			const [query, params] = mockClient.query.mock.calls[0];
			expect(query).toContain("MATCH (t:Turn {id: $turnId})");
			expect(query).toContain("CREATE (tc:ToolCall");
			expect(query).toContain("CREATE (t)-[:INVOKES");
			expect(params.call_id).toBe("toolu_01XYZ");
			expect(result.status).toBe("pending");
		});

		it("should link to reasoning when reasoningSequence provided", async () => {
			// First call for create
			mockClient.query.mockResolvedValueOnce([]);
			// Second call for TRIGGERS edge
			mockClient.query.mockResolvedValueOnce([]);

			await repository.create({
				turnId: "turn-123",
				callId: "toolu_01XYZ",
				toolName: "Read",
				toolType: "file_read",
				argumentsJson: '{"path": "/test.ts"}',
				sequenceIndex: 0,
				reasoningSequence: 0,
			});

			expect(mockClient.query).toHaveBeenCalledTimes(2);
			const [triggersQuery] = mockClient.query.mock.calls[1];
			expect(triggersQuery).toContain("CREATE (r)-[:TRIGGERS");
		});
	});

	describe("updateResult", () => {
		it("should update tool call status and error", async () => {
			// First call for findById
			mockClient.query.mockResolvedValueOnce([
				{
					tc: {
						id: 1,
						labels: ["ToolCall"],
						properties: {
							id: "tc-123",
							call_id: "toolu_01ABC",
							tool_name: "Bash",
							tool_type: "bash_exec",
							arguments_json: '{"command": "ls"}',
							status: "pending",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-123",
				},
			]);
			// Second call for update
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.updateResult("tc-123", {
				status: "error",
				errorMessage: "Command failed",
			});

			expect(result.status).toBe("error");
			expect(result.errorMessage).toBe("Command failed");
		});

		it("should throw when tool call not found", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			await expect(repository.updateResult("non-existent", { status: "success" })).rejects.toThrow(
				"ToolCall not found: non-existent",
			);
		});
	});

	describe("countByStatus", () => {
		it("should return counts grouped by status", async () => {
			mockClient.query.mockResolvedValueOnce([
				{ status: "success", cnt: 10 },
				{ status: "error", cnt: 2 },
				{ status: "pending", cnt: 1 },
			]);

			const result = await repository.countByStatus("sess-123");

			expect(result).toEqual({
				success: 10,
				error: 2,
				pending: 1,
			});
		});
	});

	describe("findBySession", () => {
		it("should find all tool calls in a session", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					tc: {
						id: 1,
						labels: ["ToolCall"],
						properties: {
							id: "tc-1",
							call_id: "toolu_01A",
							tool_name: "Read",
							tool_type: "file_read",
							arguments_json: "{}",
							status: "success",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-1",
					turnSeq: 0,
				},
			]);

			const result = await repository.findBySession("sess-123");

			expect(result).toHaveLength(1);
			expect(result[0].toolType).toBe("file_read");
		});
	});

	describe("findByToolType", () => {
		it("should find tool calls by type", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					tc: {
						id: 1,
						labels: ["ToolCall"],
						properties: {
							id: "tc-1",
							call_id: "toolu_01A",
							tool_name: "Bash",
							tool_type: "bash_exec",
							arguments_json: "{}",
							status: "success",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-1",
					turnSeq: 0,
				},
			]);

			const result = await repository.findByToolType("sess-123", "bash_exec");

			expect(result).toHaveLength(1);
			expect(result[0].toolType).toBe("bash_exec");
		});
	});

	describe("findByStatus", () => {
		it("should find tool calls by status", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					tc: {
						id: 1,
						labels: ["ToolCall"],
						properties: {
							id: "tc-1",
							call_id: "toolu_01A",
							tool_name: "Read",
							tool_type: "file_read",
							arguments_json: "{}",
							status: "error",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-1",
					turnSeq: 0,
				},
			]);

			const result = await repository.findByStatus("sess-123", "error");

			expect(result).toHaveLength(1);
			expect(result[0].status).toBe("error");
		});
	});

	describe("findPending", () => {
		it("should find all pending tool calls across sessions", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					tc: {
						id: 1,
						labels: ["ToolCall"],
						properties: {
							id: "tc-1",
							call_id: "toolu_01A",
							tool_name: "Read",
							tool_type: "file_read",
							arguments_json: "{}",
							status: "pending",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-1",
				},
			]);

			const result = await repository.findPending();

			expect(result).toHaveLength(1);
			expect(result[0].status).toBe("pending");
		});

		it("should find pending tool calls for a specific session", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					tc: {
						id: 1,
						labels: ["ToolCall"],
						properties: {
							id: "tc-1",
							call_id: "toolu_01A",
							tool_name: "Read",
							tool_type: "file_read",
							arguments_json: "{}",
							status: "pending",
							sequence_index: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-1",
					turnSeq: 0,
				},
			]);

			const result = await repository.findPending("sess-123");

			expect(result).toHaveLength(1);
			expect(result[0].status).toBe("pending");
		});
	});

	describe("createBatch", () => {
		it("should create multiple tool calls", async () => {
			mockClient.query.mockResolvedValueOnce([]);
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.createBatch([
				{
					turnId: "turn-123",
					callId: "toolu_01A",
					toolName: "Read",
					toolType: "file_read",
					argumentsJson: "{}",
					sequenceIndex: 0,
				},
				{
					turnId: "turn-123",
					callId: "toolu_01B",
					toolName: "Write",
					toolType: "file_write",
					argumentsJson: "{}",
					sequenceIndex: 1,
				},
			]);

			expect(result).toHaveLength(2);
			expect(mockClient.query).toHaveBeenCalledTimes(2);
		});
	});

	describe("count", () => {
		it("should return count of tool calls in turn", async () => {
			mockClient.query.mockResolvedValueOnce([{ cnt: 4 }]);

			const result = await repository.count("turn-123");

			expect(result).toBe(4);
		});
	});

	describe("findById", () => {
		it("should return null when tool call not found", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.findById("non-existent");

			expect(result).toBeNull();
		});

		it("should return tool call with all fields", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					tc: {
						id: 1,
						labels: ["ToolCall"],
						properties: {
							id: "tc-123",
							call_id: "toolu_01ABC",
							tool_name: "Read",
							tool_type: "file_read",
							arguments_json: '{"path": "/test.ts"}',
							arguments_preview: "Read file /test.ts",
							status: "success",
							error_message: null,
							sequence_index: 0,
							reasoning_sequence: 0,
							vt_start: 1700000000000,
							vt_end: 253402300799000,
							tt_start: 1700000000000,
							tt_end: 253402300799000,
						},
					},
					turnId: "turn-123",
				},
			]);

			const result = await repository.findById("tc-123");

			expect(result).not.toBeNull();
			expect(result?.argumentsPreview).toBe("Read file /test.ts");
			expect(result?.reasoningSequence).toBe(0);
		});
	});

	describe("create with optional fields", () => {
		it("should create tool call with all optional fields", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.create({
				turnId: "turn-123",
				callId: "toolu_01XYZ",
				toolName: "Bash",
				toolType: "bash_exec",
				argumentsJson: '{"command": "ls"}',
				argumentsPreview: "Run ls",
				status: "error",
				errorMessage: "Failed to execute",
				sequenceIndex: 0,
				reasoningSequence: 1,
			});

			expect(result.argumentsPreview).toBe("Run ls");
			expect(result.status).toBe("error");
			expect(result.errorMessage).toBe("Failed to execute");
			expect(result.reasoningSequence).toBe(1);
		});
	});

	describe("findByTurn", () => {
		it("should return empty array when no tool calls", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.findByTurn("turn-123");

			expect(result).toHaveLength(0);
		});
	});

	describe("count with default value", () => {
		it("should return 0 when query returns empty", async () => {
			mockClient.query.mockResolvedValueOnce([]);

			const result = await repository.count("turn-123");

			expect(result).toBe(0);
		});

		it("should return 0 when query returns null count", async () => {
			mockClient.query.mockResolvedValueOnce([{ cnt: null }]);

			const result = await repository.count("turn-123");

			expect(result).toBe(0);
		});
	});

	describe("mapToToolCall", () => {
		it("should throw when node or properties is null", async () => {
			mockClient.query.mockResolvedValueOnce([
				{
					tc: {
						id: 1,
						labels: ["ToolCall"],
						properties: null,
					},
					turnId: "turn-123",
				},
			]);

			await expect(repository.findById("tc-123")).rejects.toThrow(
				"Invalid node: node or properties is null/undefined",
			);
		});
	});
});
