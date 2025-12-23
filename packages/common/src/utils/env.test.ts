/**
 * Tests for @engram/common/utils/env
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { envArray, envBool, envFloat, envNum, envRequired, envStr } from "./env";

describe("env utilities", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		// Save original env
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		// Restore original env
		process.env = originalEnv;
	});

	describe("envBool", () => {
		it("should return true for 'true' (lowercase)", () => {
			process.env.TEST_BOOL = "true";
			expect(envBool("TEST_BOOL", false)).toBe(true);
		});

		it("should return true for 'TRUE' (uppercase)", () => {
			process.env.TEST_BOOL = "TRUE";
			expect(envBool("TEST_BOOL", false)).toBe(true);
		});

		it("should return true for '1'", () => {
			process.env.TEST_BOOL = "1";
			expect(envBool("TEST_BOOL", false)).toBe(true);
		});

		it("should return false for 'false'", () => {
			process.env.TEST_BOOL = "false";
			expect(envBool("TEST_BOOL", true)).toBe(false);
		});

		it("should return false for '0'", () => {
			process.env.TEST_BOOL = "0";
			expect(envBool("TEST_BOOL", true)).toBe(false);
		});

		it("should return default when not set", () => {
			delete process.env.TEST_BOOL;
			expect(envBool("TEST_BOOL", true)).toBe(true);
			expect(envBool("TEST_BOOL", false)).toBe(false);
		});

		it("should handle mixed case", () => {
			process.env.TEST_BOOL = "TrUe";
			expect(envBool("TEST_BOOL", false)).toBe(true);
		});
	});

	describe("envNum", () => {
		it("should parse valid integer", () => {
			process.env.TEST_NUM = "42";
			expect(envNum("TEST_NUM", 0)).toBe(42);
		});

		it("should parse negative integer", () => {
			process.env.TEST_NUM = "-10";
			expect(envNum("TEST_NUM", 0)).toBe(-10);
		});

		it("should return default for invalid number", () => {
			process.env.TEST_NUM = "not-a-number";
			expect(envNum("TEST_NUM", 100)).toBe(100);
		});

		it("should return default when not set", () => {
			delete process.env.TEST_NUM;
			expect(envNum("TEST_NUM", 3000)).toBe(3000);
		});

		it("should parse zero", () => {
			process.env.TEST_NUM = "0";
			expect(envNum("TEST_NUM", 42)).toBe(0);
		});

		it("should handle large numbers", () => {
			process.env.TEST_NUM = "1000000";
			expect(envNum("TEST_NUM", 0)).toBe(1000000);
		});

		it("should truncate floats to integers", () => {
			process.env.TEST_NUM = "42.7";
			expect(envNum("TEST_NUM", 0)).toBe(42);
		});

		it("should return default for empty string", () => {
			process.env.TEST_NUM = "";
			expect(envNum("TEST_NUM", 123)).toBe(123);
		});
	});

	describe("envFloat", () => {
		it("should parse valid float", () => {
			process.env.TEST_FLOAT = "3.14";
			expect(envFloat("TEST_FLOAT", 0)).toBe(3.14);
		});

		it("should parse integer as float", () => {
			process.env.TEST_FLOAT = "42";
			expect(envFloat("TEST_FLOAT", 0)).toBe(42);
		});

		it("should parse negative float", () => {
			process.env.TEST_FLOAT = "-0.5";
			expect(envFloat("TEST_FLOAT", 0)).toBe(-0.5);
		});

		it("should return default for invalid float", () => {
			process.env.TEST_FLOAT = "not-a-float";
			expect(envFloat("TEST_FLOAT", 0.75)).toBe(0.75);
		});

		it("should return default when not set", () => {
			delete process.env.TEST_FLOAT;
			expect(envFloat("TEST_FLOAT", 0.9)).toBe(0.9);
		});

		it("should parse zero", () => {
			process.env.TEST_FLOAT = "0.0";
			expect(envFloat("TEST_FLOAT", 1.5)).toBe(0);
		});

		it("should handle very small floats", () => {
			process.env.TEST_FLOAT = "0.00001";
			expect(envFloat("TEST_FLOAT", 0)).toBe(0.00001);
		});

		it("should handle very large floats", () => {
			process.env.TEST_FLOAT = "999999.999";
			expect(envFloat("TEST_FLOAT", 0)).toBe(999999.999);
		});
	});

	describe("envStr", () => {
		it("should return string value", () => {
			process.env.TEST_STR = "hello";
			expect(envStr("TEST_STR", "default")).toBe("hello");
		});

		it("should return default when not set", () => {
			delete process.env.TEST_STR;
			expect(envStr("TEST_STR", "default-value")).toBe("default-value");
		});

		it("should handle empty string", () => {
			process.env.TEST_STR = "";
			expect(envStr("TEST_STR", "default")).toBe("");
		});

		it("should handle whitespace", () => {
			process.env.TEST_STR = "  spaces  ";
			expect(envStr("TEST_STR", "default")).toBe("  spaces  ");
		});
	});

	describe("envRequired", () => {
		it("should return value when set", () => {
			process.env.TEST_REQUIRED = "required-value";
			expect(envRequired("TEST_REQUIRED")).toBe("required-value");
		});

		it("should throw when not set", () => {
			delete process.env.TEST_REQUIRED;
			expect(() => envRequired("TEST_REQUIRED")).toThrow(
				"Required environment variable TEST_REQUIRED is not set",
			);
		});

		it("should throw when empty string", () => {
			process.env.TEST_REQUIRED = "";
			expect(() => envRequired("TEST_REQUIRED")).toThrow(
				"Required environment variable TEST_REQUIRED is not set",
			);
		});

		it("should not throw for whitespace-only string", () => {
			process.env.TEST_REQUIRED = "  ";
			expect(envRequired("TEST_REQUIRED")).toBe("  ");
		});
	});

	describe("envArray", () => {
		it("should split comma-separated values", () => {
			process.env.TEST_ARRAY = "value1,value2,value3";
			expect(envArray("TEST_ARRAY", [])).toEqual(["value1", "value2", "value3"]);
		});

		it("should trim whitespace from values", () => {
			process.env.TEST_ARRAY = "value1 , value2 , value3";
			expect(envArray("TEST_ARRAY", [])).toEqual(["value1", "value2", "value3"]);
		});

		it("should use custom delimiter", () => {
			process.env.TEST_ARRAY = "value1;value2;value3";
			expect(envArray("TEST_ARRAY", [], ";")).toEqual(["value1", "value2", "value3"]);
		});

		it("should return default when not set", () => {
			delete process.env.TEST_ARRAY;
			expect(envArray("TEST_ARRAY", ["default1", "default2"])).toEqual(["default1", "default2"]);
		});

		it("should return default for empty string", () => {
			process.env.TEST_ARRAY = "";
			expect(envArray("TEST_ARRAY", ["default"])).toEqual(["default"]);
		});

		it("should handle single value", () => {
			process.env.TEST_ARRAY = "single";
			expect(envArray("TEST_ARRAY", [])).toEqual(["single"]);
		});

		it("should handle empty values in array", () => {
			process.env.TEST_ARRAY = "value1,,value3";
			expect(envArray("TEST_ARRAY", [])).toEqual(["value1", "", "value3"]);
		});
	});
});
