import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Mock response structure
 */
interface MockedJsonResponse {
	body: unknown;
	init: { status: number; headers?: Record<string, string> };
}

// Mock NextResponse before imports
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

describe("OAuth Authorization Server Metadata Endpoint", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should return authorization server metadata with default URLs", async () => {
		// Clear environment to use defaults
		delete process.env.BETTER_AUTH_URL;

		// Dynamic import to get fresh module with mocked dependencies
		const { GET } = await import("../app/api/well-known/oauth-authorization-server/route");

		const response = (await GET()) as unknown as MockedJsonResponse;
		const metadata = response.body as Record<string, unknown>;

		expect(response.init.status).toBe(200);
		expect(metadata.issuer).toBe("http://localhost:6178");
		expect(metadata.authorization_endpoint).toBe("http://localhost:6178/api/auth/authorize");
		expect(metadata.token_endpoint).toBe("http://localhost:6178/api/auth/device/token");
		expect(metadata.registration_endpoint).toBe("http://localhost:6178/api/auth/register");
		expect(metadata.introspection_endpoint).toBe("http://localhost:6178/api/auth/introspect");
		expect(metadata.revocation_endpoint).toBe("http://localhost:6178/api/auth/revoke");
	});

	it("should include OAuth capabilities", async () => {
		const { GET } = await import("../app/api/well-known/oauth-authorization-server/route");

		const response = (await GET()) as unknown as MockedJsonResponse;
		const metadata = response.body as Record<string, unknown>;

		expect(metadata.response_types_supported).toContain("code");
		expect(metadata.grant_types_supported).toContain("authorization_code");
		expect(metadata.grant_types_supported).toContain("refresh_token");
		expect(metadata.grant_types_supported).toContain(
			"urn:ietf:params:oauth:grant-type:device_code",
		);
		expect(metadata.code_challenge_methods_supported).toContain("S256");
	});

	it("should include MCP scopes", async () => {
		const { GET } = await import("../app/api/well-known/oauth-authorization-server/route");

		const response = (await GET()) as unknown as MockedJsonResponse;
		const metadata = response.body as Record<string, unknown>;
		const scopes = metadata.scopes_supported as string[];

		expect(scopes).toContain("mcp:tools");
		expect(scopes).toContain("mcp:resources");
		expect(scopes).toContain("mcp:prompts");
	});

	it("should include token endpoint auth methods", async () => {
		const { GET } = await import("../app/api/well-known/oauth-authorization-server/route");

		const response = (await GET()) as unknown as MockedJsonResponse;
		const metadata = response.body as Record<string, unknown>;
		const authMethods = metadata.token_endpoint_auth_methods_supported as string[];

		expect(authMethods).toContain("client_secret_basic");
		expect(authMethods).toContain("client_secret_post");
		expect(authMethods).toContain("none");
	});

	it("should set correct Content-Type and Cache-Control headers", async () => {
		const { GET } = await import("../app/api/well-known/oauth-authorization-server/route");

		const response = (await GET()) as unknown as MockedJsonResponse;

		expect(response.init.headers?.["Content-Type"]).toBe("application/json");
		expect(response.init.headers?.["Cache-Control"]).toBe("public, max-age=3600");
	});

	it("should strip trailing slashes from URLs", async () => {
		process.env.BETTER_AUTH_URL = "https://auth.example.com/";

		// Force reimport with new env
		const importPath = "../app/api/well-known/oauth-authorization-server/route";
		delete require.cache[require.resolve(importPath)];

		const { GET } = await import(importPath);
		const response = (await GET()) as unknown as MockedJsonResponse;
		const metadata = response.body as Record<string, unknown>;

		expect(metadata.issuer).toBe("https://auth.example.com");
	});
});

describe("OAuth Protected Resource Metadata Endpoint", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should return protected resource metadata with default URLs", async () => {
		delete process.env.BETTER_AUTH_URL;
		delete process.env.ENGRAM_MCP_SERVER_URL;

		const { GET } = await import("../app/api/well-known/oauth-protected-resource/route");

		const response = (await GET()) as unknown as MockedJsonResponse;
		const metadata = response.body as Record<string, unknown>;

		expect(response.init.status).toBe(200);
		expect(metadata.resource).toBe("http://localhost:3010");
		expect(metadata.authorization_servers).toContain("http://localhost:6178");
		expect(metadata.bearer_methods_supported).toContain("header");
	});

	it("should include MCP scopes", async () => {
		const { GET } = await import("../app/api/well-known/oauth-protected-resource/route");

		const response = (await GET()) as unknown as MockedJsonResponse;
		const metadata = response.body as Record<string, unknown>;
		const scopes = metadata.scopes_supported as string[];

		expect(scopes).toContain("mcp:tools");
		expect(scopes).toContain("mcp:resources");
		expect(scopes).toContain("mcp:prompts");
	});

	it("should include resource name and documentation", async () => {
		const { GET } = await import("../app/api/well-known/oauth-protected-resource/route");

		const response = (await GET()) as unknown as MockedJsonResponse;
		const metadata = response.body as Record<string, unknown>;

		expect(metadata.resource_name).toBe("Engram MCP Server");
		expect(metadata.resource_documentation).toBe(
			"https://github.com/rawcontext/engram/tree/main/apps/mcp",
		);
	});

	it("should set correct Content-Type and Cache-Control headers", async () => {
		const { GET } = await import("../app/api/well-known/oauth-protected-resource/route");

		const response = (await GET()) as unknown as MockedJsonResponse;

		expect(response.init.headers?.["Content-Type"]).toBe("application/json");
		expect(response.init.headers?.["Cache-Control"]).toBe("public, max-age=3600");
	});
});
