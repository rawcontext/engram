import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { apiError, apiSuccess } from "./api-response";
import { validate } from "./validate";

// Mock NextResponse
mock.module("next/server", () => ({
	NextResponse: {
		json: (body: any, init?: any) => ({ body, init }),
	},
}));

describe("Interface Lib", () => {
	describe("apiResponse", () => {
		it("should return success response", () => {
			const res = apiSuccess({ foo: "bar" }) as any;
			expect(res.body.success).toBe(true);
			expect(res.body.data.foo).toBe("bar");
			expect(res.init.status).toBe(200);
		});

		it("should return error response", () => {
			const res = apiError("Failed", "ERR_01", 400) as any;
			expect(res.body.success).toBe(false);
			expect(res.body.error.message).toBe("Failed");
			expect(res.init.status).toBe(400);
		});
	});

	describe("validate", () => {
		const schema = z.object({
			name: z.string(),
		});

		it("should pass valid data", async () => {
			const req = {
				json: async () => ({ name: "test" }),
			};
			const next = mock(async (data) => apiSuccess(data));

			const res = (await validate(schema)(req as any, next)) as any;

			expect(next).toHaveBeenCalled();
			expect(res.body.success).toBe(true);
		});

		it("should fail invalid data", async () => {
			const req = {
				json: async () => ({ name: 123 }),
			};
			const next = mock(async () => apiSuccess({}));

			const res = (await validate(schema)(req as any, next)) as any;

			expect(next).not.toHaveBeenCalled();
			expect(res.body.success).toBe(false);
			expect(res.body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should fail invalid json", async () => {
			const req = {
				json: async () => {
					throw new Error();
				},
			};
			const next = mock(async () => apiSuccess({}));

			const res = (await validate(schema)(req as any, next)) as any;

			expect(res.body.error.code).toBe("INVALID_JSON");
		});
	});
});
