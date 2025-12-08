import { describe, expect, it } from "bun:test";
import { createBitemporal, MAX_DATE } from "./time";

describe("Time Utils", () => {
	it("should export MAX_DATE", () => {
		expect(MAX_DATE).toBe(253402300799000);
	});

	it("should create bitemporal timestamps", () => {
		const ts = createBitemporal();
		expect(ts.vt_start).toBeLessThanOrEqual(Date.now());
		expect(ts.vt_end).toBe(MAX_DATE);
		expect(ts.tt_start).toBeLessThanOrEqual(Date.now());
		expect(ts.tt_end).toBe(MAX_DATE);
	});

	it("should accept explicit valid time", () => {
		const explicitTime = 1000;
		const ts = createBitemporal(explicitTime);
		expect(ts.vt_start).toBe(explicitTime);
		expect(ts.vt_end).toBe(MAX_DATE);
	});
});
