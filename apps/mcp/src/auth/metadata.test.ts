import { describe, expect, it } from "bun:test";
import {
	createAuthorizationServerMetadata,
	createProtectedResourceMetadata,
	getAuthorizationServerMetadataUrl,
	getProtectedResourceMetadataUrl,
	MCP_SCOPES,
} from "./metadata";

describe("OAuth Metadata", () => {
	describe("MCP_SCOPES", () => {
		it("should include all required MCP scopes", () => {
			expect(MCP_SCOPES).toContain("mcp:tools");
			expect(MCP_SCOPES).toContain("mcp:resources");
			expect(MCP_SCOPES).toContain("mcp:prompts");
		});
	});

	describe("createProtectedResourceMetadata", () => {
		it("should create metadata with required fields", () => {
			const metadata = createProtectedResourceMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com",
			});

			expect(metadata.resource).toBe("https://mcp.example.com");
			expect(metadata.authorization_servers).toEqual(["https://auth.example.com"]);
			expect(metadata.scopes_supported).toContain("mcp:tools");
			expect(metadata.scopes_supported).toContain("mcp:resources");
			expect(metadata.scopes_supported).toContain("mcp:prompts");
			expect(metadata.bearer_methods_supported).toEqual(["header"]);
		});

		it("should strip trailing slashes from URLs", () => {
			const metadata = createProtectedResourceMetadata({
				serverUrl: "https://mcp.example.com/",
				authServerUrl: "https://auth.example.com/",
			});

			expect(metadata.resource).toBe("https://mcp.example.com");
			expect(metadata.authorization_servers).toEqual(["https://auth.example.com"]);
		});

		it("should include optional resource name", () => {
			const metadata = createProtectedResourceMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com",
				resourceName: "My MCP Server",
			});

			expect(metadata.resource_name).toBe("My MCP Server");
		});

		it("should include optional documentation URL", () => {
			const metadata = createProtectedResourceMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com",
				documentationUrl: "https://docs.example.com",
			});

			expect(metadata.resource_documentation).toBe("https://docs.example.com");
		});

		it("should not include optional fields when not provided", () => {
			const metadata = createProtectedResourceMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com",
			});

			expect(metadata.resource_name).toBeUndefined();
			expect(metadata.resource_documentation).toBeUndefined();
		});
	});

	describe("createAuthorizationServerMetadata", () => {
		it("should create metadata with all required endpoints", () => {
			const metadata = createAuthorizationServerMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com",
			});

			expect(metadata.issuer).toBe("https://auth.example.com");
			expect(metadata.authorization_endpoint).toBe("https://auth.example.com/api/auth/authorize");
			expect(metadata.token_endpoint).toBe("https://auth.example.com/api/auth/token");
			expect(metadata.registration_endpoint).toBe("https://auth.example.com/api/auth/register");
			expect(metadata.introspection_endpoint).toBe("https://auth.example.com/api/auth/introspect");
			expect(metadata.revocation_endpoint).toBe("https://auth.example.com/api/auth/revoke");
		});

		it("should strip trailing slashes from auth server URL", () => {
			const metadata = createAuthorizationServerMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com/",
			});

			expect(metadata.issuer).toBe("https://auth.example.com");
			expect(metadata.authorization_endpoint).toBe("https://auth.example.com/api/auth/authorize");
		});

		it("should include supported OAuth capabilities", () => {
			const metadata = createAuthorizationServerMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com",
			});

			expect(metadata.response_types_supported).toContain("code");
			expect(metadata.grant_types_supported).toContain("authorization_code");
			expect(metadata.grant_types_supported).toContain("refresh_token");
			expect(metadata.grant_types_supported).toContain(
				"urn:ietf:params:oauth:grant-type:device_code",
			);
			expect(metadata.code_challenge_methods_supported).toContain("S256");
		});

		it("should include token endpoint auth methods", () => {
			const metadata = createAuthorizationServerMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com",
			});

			expect(metadata.token_endpoint_auth_methods_supported).toContain("client_secret_basic");
			expect(metadata.token_endpoint_auth_methods_supported).toContain("client_secret_post");
			expect(metadata.token_endpoint_auth_methods_supported).toContain("none");
		});

		it("should include MCP scopes", () => {
			const metadata = createAuthorizationServerMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com",
			});

			expect(metadata.scopes_supported).toContain("mcp:tools");
			expect(metadata.scopes_supported).toContain("mcp:resources");
			expect(metadata.scopes_supported).toContain("mcp:prompts");
		});

		it("should include optional documentation URL", () => {
			const metadata = createAuthorizationServerMetadata({
				serverUrl: "https://mcp.example.com",
				authServerUrl: "https://auth.example.com",
				documentationUrl: "https://docs.example.com",
			});

			expect(metadata.service_documentation).toBe("https://docs.example.com");
		});
	});

	describe("getProtectedResourceMetadataUrl", () => {
		it("should return correct well-known URL", () => {
			const url = getProtectedResourceMetadataUrl("https://mcp.example.com");
			expect(url).toBe("https://mcp.example.com/.well-known/oauth-protected-resource");
		});

		it("should strip trailing slash", () => {
			const url = getProtectedResourceMetadataUrl("https://mcp.example.com/");
			expect(url).toBe("https://mcp.example.com/.well-known/oauth-protected-resource");
		});
	});

	describe("getAuthorizationServerMetadataUrl", () => {
		it("should return correct well-known URL", () => {
			const url = getAuthorizationServerMetadataUrl("https://auth.example.com");
			expect(url).toBe("https://auth.example.com/.well-known/oauth-authorization-server");
		});

		it("should strip trailing slash", () => {
			const url = getAuthorizationServerMetadataUrl("https://auth.example.com/");
			expect(url).toBe("https://auth.example.com/.well-known/oauth-authorization-server");
		});
	});
});
