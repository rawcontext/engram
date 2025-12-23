import { describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { z } from "zod";

/**
 * Shape of mocked NextResponse.json() return value.
 */
interface MockedResponse {
	body: {
		success: boolean;
		data?: Record<string, unknown>;
		error?: { message: string; code: string };
	};
	init: { status: number };
}

// Mock NextResponse before imports
mock.module("next/server", () => ({
	NextResponse: {
		json: (body: Record<string, unknown>, init?: { status: number }) => ({ body, init }),
	},
}));

import { apiError, apiSuccess } from "./api-response";
import { validate } from "./validate";

describe("Interface Lib", () => {
	describe("apiResponse", () => {
		it("should return success response", () => {
			const res = apiSuccess({ foo: "bar" }) as unknown as MockedResponse;
			expect(res.body.success).toBe(true);
			expect((res.body.data as Record<string, unknown>).foo).toBe("bar");
			expect(res.init.status).toBe(200);
		});

		it("should return success response with custom status", () => {
			const res = apiSuccess({ foo: "bar" }, 201) as unknown as MockedResponse;
			expect(res.body.success).toBe(true);
			expect(res.init.status).toBe(201);
		});

		it("should return success response with meta", () => {
			const res = apiSuccess({ foo: "bar" }, 200, {
				total: 10,
				page: 1,
			}) as unknown as MockedResponse;
			expect(res.body.success).toBe(true);
			expect((res.body as any).meta).toEqual({ total: 10, page: 1 });
		});

		it("should return error response", () => {
			const res = apiError("Failed", "ERR_01", 400) as unknown as MockedResponse;
			expect(res.body.success).toBe(false);
			expect(res.body.error?.message).toBe("Failed");
			expect(res.init.status).toBe(400);
		});

		it("should return error response with default code and status", () => {
			const res = apiError("Internal error") as unknown as MockedResponse;
			expect(res.body.success).toBe(false);
			expect(res.body.error?.code).toBe("INTERNAL_ERROR");
			expect(res.init.status).toBe(500);
		});

		it("should return error response with details", () => {
			const res = apiError("Validation failed", "VALIDATION_ERROR", 422, {
				fields: ["email", "password"],
			}) as unknown as MockedResponse;
			expect(res.body.success).toBe(false);
			expect((res.body.error as any).details).toEqual({ fields: ["email", "password"] });
		});
	});

	describe("validate", () => {
		const schema = z.object({
			name: z.string(),
		});

		/**
		 * Mock request object that satisfies NextRequest.json() signature.
		 */
		interface MockRequest {
			json: () => Promise<unknown>;
		}

		it("should pass valid data", async () => {
			const req: MockRequest = {
				json: async () => ({ name: "test" }),
			};
			const next = mock(async (data: { name: string }) => apiSuccess(data));

			const res = (await validate(schema)(
				req as unknown as NextRequest,
				next,
			)) as unknown as MockedResponse;

			expect(next).toHaveBeenCalled();
			expect(res.body.success).toBe(true);
		});

		it("should fail invalid data", async () => {
			const req: MockRequest = {
				json: async () => ({ name: 123 }),
			};
			const next = mock(async () => apiSuccess({}));

			const res = (await validate(schema)(
				req as unknown as NextRequest,
				next,
			)) as unknown as MockedResponse;

			expect(next).not.toHaveBeenCalled();
			expect(res.body.success).toBe(false);
			expect(res.body.error?.code).toBe("VALIDATION_ERROR");
		});

		it("should fail invalid json", async () => {
			const req: MockRequest = {
				json: async () => {
					throw new Error();
				},
			};
			const next = mock(async () => apiSuccess({}));

			const res = (await validate(schema)(
				req as unknown as NextRequest,
				next,
			)) as unknown as MockedResponse;

			expect(res.body.error?.code).toBe("INVALID_JSON");
		});
	});
});
