import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorNode, GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { FalkorReasoningRepository } from "./falkor-reasoning.repository";

describe("FalkorReasoningRepository", () => {
	let mockClient: GraphClient;
	let repository: FalkorReasoningRepository;
	const mockNow = 1640000000000;

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new FalkorReasoningRepository(mockClient);
	});

	describe("findById", () => {
		it("should return reasoning when found", async () => {
			const reasoningId = "r-123";
			const turnId = "turn-456";
			const props = {
				id: reasoningId,
				content_hash: "hash123",
				preview: "Thinking about the solution...",
				reasoning_type: "planning",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ r: { properties: props } as FalkorNode, turnId },
			]);

			const result = await repository.findById(reasoningId);

			expect(result).not.toBeNull();
			expect(result?.id).toBe(reasoningId);
			expect(result?.turnId).toBe(turnId);
			expect(result?.preview).toBe("Thinking about the solution...");
			expect(result?.reasoningType).toBe("planning");
		});

		it("should return null when not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findById("nonexistent");

			expect(result).toBeNull();
		});

		it("should query with CONTAINS edge", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findById("r-123");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("(t:Turn)-[:CONTAINS]->(r:Reasoning {id: $id})");
		});
	});

	describe("findByTurn", () => {
		it("should return all reasoning for a turn ordered by sequence", async () => {
			const turnId = "turn-123";
			const reasonings = [
				{
					id: "r-1",
					content_hash: "hash1",
					preview: "First thought",
					reasoning_type: "analysis",
					sequence_index: 0,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
				{
					id: "r-2",
					content_hash: "hash2",
					preview: "Second thought",
					reasoning_type: "planning",
					sequence_index: 1,
					vt_start: mockNow + 100,
					vt_end: MAX_DATE,
					tt_start: mockNow + 100,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				reasonings.map((r) => ({ r: { properties: r } as FalkorNode })),
			);

			const result = await repository.findByTurn(turnId);

			expect(result).toHaveLength(2);
			expect(result[0].sequenceIndex).toBe(0);
			expect(result[1].sequenceIndex).toBe(1);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY r.sequence_index ASC");
		});

		it("should return empty array when turn has no reasoning", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findByTurn("empty-turn");

			expect(result).toEqual([]);
		});
	});

	describe("findBySession", () => {
		it("should return all reasoning for a session ordered by turn and sequence", async () => {
			const sessionId = "session-123";
			const reasonings = [
				{
					id: "r-1",
					content_hash: "hash1",
					preview: "Turn 1 thought",
					reasoning_type: "analysis",
					sequence_index: 0,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				reasonings.map((r) => ({
					r: { properties: r } as FalkorNode,
					turnId: "turn-1",
					turnSeq: 0,
				})),
			);

			const result = await repository.findBySession(sessionId);

			expect(result).toHaveLength(1);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY turnSeq ASC, r.sequence_index ASC");
		});
	});

	describe("findByType", () => {
		it("should filter by reasoning type", async () => {
			const sessionId = "session-123";
			const reasoningType = "planning";

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByType(sessionId, reasoningType);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{reasoning_type: $reasoningType}");
			expect(params.reasoningType).toBe(reasoningType);
		});

		it("should return reasoning matching type", async () => {
			const props = {
				id: "r-123",
				content_hash: "hash123",
				preview: "Planning steps...",
				reasoning_type: "planning",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ r: { properties: props } as FalkorNode, turnId: "turn-1", turnSeq: 0 },
			]);

			const result = await repository.findByType("session-123", "planning");

			expect(result).toHaveLength(1);
			expect(result[0].reasoningType).toBe("planning");
		});
	});

	describe("create", () => {
		it("should create reasoning with required fields", async () => {
			const input = {
				turnId: "turn-123",
				contentHash: "hash123",
				preview: "Initial analysis of the problem...",
				sequenceIndex: 0,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.create(input);

			expect(result.turnId).toBe(input.turnId);
			expect(result.contentHash).toBe(input.contentHash);
			expect(result.preview).toBe(input.preview);
			expect(result.reasoningType).toBe("unknown");
			expect(result.sequenceIndex).toBe(0);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (t:Turn {id: $turnId})");
			expect(query).toContain("CREATE (r:Reasoning");
			expect(query).toContain("CREATE (t)-[:CONTAINS");
		});

		it("should create reasoning with all optional fields", async () => {
			const input = {
				turnId: "turn-123",
				contentHash: "hash123",
				preview: "Detailed analysis...",
				reasoningType: "analysis",
				sequenceIndex: 1,
				blobRef: "blob-ref-456",
				embedding: [0.1, 0.2, 0.3],
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.create(input);

			expect(result.reasoningType).toBe("analysis");
			expect(result.blobRef).toBe("blob-ref-456");
			expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
		});
	});

	describe("createBatch", () => {
		it("should create multiple reasoning entries grouped by turn", async () => {
			const inputs = [
				{
					turnId: "turn-1",
					contentHash: "hash1",
					preview: "First thought",
					sequenceIndex: 0,
				},
				{
					turnId: "turn-1",
					contentHash: "hash2",
					preview: "Second thought",
					sequenceIndex: 1,
				},
				{
					turnId: "turn-2",
					contentHash: "hash3",
					preview: "Different turn",
					sequenceIndex: 0,
				},
			];

			spyOn(mockClient, "query").mockResolvedValue([]);

			const results = await repository.createBatch(inputs);

			expect(results).toHaveLength(3);
		});
	});

	describe("count", () => {
		it("should return count of reasoning entries in turn", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 5 }]);

			const result = await repository.count("turn-123");

			expect(result).toBe(5);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("count(r) as cnt");
			expect(params.turnId).toBe("turn-123");
		});

		it("should return 0 when turn has no reasoning", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 0 }]);

			const result = await repository.count("empty-turn");

			expect(result).toBe(0);
		});

		it("should return 0 when query returns empty", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.count("nonexistent");

			expect(result).toBe(0);
		});
	});

	describe("mapToReasoning", () => {
		it("should correctly map all fields", async () => {
			const props = {
				id: "r-123",
				content_hash: "hash123",
				preview: "Detailed analysis...",
				blob_ref: "blob-ref-456",
				reasoning_type: "planning",
				sequence_index: 2,
				embedding: [0.1, 0.2],
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ r: { properties: props } as FalkorNode, turnId: "turn-456" },
			]);

			const result = await repository.findById("r-123");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("r-123");
			expect(result?.turnId).toBe("turn-456");
			expect(result?.contentHash).toBe("hash123");
			expect(result?.preview).toBe("Detailed analysis...");
			expect(result?.blobRef).toBe("blob-ref-456");
			expect(result?.reasoningType).toBe("planning");
			expect(result?.sequenceIndex).toBe(2);
			expect(result?.embedding).toEqual([0.1, 0.2]);
			expect(result?.vtStart).toBe(mockNow);
			expect(result?.vtEnd).toBe(MAX_DATE);
		});

		it("should handle missing optional fields", async () => {
			const props = {
				id: "r-123",
				content_hash: "hash123",
				preview: "Simple thought",
				reasoning_type: "unknown",
				sequence_index: 0,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ r: { properties: props } as FalkorNode, turnId: "turn-456" },
			]);

			const result = await repository.findById("r-123");

			expect(result).not.toBeNull();
			expect(result?.blobRef).toBeUndefined();
			expect(result?.embedding).toBeUndefined();
		});
	});
});
