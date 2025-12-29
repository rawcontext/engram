import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createTestLogger } from "@engram/common/testing";
import type { Request, Response } from "express";
import { optionalBearerAuth, requireBearerAuth, skipAuthForLocalhost } from "./middleware";
import type { AccessToken, IntrospectionTokenVerifier } from "./token-verifier";

// Mock verifier
function createMockVerifier(verifyResult: AccessToken | null = null) {
	return {
		verify: mock().mockResolvedValue(verifyResult),
	} as unknown as IntrospectionTokenVerifier;
}

// Mock Express request
function createMockRequest(overrides?: {
	path?: string;
	headers?: Record<string, string>;
	hostname?: string | null;
	host?: string;
}): Request {
	// Check if hostname was explicitly passed (even as undefined/null)
	const hasExplicitHostname = overrides && "hostname" in overrides;
	return {
		path: overrides?.path ?? "/mcp",
		headers: {
			authorization: overrides?.headers?.authorization,
			host: overrides?.host ?? "mcp.example.com:3000",
		},
		hostname: hasExplicitHostname ? overrides?.hostname : "mcp.example.com",
	} as Request;
}

// Mock Express response
function createMockResponse() {
	const res: Partial<Response> = {
		status: mock().mockReturnThis(),
		set: mock().mockReturnThis(),
		json: mock().mockReturnThis(),
	};
	return res as Response;
}

describe("requireBearerAuth", () => {
	let logger: ReturnType<typeof createTestLogger>;
	const serverUrl = "https://mcp.example.com";

	beforeEach(() => {
		logger = createTestLogger();
	});

	describe("authentication", () => {
		it("should return 401 when no Authorization header", async () => {
			const verifier = createMockVerifier();
			const middleware = requireBearerAuth({ verifier, serverUrl, logger });
			const req = createMockRequest();
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.set).toHaveBeenCalledWith(
				expect.objectContaining({
					"WWW-Authenticate": expect.stringContaining('Bearer realm="mcp"'),
				}),
			);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: { code: -32001, message: "Authentication required" },
				}),
			);
			expect(next).not.toHaveBeenCalled();
		});

		it("should return 401 when Authorization header is not Bearer", async () => {
			const verifier = createMockVerifier();
			const middleware = requireBearerAuth({ verifier, serverUrl, logger });
			const req = createMockRequest({
				headers: { authorization: "Basic dXNlcjpwYXNz" },
			});
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: { code: -32001, message: "Bearer token required" },
				}),
			);
		});

		it("should return 401 when token is empty", async () => {
			const verifier = createMockVerifier();
			const middleware = requireBearerAuth({ verifier, serverUrl, logger });
			const req = createMockRequest({
				headers: { authorization: "Bearer " },
			});
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: { code: -32001, message: "Token required" },
				}),
			);
		});

		it("should return 401 when token verification fails", async () => {
			const verifier = createMockVerifier(null);
			const middleware = requireBearerAuth({ verifier, serverUrl, logger });
			const req = createMockRequest({
				headers: { authorization: "Bearer invalid-token" },
			});
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.set).toHaveBeenCalledWith(
				expect.objectContaining({
					"WWW-Authenticate": expect.stringContaining("invalid_token"),
				}),
			);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: { code: -32001, message: "Invalid or expired token" },
				}),
			);
		});

		it("should call next and attach auth when token is valid", async () => {
			const validToken: AccessToken = {
				token: "valid-token",
				clientId: "test-client",
				scopes: ["mcp:tools"],
				userId: "user-123",
			};
			const verifier = createMockVerifier(validToken);
			const middleware = requireBearerAuth({ verifier, serverUrl, logger });
			const req = createMockRequest({
				headers: { authorization: "Bearer valid-token" },
			});
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(next).toHaveBeenCalled();
			expect((req as any).auth).toEqual(validToken);
			expect(logger.debug).toHaveBeenCalledWith(
				expect.objectContaining({ clientId: "test-client", userId: "user-123" }),
				"Request authenticated",
			);
		});
	});

	describe("scope validation", () => {
		it("should return 403 when required scopes are missing", async () => {
			const validToken: AccessToken = {
				token: "valid-token",
				clientId: "test-client",
				scopes: ["mcp:tools"],
			};
			const verifier = createMockVerifier(validToken);
			const middleware = requireBearerAuth({
				verifier,
				serverUrl,
				logger,
				requiredScopes: ["mcp:tools", "mcp:resources"],
			});
			const req = createMockRequest({
				headers: { authorization: "Bearer valid-token" },
			});
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(res.status).toHaveBeenCalledWith(403);
			expect(res.set).toHaveBeenCalledWith(
				expect.objectContaining({
					"WWW-Authenticate": expect.stringContaining("insufficient_scope"),
				}),
			);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.objectContaining({
						code: -32003,
						message: expect.stringContaining("Insufficient scope"),
					}),
				}),
			);
			expect(next).not.toHaveBeenCalled();
		});

		it("should pass when token has all required scopes", async () => {
			const validToken: AccessToken = {
				token: "valid-token",
				clientId: "test-client",
				scopes: ["mcp:tools", "mcp:resources", "mcp:prompts"],
			};
			const verifier = createMockVerifier(validToken);
			const middleware = requireBearerAuth({
				verifier,
				serverUrl,
				logger,
				requiredScopes: ["mcp:tools", "mcp:resources"],
			});
			const req = createMockRequest({
				headers: { authorization: "Bearer valid-token" },
			});
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(next).toHaveBeenCalled();
		});

		it("should pass when no required scopes are specified", async () => {
			const validToken: AccessToken = {
				token: "valid-token",
				clientId: "test-client",
				scopes: [],
			};
			const verifier = createMockVerifier(validToken);
			const middleware = requireBearerAuth({ verifier, serverUrl, logger });
			const req = createMockRequest({
				headers: { authorization: "Bearer valid-token" },
			});
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(next).toHaveBeenCalled();
		});
	});

	describe("skipPaths", () => {
		it("should skip auth for paths in skipPaths", async () => {
			const verifier = createMockVerifier(null);
			const middleware = requireBearerAuth({
				verifier,
				serverUrl,
				logger,
				skipPaths: ["/health", "/.well-known"],
			});
			const req = createMockRequest({ path: "/health" });
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(verifier.verify).not.toHaveBeenCalled();
		});

		it("should skip auth for paths that start with skipPaths prefix", async () => {
			const verifier = createMockVerifier(null);
			const middleware = requireBearerAuth({
				verifier,
				serverUrl,
				logger,
				skipPaths: ["/.well-known"],
			});
			const req = createMockRequest({ path: "/.well-known/oauth-protected-resource" });
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(next).toHaveBeenCalled();
		});
	});

	describe("WWW-Authenticate header", () => {
		it("should include resource_metadata URL in header", async () => {
			const verifier = createMockVerifier();
			const middleware = requireBearerAuth({ verifier, serverUrl, logger });
			const req = createMockRequest();
			const res = createMockResponse();
			const next = mock();

			await middleware(req, res, next);

			expect(res.set).toHaveBeenCalledWith(
				expect.objectContaining({
					"WWW-Authenticate": expect.stringContaining(
						`resource_metadata="${serverUrl}/.well-known/oauth-protected-resource"`,
					),
				}),
			);
		});
	});
});

describe("optionalBearerAuth", () => {
	let logger: ReturnType<typeof createTestLogger>;
	const serverUrl = "https://mcp.example.com";

	beforeEach(() => {
		logger = createTestLogger();
	});

	it("should call next without error when no token is provided", async () => {
		const verifier = createMockVerifier();
		const middleware = optionalBearerAuth({ verifier, serverUrl, logger });
		const req = createMockRequest();
		const res = createMockResponse();
		const next = mock();

		await middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toBeUndefined();
	});

	it("should call next without error when non-Bearer token is provided", async () => {
		const verifier = createMockVerifier();
		const middleware = optionalBearerAuth({ verifier, serverUrl, logger });
		const req = createMockRequest({
			headers: { authorization: "Basic dXNlcjpwYXNz" },
		});
		const res = createMockResponse();
		const next = mock();

		await middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toBeUndefined();
	});

	it("should call next without error when empty Bearer token", async () => {
		const verifier = createMockVerifier();
		const middleware = optionalBearerAuth({ verifier, serverUrl, logger });
		const req = createMockRequest({
			headers: { authorization: "Bearer " },
		});
		const res = createMockResponse();
		const next = mock();

		await middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toBeUndefined();
	});

	it("should attach auth when token is valid", async () => {
		const validToken: AccessToken = {
			token: "valid-token",
			clientId: "test-client",
			scopes: ["mcp:tools"],
			userId: "user-123",
		};
		const verifier = createMockVerifier(validToken);
		const middleware = optionalBearerAuth({ verifier, serverUrl, logger });
		const req = createMockRequest({
			headers: { authorization: "Bearer valid-token" },
		});
		const res = createMockResponse();
		const next = mock();

		await middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toEqual(validToken);
	});

	it("should continue without auth when verification fails", async () => {
		const verifier = createMockVerifier(null);
		const middleware = optionalBearerAuth({ verifier, serverUrl, logger });
		const req = createMockRequest({
			headers: { authorization: "Bearer invalid-token" },
		});
		const res = createMockResponse();
		const next = mock();

		await middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toBeUndefined();
	});

	it("should skip for paths in skipPaths", async () => {
		const verifier = createMockVerifier();
		const middleware = optionalBearerAuth({
			verifier,
			serverUrl,
			logger,
			skipPaths: ["/health"],
		});
		const req = createMockRequest({ path: "/health" });
		const res = createMockResponse();
		const next = mock();

		await middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect(verifier.verify).not.toHaveBeenCalled();
	});
});

describe("skipAuthForLocalhost", () => {
	let logger: ReturnType<typeof createTestLogger>;

	beforeEach(() => {
		logger = createTestLogger();
	});

	it("should set synthetic auth for localhost hostname", () => {
		const middleware = skipAuthForLocalhost(logger);
		const req = createMockRequest({ hostname: "localhost" });
		const res = createMockResponse();
		const next = mock();

		middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toEqual({
			token: "localhost",
			clientId: "localhost",
			scopes: ["mcp:tools", "mcp:resources", "mcp:prompts"],
			userId: "localhost",
		});
		expect(logger.debug).toHaveBeenCalledWith(
			expect.objectContaining({ host: "localhost" }),
			"Skipping auth for localhost",
		);
	});

	it("should set synthetic auth for 127.0.0.1", () => {
		const middleware = skipAuthForLocalhost(logger);
		const req = createMockRequest({ hostname: "127.0.0.1" });
		const res = createMockResponse();
		const next = mock();

		middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toBeDefined();
	});

	it("should set synthetic auth for ::1 (IPv6 localhost)", () => {
		const middleware = skipAuthForLocalhost(logger);
		const req = createMockRequest({ hostname: "::1" });
		const res = createMockResponse();
		const next = mock();

		middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toBeDefined();
	});

	it("should set synthetic auth for .localhost domains", () => {
		const middleware = skipAuthForLocalhost(logger);
		const req = createMockRequest({ hostname: "mcp.localhost" });
		const res = createMockResponse();
		const next = mock();

		middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toBeDefined();
	});

	it("should not set auth for non-localhost domains", () => {
		const middleware = skipAuthForLocalhost(logger);
		const req = createMockRequest({ hostname: "mcp.example.com" });
		const res = createMockResponse();
		const next = mock();

		middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toBeUndefined();
	});

	it("should fall back to host header when hostname is undefined", () => {
		const middleware = skipAuthForLocalhost(logger);
		const req = createMockRequest({
			hostname: null,
			host: "localhost:3000",
		});
		const res = createMockResponse();
		const next = mock();

		middleware(req, res, next);

		expect(next).toHaveBeenCalled();
		expect((req as any).auth).toBeDefined();
	});
});
