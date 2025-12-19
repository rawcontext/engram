import { describe, expect, it } from "vitest";
import type { LatencyMetrics } from "../../src/longmemeval/pipeline.js";

/**
 * Helper to compute latency metrics (mirrors the private function in pipeline.ts)
 */
function computeLatencyMetrics(latencies: number[], totalDurationMs: number): LatencyMetrics {
	if (latencies.length === 0) {
		return {
			perQueryLatencies: [],
			p50: 0,
			p95: 0,
			p99: 0,
			mean: 0,
			totalDurationMs,
		};
	}

	const sorted = [...latencies].sort((a, b) => a - b);
	const len = sorted.length;

	const p50Index = Math.floor(len * 0.5);
	const p95Index = Math.min(Math.floor(len * 0.95), len - 1);
	const p99Index = Math.min(Math.floor(len * 0.99), len - 1);

	const sum = latencies.reduce((acc, val) => acc + val, 0);
	const mean = sum / len;

	return {
		perQueryLatencies: latencies,
		p50: sorted[p50Index],
		p95: sorted[p95Index],
		p99: sorted[p99Index],
		mean: Math.round(mean),
		totalDurationMs,
	};
}

describe("computeLatencyMetrics", () => {
	it("should return zeros for empty array", () => {
		const result = computeLatencyMetrics([], 1000);

		expect(result.p50).toBe(0);
		expect(result.p95).toBe(0);
		expect(result.p99).toBe(0);
		expect(result.mean).toBe(0);
		expect(result.perQueryLatencies).toEqual([]);
		expect(result.totalDurationMs).toBe(1000);
	});

	it("should compute correct percentiles for 100 uniform samples", () => {
		// Create 100 samples from 1 to 100
		const latencies = Array.from({ length: 100 }, (_, i) => i + 1);

		const result = computeLatencyMetrics(latencies, 5000);

		// p50 should be around 50
		expect(result.p50).toBe(51); // floor(100 * 0.5) = 50, sorted[50] = 51
		// p95 should be around 95
		expect(result.p95).toBe(96); // floor(100 * 0.95) = 95, sorted[95] = 96
		// p99 should be around 99
		expect(result.p99).toBe(100); // floor(100 * 0.99) = 99, sorted[99] = 100
		// mean should be 50.5
		expect(result.mean).toBe(51); // (1+100)/2 = 50.5, rounded = 51
	});

	it("should handle single element", () => {
		const result = computeLatencyMetrics([42], 100);

		expect(result.p50).toBe(42);
		expect(result.p95).toBe(42);
		expect(result.p99).toBe(42);
		expect(result.mean).toBe(42);
	});

	it("should handle two elements", () => {
		const result = computeLatencyMetrics([10, 20], 100);

		// With 2 elements, floor(2 * 0.5) = 1, sorted[1] = 20
		expect(result.p50).toBe(20);
		// floor(2 * 0.95) = 1, sorted[1] = 20
		expect(result.p95).toBe(20);
		// floor(2 * 0.99) = 1, sorted[1] = 20
		expect(result.p99).toBe(20);
		expect(result.mean).toBe(15);
	});

	it("should preserve original latencies", () => {
		const latencies = [100, 50, 200, 150];

		const result = computeLatencyMetrics(latencies, 500);

		expect(result.perQueryLatencies).toEqual(latencies);
	});

	it("should sort correctly for percentile computation", () => {
		// Out of order latencies
		const latencies = [500, 100, 300, 200, 400];

		const result = computeLatencyMetrics(latencies, 1000);

		// Sorted: [100, 200, 300, 400, 500]
		// p50: floor(5 * 0.5) = 2, sorted[2] = 300
		expect(result.p50).toBe(300);
		// p95: min(floor(5 * 0.95), 4) = min(4, 4) = 4, sorted[4] = 500
		expect(result.p95).toBe(500);
		// p99: min(floor(5 * 0.99), 4) = min(4, 4) = 4, sorted[4] = 500
		expect(result.p99).toBe(500);
	});

	it("should correctly compute mean with varying values", () => {
		const latencies = [10, 20, 30, 40, 50];
		const expectedMean = (10 + 20 + 30 + 40 + 50) / 5; // 30

		const result = computeLatencyMetrics(latencies, 1000);

		expect(result.mean).toBe(expectedMean);
	});

	it("should round mean to integer", () => {
		const latencies = [10, 11, 12]; // mean = 11
		const result = computeLatencyMetrics(latencies, 100);
		expect(result.mean).toBe(11);

		const latencies2 = [10, 11]; // mean = 10.5
		const result2 = computeLatencyMetrics(latencies2, 100);
		expect(result2.mean).toBe(11); // rounded up
	});
});

describe("LatencyMetrics interface", () => {
	it("should have all required fields", () => {
		const metrics: LatencyMetrics = {
			perQueryLatencies: [10, 20, 30],
			p50: 20,
			p95: 30,
			p99: 30,
			mean: 20,
			totalDurationMs: 100,
		};

		expect(metrics.perQueryLatencies).toHaveLength(3);
		expect(metrics.p50).toBeDefined();
		expect(metrics.p95).toBeDefined();
		expect(metrics.p99).toBeDefined();
		expect(metrics.mean).toBeDefined();
		expect(metrics.totalDurationMs).toBeDefined();
	});
});
