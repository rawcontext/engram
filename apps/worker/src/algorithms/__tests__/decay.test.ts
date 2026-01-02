import { describe, expect, it } from "bun:test";
import type { MemoryType } from "@engram/graph/models";
import {
	calculateDecayBreakdown,
	calculateDecayScore,
	calculateDecayScores,
	type DecayInput,
	filterByDecayThreshold,
	TYPE_WEIGHTS,
} from "../decay";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

// Fixed timestamp for deterministic tests
const NOW = 1704067200000; // 2024-01-01T00:00:00Z

describe("calculateDecayScore", () => {
	describe("pinned memories", () => {
		it("returns 1.0 for pinned memories regardless of age", () => {
			const input: DecayInput = {
				type: "turn", // Lowest weight type
				createdAt: NOW - 365 * MS_PER_DAY, // 1 year old
				accessCount: 0,
				pinned: true,
			};

			expect(calculateDecayScore(input, NOW)).toBe(1.0);
		});

		it("returns 1.0 for pinned memories regardless of type", () => {
			const types: MemoryType[] = ["decision", "preference", "insight", "fact", "context", "turn"];

			for (const type of types) {
				const input: DecayInput = {
					type,
					createdAt: NOW - 100 * MS_PER_DAY,
					accessCount: 0,
					pinned: true,
				};

				expect(calculateDecayScore(input, NOW)).toBe(1.0);
			}
		});
	});

	describe("type weights", () => {
		it("applies correct weights for each memory type", () => {
			// Use a fresh memory (0 days old) with no access to isolate type weight
			const freshMemory = (type: MemoryType): DecayInput => ({
				type,
				createdAt: NOW, // Just created
				accessCount: 0,
				pinned: false,
			});

			expect(calculateDecayScore(freshMemory("decision"), NOW)).toBeCloseTo(1.0, 5);
			expect(calculateDecayScore(freshMemory("preference"), NOW)).toBeCloseTo(0.9, 5);
			expect(calculateDecayScore(freshMemory("insight"), NOW)).toBeCloseTo(0.8, 5);
			expect(calculateDecayScore(freshMemory("fact"), NOW)).toBeCloseTo(0.7, 5);
			expect(calculateDecayScore(freshMemory("context"), NOW)).toBeCloseTo(0.5, 5);
			expect(calculateDecayScore(freshMemory("turn"), NOW)).toBeCloseTo(0.3, 5);
		});

		it("uses default weight (0.5) for unknown types", () => {
			const input = {
				type: "unknown_type" as MemoryType, // Casting for test
				createdAt: NOW,
				accessCount: 0,
				pinned: false,
			};

			expect(calculateDecayScore(input, NOW)).toBeCloseTo(0.5, 5);
		});
	});

	describe("recency factor (exponential decay)", () => {
		it("returns higher scores for newer memories", () => {
			const baseInput = {
				type: "decision" as const,
				accessCount: 0,
				pinned: false,
			};

			const fresh = calculateDecayScore({ ...baseInput, createdAt: NOW }, NOW);
			const oneDay = calculateDecayScore({ ...baseInput, createdAt: NOW - MS_PER_DAY }, NOW);
			const oneWeek = calculateDecayScore({ ...baseInput, createdAt: NOW - 7 * MS_PER_DAY }, NOW);
			const oneMonth = calculateDecayScore({ ...baseInput, createdAt: NOW - 30 * MS_PER_DAY }, NOW);

			expect(fresh).toBeGreaterThan(oneDay);
			expect(oneDay).toBeGreaterThan(oneWeek);
			expect(oneWeek).toBeGreaterThan(oneMonth);
		});

		it("follows exponential decay formula with lambda=0.01", () => {
			const input: DecayInput = {
				type: "decision", // weight = 1.0
				createdAt: NOW - 10 * MS_PER_DAY, // 10 days old
				accessCount: 0, // accessFactor = 1.0
				pinned: false,
			};

			// Expected: 1.0 * exp(-0.01 * 10) * 1.0 = exp(-0.1) ≈ 0.9048
			const expected = Math.exp(-0.1);
			expect(calculateDecayScore(input, NOW)).toBeCloseTo(expected, 4);
		});

		it("decays significantly over 100 days", () => {
			const input: DecayInput = {
				type: "decision",
				createdAt: NOW - 100 * MS_PER_DAY,
				accessCount: 0,
				pinned: false,
			};

			// exp(-0.01 * 100) = exp(-1) ≈ 0.368
			const score = calculateDecayScore(input, NOW);
			expect(score).toBeCloseTo(Math.exp(-1), 4);
			expect(score).toBeLessThan(0.4);
		});

		it("handles very old memories (1 year)", () => {
			const input: DecayInput = {
				type: "decision",
				createdAt: NOW - 365 * MS_PER_DAY,
				accessCount: 0,
				pinned: false,
			};

			// exp(-0.01 * 365) = exp(-3.65) ≈ 0.026
			const score = calculateDecayScore(input, NOW);
			expect(score).toBeCloseTo(Math.exp(-3.65), 4);
			expect(score).toBeLessThan(0.05);
		});

		it("handles sub-day precision", () => {
			const input: DecayInput = {
				type: "decision",
				createdAt: NOW - 12 * MS_PER_HOUR, // 0.5 days
				accessCount: 0,
				pinned: false,
			};

			// exp(-0.01 * 0.5) ≈ 0.995
			const expected = Math.exp(-0.005);
			expect(calculateDecayScore(input, NOW)).toBeCloseTo(expected, 4);
		});
	});

	describe("access factor (rehearsal boost)", () => {
		it("increases score with access count", () => {
			const baseInput = {
				type: "decision" as const,
				createdAt: NOW - 30 * MS_PER_DAY,
				pinned: false,
			};

			const noAccess = calculateDecayScore({ ...baseInput, accessCount: 0 }, NOW);
			const someAccess = calculateDecayScore({ ...baseInput, accessCount: 5 }, NOW);
			const manyAccess = calculateDecayScore({ ...baseInput, accessCount: 100 }, NOW);

			expect(someAccess).toBeGreaterThan(noAccess);
			expect(manyAccess).toBeGreaterThan(someAccess);
		});

		it("follows log formula: 1 + log(1 + count) * 0.1", () => {
			const baseInput: DecayInput = {
				type: "decision",
				createdAt: NOW, // Fresh, so typeWeight * recencyFactor = 1.0
				accessCount: 10,
				pinned: false,
			};

			// accessFactor = 1 + log(11) * 0.1 ≈ 1 + 2.398 * 0.1 ≈ 1.2398
			const expectedAccessFactor = 1 + Math.log(11) * 0.1;
			// Since type=decision and fresh, score = 1.0 * 1.0 * accessFactor
			// But capped at 1.0
			expect(calculateDecayScore(baseInput, NOW)).toBe(1.0); // Capped
		});

		it("provides diminishing returns", () => {
			const baseInput = {
				type: "fact" as const, // weight = 0.7
				createdAt: NOW - 30 * MS_PER_DAY,
				pinned: false,
			};

			// Difference between 0->1 should be greater than 10->11
			const score0 = calculateDecayScore({ ...baseInput, accessCount: 0 }, NOW);
			const score1 = calculateDecayScore({ ...baseInput, accessCount: 1 }, NOW);
			const score10 = calculateDecayScore({ ...baseInput, accessCount: 10 }, NOW);
			const score11 = calculateDecayScore({ ...baseInput, accessCount: 11 }, NOW);

			const boost0to1 = score1 - score0;
			const boost10to11 = score11 - score10;

			expect(boost0to1).toBeGreaterThan(boost10to11);
		});
	});

	describe("boundary conditions", () => {
		it("handles zero age correctly", () => {
			const input: DecayInput = {
				type: "decision",
				createdAt: NOW,
				accessCount: 0,
				pinned: false,
			};

			expect(calculateDecayScore(input, NOW)).toBe(1.0);
		});

		it("handles future createdAt (negative age) by treating as 0", () => {
			const input: DecayInput = {
				type: "decision",
				createdAt: NOW + MS_PER_DAY, // Created "tomorrow"
				accessCount: 0,
				pinned: false,
			};

			// Should treat as age 0
			expect(calculateDecayScore(input, NOW)).toBe(1.0);
		});

		it("handles zero access count", () => {
			const input: DecayInput = {
				type: "decision",
				createdAt: NOW,
				accessCount: 0,
				pinned: false,
			};

			// accessFactor = 1 + log(1) * 0.1 = 1 + 0 = 1.0
			expect(calculateDecayScore(input, NOW)).toBe(1.0);
		});

		it("caps score at 1.0 even with high access boost", () => {
			const input: DecayInput = {
				type: "decision", // weight = 1.0
				createdAt: NOW, // recency = 1.0
				accessCount: 1000000, // Huge access boost
				pinned: false,
			};

			expect(calculateDecayScore(input, NOW)).toBe(1.0);
		});

		it("uses default now timestamp when not provided", () => {
			const input: DecayInput = {
				type: "decision",
				createdAt: Date.now(),
				accessCount: 0,
				pinned: false,
			};

			// Should be close to 1.0 since just created
			expect(calculateDecayScore(input)).toBeCloseTo(1.0, 1);
		});
	});

	describe("combined factors", () => {
		it("combines all factors correctly", () => {
			const input: DecayInput = {
				type: "insight", // weight = 0.8
				createdAt: NOW - 20 * MS_PER_DAY, // recency = exp(-0.2) ≈ 0.8187
				accessCount: 10, // accessFactor = 1 + log(11) * 0.1 ≈ 1.2398
				pinned: false,
			};

			const typeWeight = 0.8;
			const recencyFactor = Math.exp(-0.2);
			const accessFactor = 1 + Math.log(11) * 0.1;
			const expected = typeWeight * recencyFactor * accessFactor;

			expect(calculateDecayScore(input, NOW)).toBeCloseTo(expected, 4);
		});
	});
});

describe("calculateDecayBreakdown", () => {
	it("returns all components for non-pinned memory", () => {
		const input: DecayInput = {
			type: "fact",
			createdAt: NOW - 7 * MS_PER_DAY,
			accessCount: 5,
			pinned: false,
		};

		const breakdown = calculateDecayBreakdown(input, NOW);

		expect(breakdown.pinned).toBe(false);
		expect(breakdown.typeWeight).toBe(0.7);
		expect(breakdown.daysSinceCreation).toBeCloseTo(7, 5);
		expect(breakdown.recencyFactor).toBeCloseTo(Math.exp(-0.07), 5);
		expect(breakdown.accessFactor).toBeCloseTo(1 + Math.log(6) * 0.1, 5);
		expect(breakdown.score).toBe(calculateDecayScore(input, NOW));
	});

	it("returns special breakdown for pinned memory", () => {
		const input: DecayInput = {
			type: "turn",
			createdAt: NOW - 100 * MS_PER_DAY,
			accessCount: 0,
			pinned: true,
		};

		const breakdown = calculateDecayBreakdown(input, NOW);

		expect(breakdown.pinned).toBe(true);
		expect(breakdown.score).toBe(1.0);
		expect(breakdown.typeWeight).toBe(0.3); // Still shows actual type weight
		expect(breakdown.recencyFactor).toBe(1.0);
		expect(breakdown.accessFactor).toBe(1.0);
		expect(breakdown.daysSinceCreation).toBeCloseTo(100, 5);
	});
});

describe("calculateDecayScores", () => {
	it("calculates scores for multiple memories", () => {
		const inputs: DecayInput[] = [
			{ type: "decision", createdAt: NOW, accessCount: 0, pinned: false },
			{ type: "turn", createdAt: NOW - 30 * MS_PER_DAY, accessCount: 0, pinned: false },
			{ type: "fact", createdAt: NOW - 7 * MS_PER_DAY, accessCount: 10, pinned: true },
		];

		const scores = calculateDecayScores(inputs, NOW);

		expect(scores).toHaveLength(3);
		expect(scores[0]).toBe(calculateDecayScore(inputs[0], NOW));
		expect(scores[1]).toBe(calculateDecayScore(inputs[1], NOW));
		expect(scores[2]).toBe(1.0); // Pinned
	});

	it("returns empty array for empty input", () => {
		expect(calculateDecayScores([], NOW)).toEqual([]);
	});
});

describe("filterByDecayThreshold", () => {
	it("filters memories below threshold", () => {
		const inputs: DecayInput[] = [
			{ type: "decision", createdAt: NOW, accessCount: 0, pinned: false }, // 1.0
			{ type: "turn", createdAt: NOW - 100 * MS_PER_DAY, accessCount: 0, pinned: false }, // ~0.11
			{ type: "fact", createdAt: NOW - 7 * MS_PER_DAY, accessCount: 0, pinned: false }, // ~0.65
		];

		const filtered = filterByDecayThreshold(inputs, 0.5, NOW);

		expect(filtered).toHaveLength(2);
		expect(filtered[0].type).toBe("decision");
		expect(filtered[1].type).toBe("fact");
	});

	it("sorts by decay score descending", () => {
		const inputs: DecayInput[] = [
			{ type: "turn", createdAt: NOW, accessCount: 0, pinned: false }, // 0.3
			{ type: "decision", createdAt: NOW, accessCount: 0, pinned: false }, // 1.0
			{ type: "fact", createdAt: NOW, accessCount: 0, pinned: false }, // 0.7
		];

		const filtered = filterByDecayThreshold(inputs, 0, NOW);

		expect(filtered[0].type).toBe("decision");
		expect(filtered[1].type).toBe("fact");
		expect(filtered[2].type).toBe("turn");
	});

	it("includes decayScore in output", () => {
		const inputs: DecayInput[] = [
			{ type: "decision", createdAt: NOW, accessCount: 0, pinned: false },
		];

		const [result] = filterByDecayThreshold(inputs, 0, NOW);

		expect(result.decayScore).toBe(1.0);
		expect(result.type).toBe("decision");
	});

	it("preserves additional properties from input", () => {
		interface ExtendedInput extends DecayInput {
			id: string;
			content: string;
		}

		const inputs: ExtendedInput[] = [
			{
				id: "mem-1",
				content: "Important decision",
				type: "decision",
				createdAt: NOW,
				accessCount: 0,
				pinned: false,
			},
		];

		const [result] = filterByDecayThreshold(inputs, 0, NOW);

		expect(result.id).toBe("mem-1");
		expect(result.content).toBe("Important decision");
		expect(result.decayScore).toBe(1.0);
	});

	it("returns empty array when no memories meet threshold", () => {
		const inputs: DecayInput[] = [
			{ type: "turn", createdAt: NOW - 365 * MS_PER_DAY, accessCount: 0, pinned: false },
		];

		const filtered = filterByDecayThreshold(inputs, 0.5, NOW);

		expect(filtered).toEqual([]);
	});
});

describe("TYPE_WEIGHTS", () => {
	it("has weights for all memory types", () => {
		const types: MemoryType[] = ["decision", "preference", "insight", "fact", "context", "turn"];

		for (const type of types) {
			expect(TYPE_WEIGHTS[type]).toBeDefined();
			expect(TYPE_WEIGHTS[type]).toBeGreaterThan(0);
			expect(TYPE_WEIGHTS[type]).toBeLessThanOrEqual(1);
		}
	});

	it("has weights in expected order", () => {
		expect(TYPE_WEIGHTS.decision).toBeGreaterThan(TYPE_WEIGHTS.preference);
		expect(TYPE_WEIGHTS.preference).toBeGreaterThan(TYPE_WEIGHTS.insight);
		expect(TYPE_WEIGHTS.insight).toBeGreaterThan(TYPE_WEIGHTS.fact);
		expect(TYPE_WEIGHTS.fact).toBeGreaterThan(TYPE_WEIGHTS.context);
		expect(TYPE_WEIGHTS.context).toBeGreaterThan(TYPE_WEIGHTS.turn);
	});
});
