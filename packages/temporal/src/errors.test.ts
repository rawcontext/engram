import { describe, expect, it } from "vitest";
import { type ExecutionError, isUserError } from "./errors";

describe("Execution Errors", () => {
	it("isUserError should return true by default", () => {
		expect(isUserError(new Error("test"))).toBe(true);
	});

	it("should define ExecutionError interface", () => {
		const err: ExecutionError = {
			type: "UserError",
			message: "Something went wrong",
		};
		expect(err.type).toBe("UserError");
		expect(err.message).toBe("Something went wrong");
	});

	it("should define ExecutionError with details", () => {
		const err: ExecutionError = {
			type: "SystemError",
			message: "Database connection failed",
			details: { host: "localhost", port: 5432 },
		};
		expect(err.type).toBe("SystemError");
		expect(err.message).toBe("Database connection failed");
		expect(err.details).toEqual({ host: "localhost", port: 5432 });
	});

	describe("isUserError - system errors", () => {
		it("should return false for ECONNREFUSED errors", () => {
			const err = new Error("ECONNREFUSED: Connection refused");
			expect(isUserError(err)).toBe(false);
		});

		it("should return false for ETIMEDOUT errors", () => {
			const err = new Error("ETIMEDOUT: Operation timed out");
			expect(isUserError(err)).toBe(false);
		});

		it("should return false for ENOTFOUND errors", () => {
			const err = new Error("ENOTFOUND: DNS lookup failed");
			expect(isUserError(err)).toBe(false);
		});

		it("should return false for sandbox crash errors", () => {
			const err = new Error("Sandbox Crash detected");
			expect(isUserError(err)).toBe(false);
		});

		it("should return false for out of memory errors", () => {
			const err = new Error("Out of Memory error occurred");
			expect(isUserError(err)).toBe(false);
		});

		it("should return false for ENOMEM errors", () => {
			const err = new Error("ENOMEM: Cannot allocate memory");
			expect(isUserError(err)).toBe(false);
		});

		it("should return false for segmentation fault errors", () => {
			const err = new Error("Segmentation Fault occurred");
			expect(isUserError(err)).toBe(false);
		});

		it("should return false for core dump errors", () => {
			const err = new Error("Core Dumped");
			expect(isUserError(err)).toBe(false);
		});
	});

	describe("isUserError - user errors", () => {
		it("should return true for SyntaxError", () => {
			const err = new SyntaxError("Unexpected token");
			expect(isUserError(err)).toBe(true);
		});

		it("should return true for ReferenceError", () => {
			const err = new ReferenceError("variable is not defined");
			expect(isUserError(err)).toBe(true);
		});

		it("should return true for TypeError", () => {
			const err = new TypeError("Cannot read property of undefined");
			expect(isUserError(err)).toBe(true);
		});

		it("should return true for RangeError", () => {
			const err = new RangeError("Maximum call stack size exceeded");
			expect(isUserError(err)).toBe(true);
		});

		it("should return true for EvalError", () => {
			const err = new EvalError("Illegal eval usage");
			expect(isUserError(err)).toBe(true);
		});

		it("should return true for URIError", () => {
			const err = new URIError("URI malformed");
			expect(isUserError(err)).toBe(true);
		});

		it("should return true for 'undefined is not' errors", () => {
			const err = new Error("undefined is not a function");
			expect(isUserError(err)).toBe(true);
		});

		it("should return true for 'cannot read property' errors", () => {
			const err = new Error("Cannot read property 'foo' of undefined");
			expect(isUserError(err)).toBe(true);
		});

		it("should return true for 'is not a function' errors", () => {
			const err = new Error("myVar is not a function");
			expect(isUserError(err)).toBe(true);
		});

		it("should return true for 'is not defined' errors", () => {
			const err = new Error("foo is not defined");
			expect(isUserError(err)).toBe(true);
		});
	});

	describe("isUserError - edge cases", () => {
		it("should return false for non-error objects", () => {
			expect(isUserError(null)).toBe(false);
			expect(isUserError(undefined)).toBe(false);
			expect(isUserError("string")).toBe(false);
			expect(isUserError(123)).toBe(false);
			expect(isUserError({})).toBe(true); // Default to true for unknown objects
		});

		it("should handle errors with no message", () => {
			const err = new Error();
			expect(isUserError(err)).toBe(true);
		});

		it("should check error constructor name for user errors", () => {
			// Create a custom error that matches user error patterns via constructor name
			class CustomSyntaxError extends Error {
				constructor(message: string) {
					super(message);
					this.name = "SyntaxError";
				}
			}

			const err = new CustomSyntaxError("Custom error");
			expect(isUserError(err)).toBe(true);
		});
	});
});
