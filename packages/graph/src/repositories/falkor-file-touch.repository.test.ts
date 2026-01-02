import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorNode, GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { FalkorFileTouchRepository } from "./falkor-file-touch.repository";

describe("FalkorFileTouchRepository", () => {
	let mockClient: GraphClient;
	let repository: FalkorFileTouchRepository;
	const mockNow = 1640000000000;

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new FalkorFileTouchRepository(mockClient);
	});

	describe("findById", () => {
		it("should return file touch when found", async () => {
			const fileTouchId = "ft-123";
			const toolCallId = "tc-456";
			const props = {
				id: fileTouchId,
				file_path: "/src/index.ts",
				action: "edit",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ ft: { properties: props } as FalkorNode, toolCallId },
			]);

			const result = await repository.findById(fileTouchId);

			expect(result).not.toBeNull();
			expect(result?.id).toBe(fileTouchId);
			expect(result?.toolCallId).toBe(toolCallId);
			expect(result?.filePath).toBe("/src/index.ts");
			expect(result?.action).toBe("edit");
		});

		it("should return null when not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findById("nonexistent");

			expect(result).toBeNull();
		});

		it("should query with TOUCHES edge", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findById("ft-123");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("(tc:ToolCall)-[:TOUCHES]->(ft:FileTouch {id: $id})");
		});
	});

	describe("findByToolCall", () => {
		it("should return all file touches for a tool call ordered by sequence", async () => {
			const toolCallId = "tc-123";
			const fileTouches = [
				{
					id: "ft-1",
					file_path: "/src/index.ts",
					action: "read",
					sequence_index: 0,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
				{
					id: "ft-2",
					file_path: "/src/utils.ts",
					action: "edit",
					sequence_index: 1,
					vt_start: mockNow + 100,
					vt_end: MAX_DATE,
					tt_start: mockNow + 100,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				fileTouches.map((ft) => ({ ft: { properties: ft } as FalkorNode })),
			);

			const result = await repository.findByToolCall(toolCallId);

			expect(result).toHaveLength(2);
			expect(result[0].sequenceIndex).toBe(0);
			expect(result[1].sequenceIndex).toBe(1);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY ft.sequence_index ASC");
		});
	});

	describe("findByTurn", () => {
		it("should return all file touches for a turn", async () => {
			const turnId = "turn-123";
			const fileTouches = [
				{
					id: "ft-1",
					file_path: "/src/index.ts",
					action: "read",
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				fileTouches.map((ft) => ({
					ft: { properties: ft } as FalkorNode,
					toolCallId: "tc-1",
					tcSeq: 0,
				})),
			);

			const result = await repository.findByTurn(turnId);

			expect(result).toHaveLength(1);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain(
				"(t:Turn {id: $turnId})-[:INVOKES]->(tc:ToolCall)-[:TOUCHES]->(ft:FileTouch)",
			);
		});
	});

	describe("findBySession", () => {
		it("should return all file touches for a session ordered by turn and sequence", async () => {
			const sessionId = "session-123";
			const fileTouches = [
				{
					id: "ft-1",
					file_path: "/src/index.ts",
					action: "read",
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				fileTouches.map((ft) => ({
					ft: { properties: ft } as FalkorNode,
					toolCallId: "tc-1",
					turnSeq: 0,
					tcSeq: 0,
				})),
			);

			const result = await repository.findBySession(sessionId);

			expect(result).toHaveLength(1);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY turnSeq ASC, tcSeq ASC, ft.sequence_index ASC");
		});
	});

	describe("findByFilePath", () => {
		it("should find all touches for a specific file path", async () => {
			const filePath = "/src/index.ts";
			const props = {
				id: "ft-1",
				file_path: filePath,
				action: "edit",
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ ft: { properties: props } as FalkorNode, toolCallId: "tc-1" },
			]);

			const result = await repository.findByFilePath(filePath);

			expect(result).toHaveLength(1);
			expect(result[0].filePath).toBe(filePath);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{file_path: $filePath}");
			expect(params.filePath).toBe(filePath);
		});

		it("should order by vt_start DESC (most recent first)", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByFilePath("/src/index.ts");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY ft.vt_start DESC");
		});
	});

	describe("findByFilePathInSession", () => {
		it("should find touches for a file within a specific session", async () => {
			const sessionId = "session-123";
			const filePath = "/src/index.ts";

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByFilePathInSession(sessionId, filePath);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("(s:Session {id: $sessionId})");
			expect(query).toContain("(ft:FileTouch {file_path: $filePath})");
			expect(params.sessionId).toBe(sessionId);
			expect(params.filePath).toBe(filePath);
		});
	});

	describe("findByAction", () => {
		it("should filter by action type", async () => {
			const sessionId = "session-123";
			const action = "edit";

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByAction(sessionId, action);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{action: $action}");
			expect(params.action).toBe(action);
		});
	});

	describe("create", () => {
		it("should create file touch with required fields", async () => {
			const input = {
				toolCallId: "tc-123",
				filePath: "/src/index.ts",
				action: "read",
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.create(input);

			expect(result.toolCallId).toBe(input.toolCallId);
			expect(result.filePath).toBe(input.filePath);
			expect(result.action).toBe(input.action);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (tc:ToolCall {id: $toolCallId})");
			expect(query).toContain("CREATE (ft:FileTouch");
			expect(query).toContain("CREATE (tc)-[:TOUCHES");
		});

		it("should create file touch with all optional fields", async () => {
			const input = {
				toolCallId: "tc-123",
				filePath: "/src/index.ts",
				action: "edit",
				sequenceIndex: 0,
				diffPreview: "+const x = 1;\\n-const y = 2;",
				linesAdded: 5,
				linesRemoved: 2,
				matchCount: undefined,
				matchedFiles: undefined,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.create(input);

			expect(result.sequenceIndex).toBe(0);
			expect(result.diffPreview).toBe(input.diffPreview);
			expect(result.linesAdded).toBe(5);
			expect(result.linesRemoved).toBe(2);
		});

		it("should handle glob action with matched files", async () => {
			const input = {
				toolCallId: "tc-123",
				filePath: "**/*.ts",
				action: "glob",
				matchCount: 10,
				matchedFiles: ["/src/a.ts", "/src/b.ts"],
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.create(input);

			expect(result.matchCount).toBe(10);
			expect(result.matchedFiles).toEqual(["/src/a.ts", "/src/b.ts"]);
		});
	});

	describe("createBatch", () => {
		it("should create multiple file touches grouped by tool call", async () => {
			const inputs = [
				{
					toolCallId: "tc-1",
					filePath: "/src/a.ts",
					action: "read",
				},
				{
					toolCallId: "tc-1",
					filePath: "/src/b.ts",
					action: "read",
				},
				{
					toolCallId: "tc-2",
					filePath: "/src/c.ts",
					action: "edit",
				},
			];

			spyOn(mockClient, "query").mockResolvedValue([]);

			const results = await repository.createBatch(inputs);

			expect(results).toHaveLength(3);
		});
	});

	describe("count", () => {
		it("should return count of file touches for a tool call", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 3 }]);

			const result = await repository.count("tc-123");

			expect(result).toBe(3);
		});

		it("should return 0 when tool call has no file touches", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 0 }]);

			const result = await repository.count("empty-tc");

			expect(result).toBe(0);
		});
	});

	describe("countByAction", () => {
		it("should return counts grouped by action", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ action: "read", cnt: 10 },
				{ action: "edit", cnt: 5 },
				{ action: "create", cnt: 2 },
			]);

			const result = await repository.countByAction("session-123");

			expect(result.read).toBe(10);
			expect(result.edit).toBe(5);
			expect(result.create).toBe(2);
		});

		it("should return empty object when no file touches", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.countByAction("empty-session");

			expect(result).toEqual({});
		});
	});

	describe("mapToFileTouch", () => {
		it("should correctly map all fields", async () => {
			const props = {
				id: "ft-123",
				file_path: "/src/index.ts",
				action: "edit",
				sequence_index: 1,
				diff_preview: "+const x = 1;",
				lines_added: 1,
				lines_removed: 0,
				match_count: undefined,
				matched_files: undefined,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ ft: { properties: props } as FalkorNode, toolCallId: "tc-456" },
			]);

			const result = await repository.findById("ft-123");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("ft-123");
			expect(result?.toolCallId).toBe("tc-456");
			expect(result?.filePath).toBe("/src/index.ts");
			expect(result?.action).toBe("edit");
			expect(result?.sequenceIndex).toBe(1);
			expect(result?.diffPreview).toBe("+const x = 1;");
			expect(result?.linesAdded).toBe(1);
			expect(result?.linesRemoved).toBe(0);
			expect(result?.vtStart).toBe(mockNow);
			expect(result?.vtEnd).toBe(MAX_DATE);
		});

		it("should handle glob-specific fields", async () => {
			const props = {
				id: "ft-123",
				file_path: "**/*.ts",
				action: "glob",
				match_count: 5,
				matched_files: ["/a.ts", "/b.ts"],
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ ft: { properties: props } as FalkorNode, toolCallId: "tc-456" },
			]);

			const result = await repository.findById("ft-123");

			expect(result?.matchCount).toBe(5);
			expect(result?.matchedFiles).toEqual(["/a.ts", "/b.ts"]);
		});
	});
});
