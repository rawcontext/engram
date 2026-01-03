import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorNode, GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { FalkorConflictReportRepository } from "./falkor-conflict-report.repository";

describe("FalkorConflictReportRepository", () => {
	let mockClient: GraphClient;
	let repository: FalkorConflictReportRepository;
	const mockNow = 1640000000000;

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new FalkorConflictReportRepository(mockClient);
	});

	const createConflictReportProps = (overrides: Partial<Record<string, unknown>> = {}) => ({
		id: "conflict-123",
		memory_id_a: "mem-a",
		memory_id_b: "mem-b",
		relation: "contradicts",
		confidence: 0.9,
		reasoning: "These memories contain conflicting information",
		model_used: "gpt-4",
		status: "pending_review",
		suggested_action: "invalidate_older",
		scan_id: "scan-001",
		scanned_at: mockNow,
		org_id: "org-123",
		vt_start: mockNow,
		vt_end: MAX_DATE,
		tt_start: mockNow,
		tt_end: MAX_DATE,
		...overrides,
	});

	describe("findById", () => {
		it("should return conflict report when found", async () => {
			const props = createConflictReportProps();

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props } as FalkorNode },
			]);

			const result = await repository.findById("conflict-123");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("conflict-123");
			expect(result?.memoryIdA).toBe("mem-a");
			expect(result?.memoryIdB).toBe("mem-b");
			expect(result?.relation).toBe("contradicts");
			expect(result?.confidence).toBe(0.9);
			expect(result?.status).toBe("pending_review");
		});

		it("should return null when conflict report not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findById("nonexistent");

			expect(result).toBeNull();
		});

		it("should filter by tt_end = MAX_DATE", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findById("conflict-123");

			const calls = (mockClient.query as ReturnType<typeof mock>).mock.calls;
			expect(calls).toHaveLength(1);
			const [query] = calls[0] as [string, unknown];
			expect(query).toContain(`WHERE c.tt_end = ${MAX_DATE}`);
		});
	});

	describe("findByProject", () => {
		it("should find conflict reports by project", async () => {
			const props = createConflictReportProps({ project: "my-project" });

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props } as FalkorNode },
			]);

			const result = await repository.findByProject("my-project");

			expect(result).toHaveLength(1);
			expect(result[0].project).toBe("my-project");

			const calls = (mockClient.query as ReturnType<typeof mock>).mock.calls;
			const [query, params] = calls[0] as [string, Record<string, unknown>];
			expect(query).toContain("{project: $project}");
			expect(params.project).toBe("my-project");
		});

		it("should order by scanned_at DESC", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByProject("my-project");

			const calls = (mockClient.query as ReturnType<typeof mock>).mock.calls;
			const [query] = calls[0] as [string, unknown];
			expect(query).toContain("ORDER BY c.scanned_at DESC");
		});
	});

	describe("findPending", () => {
		it("should find pending conflict reports for org", async () => {
			const props = createConflictReportProps({ org_id: "org-123" });

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props } as FalkorNode },
			]);

			const result = await repository.findPending("org-123");

			expect(result).toHaveLength(1);
			expect(result[0].status).toBe("pending_review");

			const calls = (mockClient.query as ReturnType<typeof mock>).mock.calls;
			const [query, params] = calls[0] as [string, Record<string, unknown>];
			expect(query).toContain("{org_id: $orgId, status: 'pending_review'}");
			expect(params.orgId).toBe("org-123");
		});

		it("should filter by project when provided", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findPending("org-123", "my-project");

			const calls = (mockClient.query as ReturnType<typeof mock>).mock.calls;
			const [query, params] = calls[0] as [string, Record<string, unknown>];
			expect(query).toContain("AND c.project = $project");
			expect(params.project).toBe("my-project");
		});
	});

	describe("findByMemoryId", () => {
		it("should find conflict reports involving a memory", async () => {
			const props = createConflictReportProps({ memory_id_a: "mem-target" });

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props } as FalkorNode },
			]);

			const result = await repository.findByMemoryId("mem-target");

			expect(result).toHaveLength(1);

			const calls = (mockClient.query as ReturnType<typeof mock>).mock.calls;
			const [query] = calls[0] as [string, unknown];
			expect(query).toContain("c.memory_id_a = $memoryId OR c.memory_id_b = $memoryId");
		});
	});

	describe("create", () => {
		it("should create conflict report with required fields", async () => {
			const input = {
				memoryIdA: "mem-a",
				memoryIdB: "mem-b",
				relation: "contradicts",
				confidence: 0.85,
				reasoning: "Conflicting information detected",
				modelUsed: "gpt-4",
				suggestedAction: "invalidate_older",
				scanId: "scan-001",
				scannedAt: mockNow,
				orgId: "org-123",
			};

			const createdProps = createConflictReportProps({
				memory_id_a: input.memoryIdA,
				memory_id_b: input.memoryIdB,
				confidence: input.confidence,
			});

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: createdProps } as FalkorNode },
			]);

			const result = await repository.create(input);

			expect(result.memoryIdA).toBe(input.memoryIdA);
			expect(result.memoryIdB).toBe(input.memoryIdB);
			expect(result.status).toBe("pending_review");

			const calls = (mockClient.query as ReturnType<typeof mock>).mock.calls;
			const [query] = calls[0] as [string, unknown];
			expect(query).toContain("CREATE (c:ConflictReport");
		});

		it("should include optional project when provided", async () => {
			const input = {
				memoryIdA: "mem-a",
				memoryIdB: "mem-b",
				relation: "contradicts",
				confidence: 0.85,
				reasoning: "Conflicting information",
				modelUsed: "gpt-4",
				suggestedAction: "invalidate_older",
				scanId: "scan-001",
				scannedAt: mockNow,
				orgId: "org-123",
				project: "my-project",
			};

			const createdProps = createConflictReportProps({ project: "my-project" });

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: createdProps } as FalkorNode },
			]);

			const result = await repository.create(input);

			expect(result.project).toBe("my-project");
		});
	});

	describe("createMany", () => {
		it("should return empty array for empty input", async () => {
			const result = await repository.createMany([]);

			expect(result).toEqual([]);
		});

		it("should create multiple conflict reports", async () => {
			const inputs = [
				{
					memoryIdA: "mem-a1",
					memoryIdB: "mem-b1",
					relation: "contradicts",
					confidence: 0.8,
					reasoning: "Conflict 1",
					modelUsed: "gpt-4",
					suggestedAction: "invalidate_older",
					scanId: "scan-001",
					scannedAt: mockNow,
					orgId: "org-123",
				},
				{
					memoryIdA: "mem-a2",
					memoryIdB: "mem-b2",
					relation: "supersedes",
					confidence: 0.9,
					reasoning: "Conflict 2",
					modelUsed: "gpt-4",
					suggestedAction: "keep_newer",
					scanId: "scan-001",
					scannedAt: mockNow,
					orgId: "org-123",
				},
			];

			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{ c: { properties: createConflictReportProps({ id: "c1" }) } as FalkorNode },
				])
				.mockResolvedValueOnce([
					{ c: { properties: createConflictReportProps({ id: "c2" }) } as FalkorNode },
				]);

			const result = await repository.createMany(inputs);

			expect(result).toHaveLength(2);
		});
	});

	describe("resolve", () => {
		it("should resolve conflict report", async () => {
			const existingProps = createConflictReportProps();
			const resolvedProps = createConflictReportProps({
				status: "confirmed",
				reviewed_at: mockNow + 1000,
				reviewed_by: "user-123",
			});

			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ c: { properties: existingProps } as FalkorNode }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ c: { properties: resolvedProps } as FalkorNode }]);

			const result = await repository.resolve("conflict-123", {
				status: "confirmed",
				reviewedBy: "user-123",
			});

			expect(result.status).toBe("confirmed");
			expect(result.reviewedBy).toBe("user-123");
		});

		it("should throw error if conflict report not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.resolve("nonexistent", { status: "confirmed" })).rejects.toThrow(
				"ConflictReport not found: nonexistent",
			);
		});

		it("should include resolution action when provided", async () => {
			const existingProps = createConflictReportProps();
			const resolvedProps = createConflictReportProps({
				status: "confirmed",
				resolution_action: "invalidated_memory_b",
			});

			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ c: { properties: existingProps } as FalkorNode }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ c: { properties: resolvedProps } as FalkorNode }]);

			const result = await repository.resolve("conflict-123", {
				status: "confirmed",
				resolutionAction: "invalidated_memory_b",
			});

			expect(result.resolutionAction).toBe("invalidated_memory_b");
		});
	});

	describe("dismiss", () => {
		it("should dismiss conflict report", async () => {
			const existingProps = createConflictReportProps();
			const dismissedProps = createConflictReportProps({
				status: "dismissed",
				reviewed_by: "user-123",
			});

			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ c: { properties: existingProps } as FalkorNode }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ c: { properties: dismissedProps } as FalkorNode }]);

			const result = await repository.dismiss("conflict-123", "user-123");

			expect(result.status).toBe("dismissed");
			expect(result.reviewedBy).toBe("user-123");
		});
	});

	describe("findActive", () => {
		it("should find all active conflict reports for org", async () => {
			const props1 = createConflictReportProps({ id: "c1" });
			const props2 = createConflictReportProps({ id: "c2" });

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props1 } as FalkorNode },
				{ c: { properties: props2 } as FalkorNode },
			]);

			const result = await repository.findActive("org-123");

			expect(result).toHaveLength(2);

			const calls = (mockClient.query as ReturnType<typeof mock>).mock.calls;
			const [query, params] = calls[0] as [string, Record<string, unknown>];
			expect(query).toContain("{org_id: $orgId}");
			expect(params.orgId).toBe("org-123");
		});
	});

	describe("getStats", () => {
		it("should return statistics by status", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ status: "pending_review", count: 5 },
				{ status: "confirmed", count: 3 },
				{ status: "dismissed", count: 2 },
				{ status: "auto_resolved", count: 1 },
			]);

			const result = await repository.getStats("org-123");

			expect(result.pending).toBe(5);
			expect(result.confirmed).toBe(3);
			expect(result.dismissed).toBe(2);
			expect(result.autoResolved).toBe(1);
		});

		it("should return zeros when no reports exist", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.getStats("org-123");

			expect(result.pending).toBe(0);
			expect(result.confirmed).toBe(0);
			expect(result.dismissed).toBe(0);
			expect(result.autoResolved).toBe(0);
		});
	});

	describe("delete", () => {
		it("should soft delete existing conflict report", async () => {
			const props = createConflictReportProps();

			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ c: { properties: props } as FalkorNode }])
				.mockResolvedValueOnce([]);

			await repository.delete("conflict-123");

			const calls = (mockClient.query as ReturnType<typeof mock>).mock.calls;
			expect(calls).toHaveLength(2);
			const [deleteQuery] = calls[1] as [string, unknown];
			expect(deleteQuery).toContain("SET n.tt_end = $t");
		});

		it("should throw error if conflict report not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.delete("nonexistent")).rejects.toThrow(
				"ConflictReport not found: nonexistent",
			);
		});
	});

	describe("mapToConflictReport", () => {
		it("should correctly map all fields", async () => {
			const props = createConflictReportProps({
				reviewed_at: mockNow + 1000,
				reviewed_by: "user-123",
				resolution_action: "invalidated_memory_b",
				project: "my-project",
			});

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props } as FalkorNode },
			]);

			const result = await repository.findById("conflict-123");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("conflict-123");
			expect(result?.memoryIdA).toBe("mem-a");
			expect(result?.memoryIdB).toBe("mem-b");
			expect(result?.relation).toBe("contradicts");
			expect(result?.confidence).toBe(0.9);
			expect(result?.reasoning).toBe("These memories contain conflicting information");
			expect(result?.modelUsed).toBe("gpt-4");
			expect(result?.status).toBe("pending_review");
			expect(result?.reviewedAt).toBe(mockNow + 1000);
			expect(result?.reviewedBy).toBe("user-123");
			expect(result?.suggestedAction).toBe("invalidate_older");
			expect(result?.resolutionAction).toBe("invalidated_memory_b");
			expect(result?.scanId).toBe("scan-001");
			expect(result?.scannedAt).toBe(mockNow);
			expect(result?.orgId).toBe("org-123");
			expect(result?.project).toBe("my-project");
			expect(result?.vtStart).toBe(mockNow);
			expect(result?.vtEnd).toBe(MAX_DATE);
			expect(result?.ttStart).toBe(mockNow);
			expect(result?.ttEnd).toBe(MAX_DATE);
		});

		it("should return null for invalid node structure", async () => {
			// When the query returns a result without valid node structure,
			// findById returns null (the node check in line 57 catches this)
			spyOn(mockClient, "query").mockResolvedValueOnce([{ c: null }]);

			const result = await repository.findById("conflict-123");

			expect(result).toBeNull();
		});
	});
});
