import { describe, expect, it } from "vitest";
import { type Bitemporal, createBitemporal, MAX_DATE, now } from "./time";

describe("Time Utils", () => {
	describe("MAX_DATE constant", () => {
		it("should export MAX_DATE", () => {
			expect(MAX_DATE).toBe(253402300799000);
		});

		it("should represent a date far in the future", () => {
			const date = new Date(MAX_DATE);
			expect(date.getFullYear()).toBe(9999);
		});
	});

	describe("now function", () => {
		it("should return current timestamp", () => {
			const before = Date.now();
			const result = now();
			const after = Date.now();

			expect(result).toBeGreaterThanOrEqual(before);
			expect(result).toBeLessThanOrEqual(after);
		});

		it("should return a number", () => {
			expect(typeof now()).toBe("number");
		});
	});

	describe("createBitemporal", () => {
		it("should create bitemporal timestamps with defaults", () => {
			const before = Date.now();
			const ts = createBitemporal();
			const after = Date.now();

			expect(ts.vt_start).toBeGreaterThanOrEqual(before);
			expect(ts.vt_start).toBeLessThanOrEqual(after);
			expect(ts.vt_end).toBe(MAX_DATE);
			expect(ts.tt_start).toBeGreaterThanOrEqual(before);
			expect(ts.tt_start).toBeLessThanOrEqual(after);
			expect(ts.tt_end).toBe(MAX_DATE);
		});

		it("should accept explicit valid time", () => {
			const explicitTime = 1000;
			const ts = createBitemporal(explicitTime);

			expect(ts.vt_start).toBe(explicitTime);
			expect(ts.vt_end).toBe(MAX_DATE);
		});

		it("should set transaction time to current time regardless of valid time", () => {
			const pastTime = 1000; // Way in the past
			const before = Date.now();
			const ts = createBitemporal(pastTime);
			const after = Date.now();

			expect(ts.vt_start).toBe(pastTime);
			expect(ts.tt_start).toBeGreaterThanOrEqual(before);
			expect(ts.tt_start).toBeLessThanOrEqual(after);
		});

		it("should return Bitemporal type with all required fields", () => {
			const ts: Bitemporal = createBitemporal();

			expect(ts).toHaveProperty("vt_start");
			expect(ts).toHaveProperty("vt_end");
			expect(ts).toHaveProperty("tt_start");
			expect(ts).toHaveProperty("tt_end");
		});

		it("should handle future valid time", () => {
			const futureTime = Date.now() + 86400000; // Tomorrow
			const ts = createBitemporal(futureTime);

			expect(ts.vt_start).toBe(futureTime);
			expect(ts.vt_start).toBeGreaterThan(ts.tt_start);
		});

		it("should handle zero timestamp", () => {
			const ts = createBitemporal(0);

			expect(ts.vt_start).toBe(0);
			expect(ts.vt_end).toBe(MAX_DATE);
		});
	});
});
