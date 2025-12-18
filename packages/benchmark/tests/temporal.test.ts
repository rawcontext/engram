import { describe, it, expect } from "vitest";
import {
	TemporalAnalyzer,
	analyzeTemporalQuery,
	filterByTimeRange,
	type TimeRange,
} from "../src/longmemeval/temporal.js";

describe("Temporal Analysis", () => {
	const baseDate = new Date("2024-03-15T10:00:00Z");

	describe("TemporalAnalyzer", () => {
		const analyzer = new TemporalAnalyzer();

		it("should detect temporal queries", async () => {
			const result = await analyzer.analyze("What did I do yesterday?", baseDate);
			expect(result.isTemporalQuery).toBe(true);
			expect(result.temporalKeywords).toContain("yesterday");
		});

		it("should not flag non-temporal queries", async () => {
			const result = await analyzer.analyze("What is my favorite color?", baseDate);
			expect(result.isTemporalQuery).toBe(false);
		});

		it("should extract time range for 'yesterday'", async () => {
			const result = await analyzer.analyze("What happened yesterday?", baseDate);
			expect(result.timeRange).toBeDefined();
			expect(result.timeRange?.source).toBe("yesterday");

			const expectedDate = new Date("2024-03-14");
			expect(result.timeRange?.start.toISOString().split("T")[0]).toBe("2024-03-14");
		});

		it("should extract time range for 'last week'", async () => {
			const result = await analyzer.analyze("What did I do last week?", baseDate);
			expect(result.timeRange).toBeDefined();
			expect(result.timeRange?.source).toBe("last week");
		});

		it("should extract time range for 'last month'", async () => {
			const result = await analyzer.analyze("What happened last month?", baseDate);
			expect(result.timeRange).toBeDefined();
			expect(result.timeRange?.source).toBe("last month");
		});

		it("should extract time range for specific month", async () => {
			const result = await analyzer.analyze("What happened in January?", baseDate);
			expect(result.timeRange).toBeDefined();
			expect(result.timeRange?.start.getMonth()).toBe(0); // January
		});

		it("should extract time range for 'last N days'", async () => {
			const result = await analyzer.analyze("Show me the last 5 days", baseDate);
			expect(result.timeRange).toBeDefined();
			expect(result.timeRange?.source).toBe("last 5 days");
		});

		it("should detect temporal keywords", async () => {
			const result = await analyzer.analyze("When did I visit the doctor last month?", baseDate);
			expect(result.temporalKeywords).toContain("when");
			expect(result.temporalKeywords).toContain("last");
			expect(result.temporalKeywords).toContain("month");
		});

		it("should expand query with time context", async () => {
			const result = await analyzer.analyze("What happened yesterday?", baseDate);
			expect(result.expandedQuery).toContain("Time context:");
		});
	});

	describe("filterByTimeRange", () => {
		const documents = [
			{ id: "1", validTime: new Date("2024-03-10") },
			{ id: "2", validTime: new Date("2024-03-12") },
			{ id: "3", validTime: new Date("2024-03-14") },
			{ id: "4", validTime: new Date("2024-03-16") },
		];

		it("should filter documents within range", () => {
			const range: TimeRange = {
				start: new Date("2024-03-11"),
				end: new Date("2024-03-15"),
				confidence: "high",
				source: "test",
			};

			const filtered = filterByTimeRange(documents, range);
			expect(filtered).toHaveLength(2);
			expect(filtered.map((d) => d.id)).toEqual(["2", "3"]);
		});

		it("should return empty array when no matches", () => {
			const range: TimeRange = {
				start: new Date("2024-01-01"),
				end: new Date("2024-01-31"),
				confidence: "high",
				source: "test",
			};

			const filtered = filterByTimeRange(documents, range);
			expect(filtered).toHaveLength(0);
		});

		it("should include boundary dates", () => {
			const range: TimeRange = {
				start: new Date("2024-03-10T00:00:00Z"),
				end: new Date("2024-03-10T23:59:59Z"),
				confidence: "high",
				source: "test",
			};

			const filtered = filterByTimeRange(documents, range);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe("1");
		});
	});

	describe("analyzeTemporalQuery helper", () => {
		it("should analyze query", async () => {
			const result = await analyzeTemporalQuery("What did I do last week?", baseDate);
			expect(result.isTemporalQuery).toBe(true);
			expect(result.timeRange).toBeDefined();
		});
	});
});
