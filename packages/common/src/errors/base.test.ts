/**
 * Tests for @engram/common/errors/base
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EngramError } from "./base";

describe("EngramError", () => {
	let captureStackTraceSpy: ReturnType<typeof vi.spyOn> | undefined;

	beforeEach(() => {
		if (Error.captureStackTrace) {
			captureStackTraceSpy = vi.spyOn(Error, "captureStackTrace");
		}
	});

	it("should create error with message and code", () => {
		// Act
		const error = new EngramError("Something went wrong", "TEST_ERROR");

		// Assert
		expect(error.message).toBe("Something went wrong");
		expect(error.code).toBe("TEST_ERROR");
		expect(error.name).toBe("EngramError");
	});

	it("should include cause error", () => {
		// Arrange
		const causeError = new Error("Original error");

		// Act
		const error = new EngramError("Wrapped error", "WRAPPED_ERROR", causeError);

		// Assert
		expect(error.cause).toBe(causeError);
	});

	it("should have timestamp", () => {
		// Arrange
		const before = Date.now();

		// Act
		const error = new EngramError("Test", "TEST_CODE");

		// Assert
		const after = Date.now();
		expect(error.timestamp).toBeGreaterThanOrEqual(before);
		expect(error.timestamp).toBeLessThanOrEqual(after);
	});

	it("should capture stack trace when available", () => {
		// Act
		const error = new EngramError("Test", "TEST_CODE");

		// Assert
		if (Error.captureStackTrace) {
			expect(captureStackTraceSpy).toHaveBeenCalledWith(error, EngramError);
		}
		expect(error.stack).toBeDefined();
	});

	it("should handle missing Error.captureStackTrace", () => {
		// Arrange
		const originalCaptureStackTrace = Error.captureStackTrace;
		// @ts-expect-error - Temporarily delete captureStackTrace for testing
		delete Error.captureStackTrace;

		// Act
		const error = new EngramError("Test", "TEST_CODE");

		// Assert
		expect(error.message).toBe("Test");
		expect(error.code).toBe("TEST_CODE");

		// Cleanup
		if (originalCaptureStackTrace) {
			Error.captureStackTrace = originalCaptureStackTrace;
		}
	});

	it("should serialize to JSON correctly", () => {
		// Arrange
		const error = new EngramError("Test error", "TEST_CODE");

		// Act
		const json = error.toJSON();

		// Assert
		expect(json).toEqual({
			name: "EngramError",
			message: "Test error",
			code: "TEST_CODE",
			timestamp: expect.any(Number),
			cause: undefined,
		});
	});

	it("should serialize to JSON with cause", () => {
		// Arrange
		const causeError = new Error("Root cause");
		const error = new EngramError("Wrapped", "WRAPPED", causeError);

		// Act
		const json = error.toJSON();

		// Assert
		expect(json).toEqual({
			name: "EngramError",
			message: "Wrapped",
			code: "WRAPPED",
			timestamp: expect.any(Number),
			cause: {
				name: "Error",
				message: "Root cause",
			},
		});
	});

	it("should not include stack trace in JSON", () => {
		// Arrange
		const error = new EngramError("Test", "TEST_CODE");

		// Act
		const json = error.toJSON();

		// Assert
		expect(json).not.toHaveProperty("stack");
	});

	it("should format log string without cause", () => {
		// Arrange
		const error = new EngramError("Operation failed", "OP_FAILED");

		// Act
		const logString = error.toLogString();

		// Assert
		expect(logString).toBe("[OP_FAILED] Operation failed");
	});

	it("should format log string with cause", () => {
		// Arrange
		const causeError = new Error("Network timeout");
		const error = new EngramError("Request failed", "REQ_FAILED", causeError);

		// Act
		const logString = error.toLogString();

		// Assert
		expect(logString).toBe("[REQ_FAILED] Request failed\n  Caused by: Network timeout");
	});

	it("should be instance of Error", () => {
		// Act
		const error = new EngramError("Test", "TEST_CODE");

		// Assert
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(EngramError);
	});

	it("should have correct prototype chain", () => {
		// Act
		const error = new EngramError("Test", "TEST_CODE");

		// Assert
		expect(Object.getPrototypeOf(error)).toBe(EngramError.prototype);
		expect(error.constructor).toBe(EngramError);
	});
});
