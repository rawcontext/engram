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
});
