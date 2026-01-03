import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { createMockAuthServer } from "./server";

describe("server", () => {
	let server: Server<undefined>;
	const port = 3099; // Use different port to avoid conflicts
	const baseUrl = `http://localhost:${port}`;

	beforeAll(() => {
		server = createMockAuthServer(port);
	});

	afterAll(() => {
		server.stop();
	});

	describe("health endpoint", () => {
		it("should return ok status", async () => {
			const response = await fetch(`${baseUrl}/health`);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.status).toBe("ok");
		});
	});

	describe("CORS", () => {
		it("should handle OPTIONS preflight", async () => {
			const response = await fetch(`${baseUrl}/token`, { method: "OPTIONS" });

			expect(response.status).toBe(204);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
			expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
		});

		it("should include CORS headers in responses", async () => {
			const response = await fetch(`${baseUrl}/health`);

			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		});
	});

	describe("metadata endpoint", () => {
		it("should return OAuth server metadata", async () => {
			const response = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.token_endpoint).toContain("/token");
			expect(data.device_authorization_endpoint).toContain("/device");
			expect(data.introspection_endpoint).toContain("/introspect");
			expect(data.grant_types_supported).toContain("client_credentials");
			expect(data.grant_types_supported).toContain("urn:ietf:params:oauth:grant-type:device_code");
		});
	});

	describe("token endpoint - client credentials", () => {
		it("should issue client credentials token", async () => {
			const response = await fetch(`${baseUrl}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "client_credentials",
					client_id: "test-client",
					scope: "memory:read",
				}),
			});
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.access_token).toMatch(/^egm_client_/);
			expect(data.token_type).toBe("DPoP");
			expect(data.expires_in).toBe(3600);
			expect(data.scope).toBe("memory:read");
		});

		it("should use default scope when not provided", async () => {
			const response = await fetch(`${baseUrl}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "client_credentials",
				}),
			});
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.scope).toBeDefined();
		});
	});

	describe("token endpoint - refresh token", () => {
		it("should issue new token for refresh grant", async () => {
			const response = await fetch(`${baseUrl}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "refresh_token",
					refresh_token: "egm_refresh_test",
				}),
			});
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.access_token).toMatch(/^egm_oauth_/);
			expect(data.refresh_token).toMatch(/^egm_refresh_/);
			expect(data.token_type).toBe("Bearer");
		});
	});

	describe("token endpoint - unsupported grant", () => {
		it("should reject unsupported grant type", async () => {
			const response = await fetch(`${baseUrl}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "password",
				}),
			});
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.error).toBe("unsupported_grant_type");
		});
	});

	describe("device flow", () => {
		it("should issue device code", async () => {
			const response = await fetch(`${baseUrl}/device`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ client_id: "test-client" }),
			});
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.device_code).toMatch(/^[0-9a-f]{32}$/);
			expect(data.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
			expect(data.verification_uri).toContain("/activate");
			expect(data.expires_in).toBeGreaterThan(0);
		});

		it("should return authorization_pending initially", async () => {
			// First get a device code
			const deviceResponse = await fetch(`${baseUrl}/device`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ client_id: "test-client" }),
			});
			const deviceData = await deviceResponse.json();

			// Immediately poll - should be pending
			const tokenResponse = await fetch(`${baseUrl}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: deviceData.device_code,
					client_id: "test-client",
				}),
			});
			const tokenData = await tokenResponse.json();

			expect(tokenResponse.status).toBe(400);
			expect(tokenData.error).toBe("authorization_pending");
		});

		it("should auto-authorize after delay", async () => {
			// Get device code
			const deviceResponse = await fetch(`${baseUrl}/device`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ client_id: "test-client" }),
			});
			const deviceData = await deviceResponse.json();

			// Wait 1.1 seconds for auto-authorization
			await new Promise((resolve) => setTimeout(resolve, 1100));

			// Poll again - should succeed
			const tokenResponse = await fetch(`${baseUrl}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: deviceData.device_code,
					client_id: "test-client",
				}),
			});
			const tokenData = await tokenResponse.json();

			expect(tokenResponse.status).toBe(200);
			expect(tokenData.access_token).toMatch(/^egm_oauth_/);
			expect(tokenData.refresh_token).toMatch(/^egm_refresh_/);
		});

		it("should reject unknown device code", async () => {
			const response = await fetch(`${baseUrl}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: "unknown-device-code",
					client_id: "test-client",
				}),
			});
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.error).toBe("authorization_pending");
		});

		it("should require device_code parameter", async () => {
			const response = await fetch(`${baseUrl}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					client_id: "test-client",
				}),
			});
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.error).toBe("invalid_request");
		});
	});

	describe("introspection endpoint", () => {
		it("should return active for valid token", async () => {
			// First get a token
			const tokenResponse = await fetch(`${baseUrl}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "client_credentials",
					client_id: "test-client",
					scope: "memory:read memory:write",
				}),
			});
			const tokenData = await tokenResponse.json();

			// Introspect the token
			const introspectResponse = await fetch(`${baseUrl}/introspect`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: tokenData.access_token }),
			});
			const introspectData = await introspectResponse.json();

			expect(introspectResponse.status).toBe(200);
			expect(introspectData.active).toBe(true);
			expect(introspectData.scope).toBe("memory:read memory:write");
			expect(introspectData.client_id).toBe("test-client");
			expect(introspectData.token_type).toBe("DPoP");
		});

		it("should return inactive for unknown token", async () => {
			const response = await fetch(`${baseUrl}/introspect`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: "unknown-token" }),
			});
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.active).toBe(false);
		});

		it("should return inactive for missing token", async () => {
			const response = await fetch(`${baseUrl}/introspect`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.active).toBe(false);
		});
	});

	describe("404 handling", () => {
		it("should return 404 for unknown paths", async () => {
			const response = await fetch(`${baseUrl}/unknown-path`);

			expect(response.status).toBe(404);
		});
	});
});
