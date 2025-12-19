import { describe, expect, it, beforeEach } from "vitest";
import { TemporalQueryParser, buildTemporalFilter, applyRecencyBoost } from "./temporal-parser";

describe("TemporalQueryParser", () => {
	let parser: TemporalQueryParser;

	beforeEach(() => {
		// Use a fixed reference date for consistent tests
		parser = new TemporalQueryParser(new Date("2024-12-18T12:00:00Z"));
	});

	describe("parse", () => {
		it("should parse 'last week' as relative temporal expression", () => {
			const result = parser.parse("What did we discuss last week?");

			expect(result.temporalFilter).not.toBeNull();
			expect(result.temporalFilter?.expression).toBe("last week");
			expect(result.temporalFilter?.after).toBeInstanceOf(Date);
			expect(result.temporalFilter?.before).toBeInstanceOf(Date);
			expect(result.semanticQuery).toBe("What did we discuss?");
			expect(result.confidence).toBeGreaterThan(0);
		});

		it("should parse 'yesterday' as single day", () => {
			const result = parser.parse("Show me yesterday's logs");

			expect(result.temporalFilter).not.toBeNull();
			expect(result.temporalFilter?.expression).toBe("yesterday");
		});

		it("should parse absolute date 'January 2024'", () => {
			const result = parser.parse("What happened in January 2024?");

			expect(result.temporalFilter).not.toBeNull();
			expect(result.temporalFilter?.after?.getMonth()).toBe(0); // January
			expect(result.temporalFilter?.after?.getFullYear()).toBe(2024);
		});

		it("should return null filter for queries without temporal expressions", () => {
			const result = parser.parse("How do I implement authentication?");

			expect(result.temporalFilter).toBeNull();
			expect(result.semanticQuery).toBe("How do I implement authentication?");
			expect(result.confidence).toBe(0);
		});

		it("should detect recency intent with 'latest'", () => {
			const result = parser.parse("Show me the latest updates from last week");

			expect(result.temporalFilter?.sortByRecency).toBe(true);
		});

		it("should detect recency intent with 'recent'", () => {
			// 'recent' alone may not be parsed as a temporal expression by chrono
			// but the recency detection should still work when there's a temporal filter
			const result = parser.parse("What are the most recent changes from last week?");

			expect(result.temporalFilter?.sortByRecency).toBe(true);
		});

		it("should handle '3 days ago'", () => {
			const result = parser.parse("What was discussed 3 days ago?");

			expect(result.temporalFilter).not.toBeNull();
			expect(result.temporalFilter?.expression).toContain("3 days ago");
		});
	});

	describe("setReferenceDate", () => {
		it("should update reference date for relative expressions", () => {
			const parser1 = new TemporalQueryParser(new Date("2024-12-18"));
			const result1 = parser1.parse("What happened yesterday?");

			const parser2 = new TemporalQueryParser(new Date("2024-01-01"));
			const result2 = parser2.parse("What happened yesterday?");

			// Different reference dates should produce different temporal filters
			expect(result1.temporalFilter?.after?.getTime()).not.toBe(
				result2.temporalFilter?.after?.getTime(),
			);
		});
	});
});

describe("buildTemporalFilter", () => {
	it("should build Qdrant filter with after constraint", () => {
		const filter = buildTemporalFilter({
			after: new Date("2024-12-11T00:00:00Z"),
		});

		expect(filter).not.toBeNull();
		expect(filter?.must).toHaveLength(1);
		expect(filter?.must[0].key).toBe("valid_time");
		expect(filter?.must[0].range.gte).toBe("2024-12-11T00:00:00.000Z");
	});

	it("should build Qdrant filter with before constraint", () => {
		const filter = buildTemporalFilter({
			before: new Date("2024-12-18T00:00:00Z"),
		});

		expect(filter).not.toBeNull();
		expect(filter?.must).toHaveLength(1);
		expect(filter?.must[0].range.lte).toBe("2024-12-18T00:00:00.000Z");
	});

	it("should build Qdrant filter with both constraints", () => {
		const filter = buildTemporalFilter({
			after: new Date("2024-12-11T00:00:00Z"),
			before: new Date("2024-12-18T00:00:00Z"),
		});

		expect(filter?.must).toHaveLength(2);
	});

	it("should return null for empty filter", () => {
		const filter = buildTemporalFilter({});

		expect(filter).toBeNull();
	});

	it("should use custom field name", () => {
		const filter = buildTemporalFilter({ after: new Date("2024-12-11") }, "timestamp");

		expect(filter?.must[0].key).toBe("timestamp");
	});
});

describe("applyRecencyBoost", () => {
	it("should boost recent results higher", () => {
		const referenceDate = new Date("2024-12-18T12:00:00Z");
		const results = [
			{ id: "old", score: 0.8, validTime: new Date("2024-11-01") },
			{ id: "recent", score: 0.8, validTime: new Date("2024-12-17") },
		];

		const boosted = applyRecencyBoost(results, referenceDate);

		// Recent result should have higher score after boost
		const recentResult = boosted.find((r) => r.id === "recent");
		const oldResult = boosted.find((r) => r.id === "old");

		expect(recentResult?.score).toBeGreaterThan(oldResult?.score ?? 0);
	});

	it("should sort results by boosted score", () => {
		const referenceDate = new Date("2024-12-18T12:00:00Z");
		const results = [
			{ id: "old", score: 0.9, validTime: new Date("2024-10-01") },
			{ id: "recent", score: 0.8, validTime: new Date("2024-12-17") },
		];

		const boosted = applyRecencyBoost(results, referenceDate, 0.2);

		// With high enough boost factor, recent should overtake old
		expect(boosted[0].id).toBe("recent");
	});

	it("should handle results without validTime", () => {
		const referenceDate = new Date("2024-12-18T12:00:00Z");
		const results = [
			{ id: "no-time", score: 0.8 },
			{ id: "has-time", score: 0.8, validTime: new Date("2024-12-17") },
		];

		const boosted = applyRecencyBoost(results, referenceDate);

		// Should not throw, results without validTime should keep original score
		expect(boosted.find((r) => r.id === "no-time")?.score).toBe(0.8);
	});
});
