import { beforeEach, describe, expect, it, mock } from "bun:test";

// Mock pool query
const mockQuery = mock();

// Mock pg Pool
mock.module("pg", () => ({
	Pool: class MockPool {
		query = mockQuery;
	},
}));

// Import the module ONCE after mocks are set up
const registrationModule = import("./client-registration");

describe("Client Registration Library", () => {
	let generateClientId: Awaited<typeof registrationModule>["generateClientId"];
	let generateClientSecret: Awaited<typeof registrationModule>["generateClientSecret"];
	let hashClientSecret: Awaited<typeof registrationModule>["hashClientSecret"];
	let validateRedirectUris: Awaited<typeof registrationModule>["validateRedirectUris"];
	let validateGrantTypes: Awaited<typeof registrationModule>["validateGrantTypes"];
	let validateResponseTypes: Awaited<typeof registrationModule>["validateResponseTypes"];
	let validateAuthMethod: Awaited<typeof registrationModule>["validateAuthMethod"];
	let validateScopes: Awaited<typeof registrationModule>["validateScopes"];
	let registerClient: Awaited<typeof registrationModule>["registerClient"];
	let findClientById: Awaited<typeof registrationModule>["findClientById"];
	let validateClientCredentials: Awaited<typeof registrationModule>["validateClientCredentials"];
	let validateClientRedirectUri: Awaited<typeof registrationModule>["validateClientRedirectUri"];

	beforeEach(async () => {
		mockQuery.mockReset();
		const mod = await registrationModule;
		generateClientId = mod.generateClientId;
		generateClientSecret = mod.generateClientSecret;
		hashClientSecret = mod.hashClientSecret;
		validateRedirectUris = mod.validateRedirectUris;
		validateGrantTypes = mod.validateGrantTypes;
		validateResponseTypes = mod.validateResponseTypes;
		validateAuthMethod = mod.validateAuthMethod;
		validateScopes = mod.validateScopes;
		registerClient = mod.registerClient;
		findClientById = mod.findClientById;
		validateClientCredentials = mod.validateClientCredentials;
		validateClientRedirectUri = mod.validateClientRedirectUri;
	});

	describe("generateClientId", () => {
		it("should generate client ID in correct format", () => {
			const clientId = generateClientId();
			expect(clientId).toMatch(/^engram_[a-f0-9]{24}$/);
		});

		it("should generate unique client IDs", () => {
			const id1 = generateClientId();
			const id2 = generateClientId();
			expect(id1).not.toBe(id2);
		});
	});

	describe("generateClientSecret", () => {
		it("should generate client secret in correct format", () => {
			const secret = generateClientSecret();
			expect(secret).toMatch(/^engram_secret_[a-f0-9]{48}$/);
		});

		it("should generate unique secrets", () => {
			const secret1 = generateClientSecret();
			const secret2 = generateClientSecret();
			expect(secret1).not.toBe(secret2);
		});
	});

	describe("hashClientSecret", () => {
		it("should hash a secret consistently", () => {
			const secret = "test-secret";
			const hash1 = hashClientSecret(secret);
			const hash2 = hashClientSecret(secret);
			expect(hash1).toBe(hash2);
		});

		it("should produce different hashes for different secrets", () => {
			const hash1 = hashClientSecret("secret1");
			const hash2 = hashClientSecret("secret2");
			expect(hash1).not.toBe(hash2);
		});
	});

	describe("validateRedirectUris", () => {
		it("should accept valid HTTPS URIs", () => {
			const result = validateRedirectUris(["https://example.com/callback"]);
			expect(result.valid).toBe(true);
		});

		it("should accept localhost HTTP URIs", () => {
			const result = validateRedirectUris(["http://localhost:3000/callback"]);
			expect(result.valid).toBe(true);
		});

		it("should accept 127.0.0.1 HTTP URIs", () => {
			const result = validateRedirectUris(["http://127.0.0.1:3000/callback"]);
			expect(result.valid).toBe(true);
		});

		it("should accept custom scheme URIs for native apps", () => {
			const result = validateRedirectUris(["myapp://callback"]);
			expect(result.valid).toBe(true);
		});

		it("should reject HTTP for non-localhost", () => {
			const result = validateRedirectUris(["http://example.com/callback"]);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("HTTPS required");
		});

		it("should reject URIs with fragments", () => {
			const result = validateRedirectUris(["https://example.com/callback#hash"]);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Fragment not allowed");
		});

		it("should reject empty array", () => {
			const result = validateRedirectUris([]);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("At least one redirect_uri is required");
		});

		it("should reject invalid URIs", () => {
			const result = validateRedirectUris(["not-a-valid-uri"]);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Invalid redirect_uri");
		});

		it("should accept .localhost domains", () => {
			const result = validateRedirectUris(["http://mcp.localhost:3000/callback"]);
			expect(result.valid).toBe(true);
		});
	});

	describe("validateGrantTypes", () => {
		it("should accept authorization_code", () => {
			const result = validateGrantTypes(["authorization_code"]);
			expect(result.valid).toBe(true);
			expect(result.normalized).toContain("authorization_code");
			expect(result.normalized).toContain("refresh_token"); // Auto-added
		});

		it("should accept device_code grant type", () => {
			const result = validateGrantTypes(["urn:ietf:params:oauth:grant-type:device_code"]);
			expect(result.valid).toBe(true);
		});

		it("should reject unsupported grant types", () => {
			const result = validateGrantTypes(["implicit"]);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Unsupported grant_type");
		});

		it("should default to authorization_code", () => {
			const result = validateGrantTypes();
			expect(result.valid).toBe(true);
			expect(result.normalized).toContain("authorization_code");
		});
	});

	describe("validateResponseTypes", () => {
		it("should accept code response type", () => {
			const result = validateResponseTypes(["code"]);
			expect(result.valid).toBe(true);
			expect(result.normalized).toContain("code");
		});

		it("should reject unsupported response types", () => {
			const result = validateResponseTypes(["token"]);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Unsupported response_type");
		});

		it("should default to code", () => {
			const result = validateResponseTypes();
			expect(result.valid).toBe(true);
			expect(result.normalized).toContain("code");
		});
	});

	describe("validateAuthMethod", () => {
		it("should accept none for public clients", () => {
			const result = validateAuthMethod("none");
			expect(result.valid).toBe(true);
			expect(result.normalized).toBe("none");
		});

		it("should accept client_secret_basic", () => {
			const result = validateAuthMethod("client_secret_basic");
			expect(result.valid).toBe(true);
			expect(result.normalized).toBe("client_secret_basic");
		});

		it("should accept client_secret_post", () => {
			const result = validateAuthMethod("client_secret_post");
			expect(result.valid).toBe(true);
			expect(result.normalized).toBe("client_secret_post");
		});

		it("should reject unsupported methods", () => {
			const result = validateAuthMethod("private_key_jwt");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Unsupported token_endpoint_auth_method");
		});

		it("should default to none", () => {
			const result = validateAuthMethod();
			expect(result.valid).toBe(true);
			expect(result.normalized).toBe("none");
		});
	});

	describe("validateScopes", () => {
		it("should accept valid MCP scopes", () => {
			const result = validateScopes("mcp:tools mcp:resources");
			expect(result.valid).toBe(true);
			expect(result.normalized).toBe("mcp:tools mcp:resources");
		});

		it("should reject unsupported scopes", () => {
			const result = validateScopes("mcp:tools invalid:scope");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Unsupported scope");
		});

		it("should return default scopes if not provided", () => {
			const result = validateScopes();
			expect(result.valid).toBe(true);
			expect(result.normalized).toBe("mcp:tools mcp:resources mcp:prompts");
		});
	});

	describe("registerClient", () => {
		it("should register a public client", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const result = await registerClient({
				redirect_uris: ["https://example.com/callback"],
				client_name: "Test App",
			});

			expect("error" in result).toBe(false);
			if (!("error" in result)) {
				expect(result.client_id).toMatch(/^engram_/);
				expect(result.client_secret).toBeUndefined(); // Public client
				expect(result.client_name).toBe("Test App");
				expect(result.token_endpoint_auth_method).toBe("none");
			}
		});

		it("should register a confidential client with secret", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const result = await registerClient({
				redirect_uris: ["https://example.com/callback"],
				client_name: "Confidential App",
				token_endpoint_auth_method: "client_secret_basic",
			});

			expect("error" in result).toBe(false);
			if (!("error" in result)) {
				expect(result.client_id).toMatch(/^engram_/);
				expect(result.client_secret).toMatch(/^engram_secret_/);
				expect(result.token_endpoint_auth_method).toBe("client_secret_basic");
			}
		});

		it("should return error for invalid redirect URI", async () => {
			const result = await registerClient({
				redirect_uris: ["http://example.com/callback"], // HTTP not allowed
			});

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("invalid_redirect_uri");
			}
		});

		it("should return error for invalid grant types", async () => {
			const result = await registerClient({
				redirect_uris: ["https://example.com/callback"],
				grant_types: ["invalid"],
			});

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("invalid_client_metadata");
			}
		});

		it("should generate default client name if not provided", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const result = await registerClient({
				redirect_uris: ["https://example.com/callback"],
			});

			expect("error" in result).toBe(false);
			if (!("error" in result)) {
				expect(result.client_name).toMatch(/^MCP Client /);
			}
		});

		it("should include optional metadata in response", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const result = await registerClient({
				redirect_uris: ["https://example.com/callback"],
				client_name: "Test App",
				logo_uri: "https://example.com/logo.png",
				client_uri: "https://example.com",
				software_id: "test-software",
				software_version: "1.0.0",
			});

			expect("error" in result).toBe(false);
			if (!("error" in result)) {
				expect(result.logo_uri).toBe("https://example.com/logo.png");
				expect(result.client_uri).toBe("https://example.com");
				expect(result.software_id).toBe("test-software");
				expect(result.software_version).toBe("1.0.0");
			}
		});
	});

	describe("findClientById", () => {
		it("should return client when found", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "uuid",
						client_id: "engram_abc123",
						client_name: "Test App",
						redirect_uris: ["https://example.com/callback"],
					},
				],
			});

			const client = await findClientById("engram_abc123");
			expect(client).toBeDefined();
			expect(client?.client_id).toBe("engram_abc123");
		});

		it("should return null when not found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const client = await findClientById("non-existent");
			expect(client).toBeNull();
		});
	});

	describe("validateClientCredentials", () => {
		it("should accept public client without secret", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						client_id: "engram_abc123",
						token_endpoint_auth_method: "none",
						client_secret_hash: null,
					},
				],
			});

			const result = await validateClientCredentials("engram_abc123");
			expect(result.valid).toBe(true);
		});

		it("should require secret for confidential clients", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						client_id: "engram_abc123",
						token_endpoint_auth_method: "client_secret_basic",
						client_secret_hash: hashClientSecret("correct-secret"),
					},
				],
			});

			const result = await validateClientCredentials("engram_abc123");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Client secret required");
		});

		it("should accept correct secret for confidential client", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						client_id: "engram_abc123",
						token_endpoint_auth_method: "client_secret_basic",
						client_secret_hash: hashClientSecret("correct-secret"),
						client_secret_expires_at: null,
					},
				],
			});

			const result = await validateClientCredentials("engram_abc123", "correct-secret");
			expect(result.valid).toBe(true);
		});

		it("should reject incorrect secret", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						client_id: "engram_abc123",
						token_endpoint_auth_method: "client_secret_basic",
						client_secret_hash: hashClientSecret("correct-secret"),
					},
				],
			});

			const result = await validateClientCredentials("engram_abc123", "wrong-secret");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Invalid client secret");
		});

		it("should reject expired secret", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						client_id: "engram_abc123",
						token_endpoint_auth_method: "client_secret_basic",
						client_secret_hash: hashClientSecret("correct-secret"),
						client_secret_expires_at: new Date(Date.now() - 1000), // Expired
					},
				],
			});

			const result = await validateClientCredentials("engram_abc123", "correct-secret");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("expired");
		});

		it("should return error for non-existent client", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const result = await validateClientCredentials("non-existent");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("not found");
		});
	});

	describe("validateClientRedirectUri", () => {
		it("should accept registered redirect URI", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						client_id: "engram_abc123",
						redirect_uris: ["https://example.com/callback", "https://other.com/callback"],
					},
				],
			});

			const result = await validateClientRedirectUri(
				"engram_abc123",
				"https://example.com/callback",
			);
			expect(result).toBe(true);
		});

		it("should reject unregistered redirect URI", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						client_id: "engram_abc123",
						redirect_uris: ["https://example.com/callback"],
					},
				],
			});

			const result = await validateClientRedirectUri(
				"engram_abc123",
				"https://malicious.com/callback",
			);
			expect(result).toBe(false);
		});

		it("should return false for non-existent client", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });

			const result = await validateClientRedirectUri(
				"non-existent",
				"https://example.com/callback",
			);
			expect(result).toBe(false);
		});
	});
});
