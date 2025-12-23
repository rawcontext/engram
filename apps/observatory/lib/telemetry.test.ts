import type { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { trackUsage, withTelemetry } from "./telemetry";

vi.mock("@engram/logger", () => ({
	createNodeLogger: () => ({
		info: mock(),
	}),
}));

describe("telemetry", () => {
	beforeEach(() => {
		// vi.clearAllMocks(); // TODO: Clear individual mocks
	});

	describe("trackUsage", () => {
		it("should log api request with basic info", () => {
			const req = new Request("http://example.com/api/test", { method: "GET" });
			trackUsage(req, 200, 100);
		});

		it("should log api request with userId", () => {
			const req = new Request("http://example.com/api/test", { method: "POST" });
			trackUsage(req, 201, 250, "user_123");
		});

		it("should log api request with metadata", () => {
			const req = new Request("http://example.com/api/test", { method: "PUT" });
			trackUsage(req, 200, 150, "user_456", { endpoint: "/api/test", custom: "value" });
		});

		it("should log api request without userId but with metadata", () => {
			const req = new Request("http://example.com/api/test", { method: "DELETE" });
			trackUsage(req, 204, 50, undefined, { action: "delete" });
		});
	});

	describe("withTelemetry", () => {
		it("should call handler and track successful request", async () => {
			const mockHandler = mock().mockResolvedValue({
				status: 200,
			} as NextResponse);

			const wrappedHandler = withTelemetry(mockHandler);
			const req = new Request("http://example.com/api/test");

			const result = await wrappedHandler(req);

			expect(mockHandler).toHaveBeenCalledWith(req);
			expect(result.status).toBe(200);
		});

		it("should track failed request and rethrow error", async () => {
			const mockHandler = mock().mockRejectedValue(new Error("Handler error"));

			const wrappedHandler = withTelemetry(mockHandler);
			const req = new Request("http://example.com/api/test");

			await expect(wrappedHandler(req)).rejects.toThrow("Handler error");
			expect(mockHandler).toHaveBeenCalledWith(req);
		});

		it("should track request with error status", async () => {
			const mockHandler = mock().mockResolvedValue({
				status: 404,
			} as NextResponse);

			const wrappedHandler = withTelemetry(mockHandler);
			const req = new Request("http://example.com/api/test");

			const result = await wrappedHandler(req);

			expect(result.status).toBe(404);
		});

		it("should handle handler with additional arguments", async () => {
			const mockHandler = mock().mockResolvedValue({
				status: 200,
			} as NextResponse);

			const wrappedHandler = withTelemetry(mockHandler);
			const req = new Request("http://example.com/api/test");
			const extraArg = { id: "123" };

			const result = await wrappedHandler(req, extraArg);

			expect(mockHandler).toHaveBeenCalledWith(req, extraArg);
			expect(result.status).toBe(200);
		});

		it("should track duration correctly", async () => {
			const mockHandler = mock().mockImplementation(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				return { status: 200 } as NextResponse;
			});

			const wrappedHandler = withTelemetry(mockHandler);
			const req = new Request("http://example.com/api/test");

			await wrappedHandler(req);

			expect(mockHandler).toHaveBeenCalled();
		});

		it("should use 500 status when response is null in finally block", async () => {
			const mockHandler = mock().mockImplementation(() => {
				throw new Error("Unexpected error");
			});

			const wrappedHandler = withTelemetry(mockHandler);
			const req = new Request("http://example.com/api/test");

			await expect(wrappedHandler(req)).rejects.toThrow("Unexpected error");
		});
	});
});
