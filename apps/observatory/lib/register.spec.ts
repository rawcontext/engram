import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// Skip when running with bun test (outside Next.js context)
// These tests require Next.js runtime for @lib/* path aliases
const isBunTest = typeof Bun !== "undefined" && !process.env.NEXT_RUNTIME;
const describeOrSkip = isBunTest ? describe.skip : describe;

/**
 * Mock response structure
 */
interface MockedJsonResponse {
	body: unknown;
	init: { status: number; headers?: Record<string, string> };
}

// Mock pool query
const mockQuery = mock();

// Mock pg Pool
mock.module("pg", () => ({
	Pool: class MockPool {
		query = mockQuery;
	},
}));

// Mock NextResponse
mock.module("next/server", () => ({
	NextResponse: {
		json: (
			body: unknown,
			init?: { status: number; headers?: Record<string, string> },
		): MockedJsonResponse => ({
			body,
			init: init ?? { status: 200 },
		}),
	},
}));

// Container for route handler
const route: {
	POST: (req: Request) => Promise<Response>;
} = {} as typeof route;

// Mock Request
function createMockRequest(body: unknown): Request {
	return {
		json: async () => body,
	} as unknown as Request;
}

describeOrSkip("Client Registration Endpoint", () => {
	// Import inside beforeAll to ensure mocks are set up first
	beforeAll(async () => {
		const mod = await import("../app/api/auth/register/route");
		route.POST = mod.POST;
	});

	beforeEach(() => {
		mockQuery.mockReset();
	});

	describe("POST /api/auth/register", () => {
		it("should return 201 with client credentials for valid registration", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
				client_name: "Test App",
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(201);
			expect((response.body as Record<string, unknown>).client_id).toBeDefined();
			expect((response.body as Record<string, unknown>).client_name).toBe("Test App");
		});

		it("should return client_secret for confidential clients", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
				client_name: "Confidential App",
				token_endpoint_auth_method: "client_secret_basic",
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(201);
			expect((response.body as Record<string, unknown>).client_secret).toBeDefined();
		});

		it("should not return client_secret for public clients", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
				token_endpoint_auth_method: "none",
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(201);
			expect((response.body as Record<string, unknown>).client_secret).toBeUndefined();
		});

		it("should return 400 for missing redirect_uris", async () => {
			const request = createMockRequest({
				client_name: "Test App",
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(400);
			expect((response.body as Record<string, unknown>).error).toBe("invalid_client_metadata");
		});

		it("should return 400 for invalid redirect URI", async () => {
			const request = createMockRequest({
				redirect_uris: ["http://example.com/callback"], // HTTP not allowed
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(400);
			expect((response.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
		});

		it("should return 400 for invalid grant types", async () => {
			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
				grant_types: ["implicit"],
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(400);
			expect((response.body as Record<string, unknown>).error).toBe("invalid_client_metadata");
		});

		it("should return 400 for invalid JSON", async () => {
			const request = {
				json: async () => {
					throw new Error("Invalid JSON");
				},
			} as unknown as Request;

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(400);
			expect((response.body as Record<string, unknown>).error).toBe("invalid_client_metadata");
		});

		it("should echo back optional metadata", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
				client_name: "Test App",
				logo_uri: "https://example.com/logo.png",
				client_uri: "https://example.com",
				policy_uri: "https://example.com/privacy",
				tos_uri: "https://example.com/terms",
				contacts: ["admin@example.com"],
				software_id: "my-app",
				software_version: "1.0.0",
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(201);
			const body = response.body as Record<string, unknown>;
			expect(body.logo_uri).toBe("https://example.com/logo.png");
			expect(body.client_uri).toBe("https://example.com");
			expect(body.policy_uri).toBe("https://example.com/privacy");
			expect(body.tos_uri).toBe("https://example.com/terms");
			expect(body.contacts).toEqual(["admin@example.com"]);
			expect(body.software_id).toBe("my-app");
			expect(body.software_version).toBe("1.0.0");
		});

		it("should set Cache-Control: no-store header", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.headers?.["Cache-Control"]).toBe("no-store");
		});

		it("should return client_id_issued_at as Unix timestamp", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const before = Math.floor(Date.now() / 1000);

			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;
			const body = response.body as Record<string, unknown>;

			const after = Math.floor(Date.now() / 1000);

			expect(body.client_id_issued_at).toBeGreaterThanOrEqual(before);
			expect(body.client_id_issued_at).toBeLessThanOrEqual(after);
		});

		it("should return client_secret_expires_at as 0 (never)", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;
			const body = response.body as Record<string, unknown>;

			expect(body.client_secret_expires_at).toBe(0);
		});

		it("should normalize grant types and add refresh_token", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
				grant_types: ["authorization_code"],
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;
			const body = response.body as Record<string, unknown>;

			expect(body.grant_types).toContain("authorization_code");
			expect(body.grant_types).toContain("refresh_token");
		});

		it("should accept device code grant type", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const request = createMockRequest({
				redirect_uris: ["https://example.com/callback"],
				grant_types: ["urn:ietf:params:oauth:grant-type:device_code"],
			});

			const response = (await route.POST(request)) as unknown as MockedJsonResponse;
			const body = response.body as Record<string, unknown>;

			expect(response.init.status).toBe(201);
			expect(body.grant_types).toContain("urn:ietf:params:oauth:grant-type:device_code");
		});
	});
});
