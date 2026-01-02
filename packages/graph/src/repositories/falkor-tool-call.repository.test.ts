import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorNode, GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { FalkorToolCallRepository } from "./falkor-tool-call.repository";

describe("FalkorToolCallRepository", () => {
	let mockClient: GraphClient;
	let repository: FalkorToolCallRepository;
	const mockNow = 1640000000000;

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new FalkorToolCallRepository(mockClient);
	});

	describe("findById", () => {
		it("should return tool call when found", async () => {
			const toolCallId = "tc-123";
			const turnId = "turn-456";
			const props = {
				id: toolCallId,
				call_id: "call-abc",
				tool_name: "read_file",
				tool_type: "file",
				arguments_json: '{"path": "/src/index.ts"}',
				status: "completed",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ tc: { properties: props } as FalkorNode, turnId },
			]);

			const result = await repository.findById(toolCallId);

			expect(result).not.toBeNull();
			expect(result?.id).toBe(toolCallId);
			expect(result?.turnId).toBe(turnId);
			expect(result?.toolName).toBe("read_file");
			expect(result?.status).toBe("completed");
		});

		it("should return null when not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findById("nonexistent");

			expect(result).toBeNull();
		});
	});

	describe("findByCallId", () => {
		it("should find tool call by external call ID", async () => {
			const callId = "call-abc";
			const props = {
				id: "tc-123",
				call_id: callId,
				tool_name: "write_file",
				tool_type: "file",
				arguments_json: "{}",
				status: "pending",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ tc: { properties: props } as FalkorNode, turnId: "turn-123" },
			]);

			const result = await repository.findByCallId(callId);

			expect(result?.callId).toBe(callId);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{call_id: $callId}");
			expect(params.callId).toBe(callId);
		});
	});

	describe("findByTurn", () => {
		it("should return all tool calls for a turn ordered by sequence", async () => {
			const turnId = "turn-123";
			const toolCalls = [
				{
					id: "tc-1",
					call_id: "call-1",
					tool_name: "read_file",
					tool_type: "file",
					arguments_json: "{}",
					status: "completed",
					sequence_index: 0,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
				{
					id: "tc-2",
					call_id: "call-2",
					tool_name: "write_file",
					tool_type: "file",
					arguments_json: "{}",
					status: "completed",
					sequence_index: 1,
					vt_start: mockNow + 100,
					vt_end: MAX_DATE,
					tt_start: mockNow + 100,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				toolCalls.map((tc) => ({ tc: { properties: tc } as FalkorNode })),
			);

			const result = await repository.findByTurn(turnId);

			expect(result).toHaveLength(2);
			expect(result[0].sequenceIndex).toBe(0);
			expect(result[1].sequenceIndex).toBe(1);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY tc.sequence_index ASC");
		});
	});

	describe("findBySession", () => {
		it("should return all tool calls for a session ordered by turn and sequence", async () => {
			const sessionId = "session-123";
			const toolCalls = [
				{
					id: "tc-1",
					call_id: "call-1",
					tool_name: "read_file",
					tool_type: "file",
					arguments_json: "{}",
					status: "completed",
					sequence_index: 0,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				toolCalls.map((tc) => ({
					tc: { properties: tc } as FalkorNode,
					turnId: "turn-1",
					turnSeq: 0,
				})),
			);

			const result = await repository.findBySession(sessionId);

			expect(result).toHaveLength(1);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY turnSeq ASC, tc.sequence_index ASC");
		});
	});

	describe("findByToolType", () => {
		it("should filter by tool type", async () => {
			const sessionId = "session-123";
			const toolType = "file";

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByToolType(sessionId, toolType);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{tool_type: $toolType}");
			expect(params.toolType).toBe(toolType);
		});
	});

	describe("findByStatus", () => {
		it("should filter by status", async () => {
			const sessionId = "session-123";
			const status = "pending";

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByStatus(sessionId, status);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{status: $status}");
			expect(params.status).toBe(status);
		});
	});

	describe("findPending", () => {
		it("should find all pending tool calls globally when no sessionId", async () => {
			const props = {
				id: "tc-123",
				call_id: "call-abc",
				tool_name: "run_command",
				tool_type: "shell",
				arguments_json: "{}",
				status: "pending",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ tc: { properties: props } as FalkorNode, turnId: "turn-123" },
			]);

			const result = await repository.findPending();

			expect(result).toHaveLength(1);
			expect(result[0].status).toBe("pending");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("status: 'pending'");
		});

		it("should find pending tool calls for specific session", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findPending("session-123");

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{status: $status}");
			expect(params.status).toBe("pending");
		});
	});

	describe("create", () => {
		it("should create tool call with required fields", async () => {
			const input = {
				turnId: "turn-123",
				callId: "call-abc",
				toolName: "read_file",
				sequenceIndex: 0,
				argumentsJson: '{"path": "/src/index.ts"}',
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.create(input);

			expect(result.turnId).toBe(input.turnId);
			expect(result.callId).toBe(input.callId);
			expect(result.toolName).toBe(input.toolName);
			expect(result.toolType).toBe("unknown");
			expect(result.status).toBe("pending");
			expect(result.sequenceIndex).toBe(0);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (t:Turn {id: $turnId})");
			expect(query).toContain("CREATE (tc:ToolCall");
			expect(query).toContain("CREATE (t)-[:INVOKES");
		});

		it("should create tool call with all optional fields", async () => {
			const input = {
				turnId: "turn-123",
				callId: "call-abc",
				toolName: "execute",
				toolType: "shell",
				sequenceIndex: 0,
				argumentsJson: '{"command": "ls"}',
				argumentsPreview: "ls",
				status: "running" as const,
				errorMessage: undefined,
				reasoningSequence: 2,
			};

			spyOn(mockClient, "query")
				// Create tool call
				.mockResolvedValueOnce([])
				// Link to reasoning node
				.mockResolvedValueOnce([]);

			const result = await repository.create(input);

			expect(result.toolType).toBe("shell");
			expect(result.status).toBe("running");
			expect(result.argumentsPreview).toBe("ls");
			expect(result.reasoningSequence).toBe(2);
		});

		it("should link to reasoning node when reasoningSequence provided", async () => {
			const input = {
				turnId: "turn-123",
				callId: "call-abc",
				toolName: "execute",
				sequenceIndex: 0,
				argumentsJson: "{}",
				reasoningSequence: 1,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([]).mockResolvedValueOnce([]);

			await repository.create(input);

			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(2);

			const [linkQuery, linkParams] = calls[1];
			expect(linkQuery).toContain("(r:Reasoning {sequence_index: $reasoningSeq})");
			expect(linkQuery).toContain("CREATE (r)-[:TRIGGERS");
			expect(linkParams.reasoningSeq).toBe(1);
		});
	});

	describe("createBatch", () => {
		it("should create multiple tool calls grouped by turn", async () => {
			const inputs = [
				{
					turnId: "turn-1",
					callId: "call-1",
					toolName: "read",
					sequenceIndex: 0,
					argumentsJson: "{}",
				},
				{
					turnId: "turn-1",
					callId: "call-2",
					toolName: "write",
					sequenceIndex: 1,
					argumentsJson: "{}",
				},
				{
					turnId: "turn-2",
					callId: "call-3",
					toolName: "execute",
					sequenceIndex: 0,
					argumentsJson: "{}",
				},
			];

			spyOn(mockClient, "query").mockResolvedValue([]);

			const results = await repository.createBatch(inputs);

			expect(results).toHaveLength(3);
		});
	});

	describe("updateResult", () => {
		it("should update tool call status", async () => {
			const existingProps = {
				id: "tc-123",
				call_id: "call-abc",
				tool_name: "read_file",
				tool_type: "file",
				arguments_json: "{}",
				status: "pending",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([
					{ tc: { properties: existingProps } as FalkorNode, turnId: "turn-123" },
				])
				// update status
				.mockResolvedValueOnce([]);

			const result = await repository.updateResult("tc-123", {
				status: "completed",
			});

			expect(result.status).toBe("completed");

			const [updateQuery, updateParams] = (mockClient.query as any).mock.calls[1];
			expect(updateQuery).toContain("SET tc.status = $status");
			expect(updateParams.status).toBe("completed");
		});

		it("should update tool call with error message", async () => {
			const existingProps = {
				id: "tc-123",
				call_id: "call-abc",
				tool_name: "run_command",
				tool_type: "shell",
				arguments_json: "{}",
				status: "running",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{ tc: { properties: existingProps } as FalkorNode, turnId: "turn-123" },
				])
				.mockResolvedValueOnce([]);

			const result = await repository.updateResult("tc-123", {
				status: "failed",
				errorMessage: "Command not found",
			});

			expect(result.status).toBe("failed");
			expect(result.errorMessage).toBe("Command not found");

			const [updateQuery] = (mockClient.query as any).mock.calls[1];
			expect(updateQuery).toContain("tc.error_message = $error_message");
		});

		it("should throw error if tool call not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.updateResult("nonexistent", { status: "completed" })).rejects.toThrow(
				"ToolCall not found: nonexistent",
			);
		});
	});

	describe("count", () => {
		it("should return count of tool calls in turn", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 3 }]);

			const result = await repository.count("turn-123");

			expect(result).toBe(3);
		});

		it("should return 0 when turn has no tool calls", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 0 }]);

			const result = await repository.count("empty-turn");

			expect(result).toBe(0);
		});
	});

	describe("countByStatus", () => {
		it("should return counts grouped by status", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ status: "completed", cnt: 10 },
				{ status: "pending", cnt: 2 },
				{ status: "failed", cnt: 1 },
			]);

			const result = await repository.countByStatus("session-123");

			expect(result.completed).toBe(10);
			expect(result.pending).toBe(2);
			expect(result.failed).toBe(1);
		});

		it("should return empty object when no tool calls", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.countByStatus("empty-session");

			expect(result).toEqual({});
		});
	});
});
