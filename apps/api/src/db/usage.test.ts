import { describe, expect, it, vi } from "vitest";
import { UsageRepository } from "./usage";

describe("UsageRepository", () => {
	const createMockDb = () => ({
		query: vi.fn(),
		queryOne: vi.fn(),
		queryMany: vi.fn(),
	});

	describe("trackRequest", () => {
		it("should insert/update usage with correct period", async () => {
			const mockDb = createMockDb();
			mockDb.query.mockResolvedValue(undefined);

			const repo = new UsageRepository(mockDb as any);
			await repo.trackRequest("key-123", "memory:remember");

			expect(mockDb.query).toHaveBeenCalledWith(
				expect.stringContaining("INSERT INTO api_usage"),
				expect.arrayContaining([
					"key-123",
					expect.any(Date), // periodStart
					expect.any(Date), // periodEnd
					0, // isError = false -> 0
					expect.stringContaining("memory:remember"), // operations JSON
					"memory:remember", // operation key
				]),
			);
		});

		it("should track errors correctly", async () => {
			const mockDb = createMockDb();
			mockDb.query.mockResolvedValue(undefined);

			const repo = new UsageRepository(mockDb as any);
			await repo.trackRequest("key-123", "memory:recall", true);

			expect(mockDb.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.arrayContaining([
					"key-123",
					expect.any(Date),
					expect.any(Date),
					1, // isError = true -> 1
					expect.any(String),
					"memory:recall",
				]),
			);
		});

		it("should use 1-hour periods", async () => {
			const mockDb = createMockDb();
			mockDb.query.mockResolvedValue(undefined);

			const repo = new UsageRepository(mockDb as any);
			await repo.trackRequest("key-123", "test");

			const callArgs = mockDb.query.mock.calls[0][1];
			const periodStart = callArgs[1] as Date;
			const periodEnd = callArgs[2] as Date;

			// Period should be 1 hour
			expect(periodEnd.getTime() - periodStart.getTime()).toBe(60 * 60 * 1000);

			// Period start should be at the top of the hour
			expect(periodStart.getMinutes()).toBe(0);
			expect(periodStart.getSeconds()).toBe(0);
		});
	});

	describe("getUsageStats", () => {
		const sampleDbRow = {
			api_key_id: "key-123",
			period_start: new Date("2024-01-01T10:00:00Z"),
			period_end: new Date("2024-01-01T11:00:00Z"),
			request_count: 100,
			error_count: 5,
			operations: { "memory:remember": 50, "memory:recall": 50 },
			created_at: new Date("2024-01-01T10:00:00Z"),
			updated_at: new Date("2024-01-01T10:30:00Z"),
		};

		it("should return usage periods for api key", async () => {
			const mockDb = createMockDb();
			mockDb.queryMany.mockResolvedValue([sampleDbRow]);

			const repo = new UsageRepository(mockDb as any);
			const result = await repo.getUsageStats("key-123");

			expect(result).toHaveLength(1);
			expect(result[0].apiKeyId).toBe("key-123");
			expect(result[0].requestCount).toBe(100);
			expect(result[0].errorCount).toBe(5);
			expect(result[0].operations).toEqual({
				"memory:remember": 50,
				"memory:recall": 50,
			});
		});

		it("should use default date range of 30 days", async () => {
			const mockDb = createMockDb();
			mockDb.queryMany.mockResolvedValue([]);

			const repo = new UsageRepository(mockDb as any);
			await repo.getUsageStats("key-123");

			const callArgs = mockDb.queryMany.mock.calls[0][1];
			const startDate = callArgs[1] as Date;
			const endDate = callArgs[2] as Date;

			// Start date should be roughly 30 days ago
			const daysDiff = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
			expect(daysDiff).toBeCloseTo(30, 0);
		});

		it("should use custom date range", async () => {
			const mockDb = createMockDb();
			mockDb.queryMany.mockResolvedValue([]);

			const repo = new UsageRepository(mockDb as any);
			const startDate = new Date("2024-01-01");
			const endDate = new Date("2024-01-15");

			await repo.getUsageStats("key-123", { startDate, endDate });

			expect(mockDb.queryMany).toHaveBeenCalledWith(
				expect.any(String),
				expect.arrayContaining(["key-123", startDate, endDate, 100]),
			);
		});

		it("should use custom limit", async () => {
			const mockDb = createMockDb();
			mockDb.queryMany.mockResolvedValue([]);

			const repo = new UsageRepository(mockDb as any);
			await repo.getUsageStats("key-123", { limit: 50 });

			const callArgs = mockDb.queryMany.mock.calls[0][1];
			expect(callArgs[3]).toBe(50);
		});
	});

	describe("getUsageSummary", () => {
		it("should return aggregated summary", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue({
				total_requests: 1000,
				total_errors: 25,
				operations: { "memory:remember": 600, "memory:recall": 400 },
			});

			const repo = new UsageRepository(mockDb as any);
			const result = await repo.getUsageSummary("key-123");

			expect(result.totalRequests).toBe(1000);
			expect(result.totalErrors).toBe(25);
			expect(result.operations).toEqual({
				"memory:remember": 600,
				"memory:recall": 400,
			});
		});

		it("should return zeros when no usage found", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue(null);

			const repo = new UsageRepository(mockDb as any);
			const result = await repo.getUsageSummary("key-123");

			expect(result.totalRequests).toBe(0);
			expect(result.totalErrors).toBe(0);
			expect(result.operations).toEqual({});
		});

		it("should use custom date range", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue(null);

			const repo = new UsageRepository(mockDb as any);
			const startDate = new Date("2024-01-01");
			const endDate = new Date("2024-01-15");

			const result = await repo.getUsageSummary("key-123", { startDate, endDate });

			expect(result.periodStart).toEqual(startDate);
			expect(result.periodEnd).toEqual(endDate);
		});
	});
});
