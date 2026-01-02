import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Only run these tests when running from the observatory directory
// When running from root (bun test), these tests conflict with other test files
// due to pg module ESM export issues that can't be reliably mocked
const isObservatoryRoot = process.cwd().includes("apps/observatory");
const describeOrSkip = isObservatoryRoot ? describe : describe.skip;

/**
 * Mock response structure
 */
interface MockedJsonResponse {
	body: unknown;
	init: { status: number; headers?: Record<string, string> };
}

// Use pg mock from test-preload.ts (accessed via __testMocks global)
// The pg mock is set up in the preload to handle ESM compatibility issues
const mockQuery = globalThis.__testMocks?.pg?.query ?? mock();

// Mock hashToken function
mock.module("@lib/device-auth", () => ({
	hashToken: (token: string) => `hashed_${token}`,
}));

// Mock client registration validation
mock.module("@lib/client-registration", () => ({
	validateClientCredentials: async (_clientId: string, _clientSecret?: string) => {
		// Return invalid for any client that isn't the expected MCP server
		return { valid: false, error: "Client not found" };
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

// Mock Request
function createMockRequest(options: {
	contentType?: string;
	body?: string | Record<string, unknown>;
	authorization?: string;
}): Request {
	const headers = new Headers();
	if (options.contentType) {
		headers.set("content-type", options.contentType);
	}
	if (options.authorization) {
		headers.set("authorization", options.authorization);
	}

	let bodyText: string;
	if (typeof options.body === "string") {
		bodyText = options.body;
	} else if (options.body) {
		bodyText = JSON.stringify(options.body);
	} else {
		bodyText = "";
	}

	return {
		headers,
		formData: async () => {
			const formData = new FormData();
			const params = new URLSearchParams(bodyText);
			for (const [key, value] of params) {
				formData.append(key, value);
			}
			return formData;
		},
		json: async () => (typeof options.body === "object" ? options.body : JSON.parse(bodyText)),
		text: async () => bodyText,
	} as unknown as Request;
}

describeOrSkip("Token Introspection Endpoint", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
		mockQuery.mockReset();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("Token Parsing", () => {
		it("should parse form-urlencoded token", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const { POST } = await import("../app/api/auth/introspect/route");

			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "token=test-token&token_type_hint=access_token",
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(200);
			expect(mockQuery).toHaveBeenCalled();
		});

		it("should parse JSON token", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const { POST } = await import("../app/api/auth/introspect/route");

			const request = createMockRequest({
				contentType: "application/json",
				body: { token: "test-token", token_type_hint: "access_token" },
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(200);
		});

		it("should return inactive for missing token", async () => {
			const { POST } = await import("../app/api/auth/introspect/route");

			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "",
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(200);
			expect(response.body).toEqual({ active: false });
		});
	});

	describe("Token Validation", () => {
		it("should return inactive for token not found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const { POST } = await import("../app/api/auth/introspect/route");

			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "token=unknown-token",
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			expect(response.body).toEqual({ active: false });
		});

		it("should return inactive for revoked token", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "token-1",
						user_id: "user-123",
						scopes: ["mcp:tools"],
						client_id: "test-client",
						access_token_expires_at: new Date(Date.now() + 3600000),
						created_at: new Date(),
						revoked_at: new Date(), // Token is revoked
						user_name: "Test User",
						user_email: "test@example.com",
					},
				],
			});

			const { POST } = await import("../app/api/auth/introspect/route");

			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "token=revoked-token",
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			expect(response.body).toEqual({ active: false });
		});

		it("should return inactive for expired token", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "token-1",
						user_id: "user-123",
						scopes: ["mcp:tools"],
						client_id: "test-client",
						access_token_expires_at: new Date(Date.now() - 3600000), // Expired
						created_at: new Date(),
						revoked_at: null,
						user_name: "Test User",
						user_email: "test@example.com",
					},
				],
			});

			const { POST } = await import("../app/api/auth/introspect/route");

			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "token=expired-token",
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			expect(response.body).toEqual({ active: false });
		});

		it("should return active with token details for valid token", async () => {
			const now = new Date();
			const expiresAt = new Date(Date.now() + 3600000);

			mockQuery
				.mockResolvedValueOnce({
					rows: [
						{
							id: "token-1",
							user_id: "user-123",
							scopes: ["mcp:tools", "mcp:resources"],
							client_id: "test-client",
							access_token_expires_at: expiresAt,
							created_at: now,
							revoked_at: null,
							user_name: "Test User",
							user_email: "test@example.com",
						},
					],
				})
				.mockResolvedValueOnce({ rows: [] }); // For last_used_at update

			const { POST } = await import("../app/api/auth/introspect/route");

			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "token=valid-token",
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;
			const body = response.body as Record<string, unknown>;

			expect(body.active).toBe(true);
			expect(body.sub).toBe("user-123");
			expect(body.client_id).toBe("test-client");
			expect(body.scope).toBe("mcp:tools mcp:resources");
			expect(body.email).toBe("test@example.com");
			expect(body.name).toBe("Test User");
			expect(body.token_type).toBe("Bearer");
		});
	});

	describe("Client Authentication", () => {
		it("should accept request without client auth in development", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const { POST } = await import("../app/api/auth/introspect/route");

			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "token=test-token",
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(200);
		});

		it("should reject invalid client credentials", async () => {
			process.env.ENGRAM_MCP_CLIENT_ID = "mcp-server";
			process.env.ENGRAM_MCP_CLIENT_SECRET = "correct-secret";

			// Force reimport with new env
			delete require.cache[require.resolve("../app/api/auth/introspect/route")];

			const { POST } = await import("../app/api/auth/introspect/route");

			const wrongCredentials = Buffer.from("wrong-client:wrong-secret").toString("base64");
			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "token=test-token",
				authorization: `Basic ${wrongCredentials}`,
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(401);
			expect((response.body as Record<string, unknown>).error).toBe("invalid_client");
		});

		it("should accept valid client credentials", async () => {
			process.env.ENGRAM_MCP_CLIENT_ID = "mcp-server";
			process.env.ENGRAM_MCP_CLIENT_SECRET = "correct-secret";

			mockQuery.mockResolvedValueOnce({ rows: [] });

			// Force reimport with new env
			delete require.cache[require.resolve("../app/api/auth/introspect/route")];

			const { POST } = await import("../app/api/auth/introspect/route");

			const correctCredentials = Buffer.from("mcp-server:correct-secret").toString("base64");
			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "token=test-token",
				authorization: `Basic ${correctCredentials}`,
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			expect(response.init.status).toBe(200);
		});
	});

	describe("Error Handling", () => {
		it("should return inactive on database error (RFC 7662 compliance)", async () => {
			mockQuery.mockRejectedValueOnce(new Error("Database error"));

			const { POST } = await import("../app/api/auth/introspect/route");

			const request = createMockRequest({
				contentType: "application/x-www-form-urlencoded",
				body: "token=test-token",
			});

			const response = (await POST(request)) as unknown as MockedJsonResponse;

			// RFC 7662 says server errors should return inactive, not 500
			expect(response.init.status).toBe(200);
			expect(response.body).toEqual({ active: false });
		});
	});
});
