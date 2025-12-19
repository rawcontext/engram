import type { GraphClient } from "@engram/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FalkorReasoningRepository } from "./falkor-reasoning.repository";
import { FalkorSessionRepository } from "./falkor-session.repository";
import { FalkorToolCallRepository } from "./falkor-tool-call.repository";
import { FalkorTurnRepository } from "./falkor-turn.repository";

// Mock GraphClient
const createMockGraphClient = () => ({
	connect: vi.fn(async () => {}),
	disconnect: vi.fn(async () => {}),
	query: vi.fn(async () => []),
	isConnected: vi.fn(() => true),
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
});
