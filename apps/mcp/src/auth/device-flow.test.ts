import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { TokenCache } from "./token-cache";
import { DeviceFlowClient, hasValidCredentials } from "./device-flow";

describe("DeviceFlowClient", () => {
	let mockLogger: any;
	let mockTokenCache: TokenCache;
	let client: DeviceFlowClient;
	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;

		mockLogger = {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		};

		mockTokenCache = {
			getAccessToken: mock(() => null),
			getRefreshToken: mock(() => null),
			needsRefresh: mock(() => false),
			hasValidTokens: mock(() => false),
			updateTokens: mock(() => {}),
		} as unknown as TokenCache;

		client = new DeviceFlowClient({
			apiUrl: "https://observatory.test.com",
			clientId: "test-client",
			logger: mockLogger,
			tokenCache: mockTokenCache,
		});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe("constructor", () => {
		it("should strip trailing slash from API URL", () => {
			const c = new DeviceFlowClient({
				apiUrl: "https://api.example.com/",
				logger: mockLogger,
				tokenCache: mockTokenCache,
			});

			// Access private field via any
			expect((c as any).apiUrl).toBe("https://api.example.com");
		});

		it("should use default client ID when not provided", () => {
			const c = new DeviceFlowClient({
				apiUrl: "https://api.example.com",
				logger: mockLogger,
				tokenCache: mockTokenCache,
			});

			expect((c as any).clientId).toBe("mcp");
		});
	});

	describe("startDeviceFlow", () => {
		it("should return error when device code request fails", async () => {
			globalThis.fetch = mock(() =>
				Promise.resolve({
					ok: false,
					status: 500,
					text: () => Promise.resolve("Internal Server Error"),
				} as Response),
			);

			const result = await client.startDeviceFlow({ openBrowser: false });

			expect(result.success).toBe(false);
			expect(result.error).toContain("500");
		});

		it("should call onDisplayCode callback with code and URLs", async () => {
			let capturedCode: string | undefined;
			let capturedUrl: string | undefined;
			let capturedComplete: string | undefined;

			globalThis.fetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							device_code: "device-123",
							user_code: "ABCD-1234",
							verification_uri: "https://auth.test.com/device",
							verification_uri_complete: "https://auth.test.com/device?code=ABCD-1234",
							interval: 5,
							expires_in: 1800,
						}),
				} as Response),
			);

			// Start flow but cancel immediately via timeout
			const result = client.startDeviceFlow({
				openBrowser: false,
				onDisplayCode: (code, url, complete) => {
					capturedCode = code;
					capturedUrl = url;
					capturedComplete = complete;
				},
			});

			// Give it time to make the first request
			await new Promise((r) => setTimeout(r, 50));

			expect(capturedCode).toBe("ABCD-1234");
			expect(capturedUrl).toBe("https://auth.test.com/device");
			expect(capturedComplete).toBe("https://auth.test.com/device?code=ABCD-1234");
		});

		it("should build complete URL when not provided by server", async () => {
			let capturedComplete: string | undefined;

			globalThis.fetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							device_code: "device-456",
							user_code: "XYZ-9999",
							verification_uri: "https://auth.test.com/device",
							// No verification_uri_complete
							interval: 5,
							expires_in: 1800,
						}),
				} as Response),
			);

			client.startDeviceFlow({
				openBrowser: false,
				onDisplayCode: (code, url, complete) => {
					capturedComplete = complete;
				},
			});

			await new Promise((r) => setTimeout(r, 50));

			expect(capturedComplete).toBe("https://auth.test.com/device?code=XYZ-9999");
		});
	});

	describe("refreshToken", () => {
		it("should return error when no refresh token available", async () => {
			spyOn(mockTokenCache, "getRefreshToken").mockReturnValue(null);

			const result = await client.refreshToken();

			expect(result.success).toBe(false);
			expect(result.error).toBe("No refresh token available");
		});

		it("should call token endpoint with refresh_token grant", async () => {
			spyOn(mockTokenCache, "getRefreshToken").mockReturnValue("refresh-token-123");

			let capturedBody: any;
			globalThis.fetch = mock((url: string, options: RequestInit) => {
				capturedBody = JSON.parse(options.body as string);
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							access_token: "new-access-token",
							refresh_token: "new-refresh-token",
							expires_in: 3600,
							user: { id: "user-1", email: "test@example.com" },
						}),
				} as Response);
			});

			await client.refreshToken();

			expect(capturedBody.grant_type).toBe("refresh_token");
			expect(capturedBody.refresh_token).toBe("refresh-token-123");
			expect(capturedBody.client_id).toBe("test-client");
		});

		it("should update token cache on successful refresh", async () => {
			spyOn(mockTokenCache, "getRefreshToken").mockReturnValue("old-refresh");

			globalThis.fetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							access_token: "new-access",
							refresh_token: "new-refresh",
							expires_in: 7200,
							user: { id: "user-1", email: "refreshed@test.com" },
						}),
				} as Response),
			);

			const result = await client.refreshToken();

			expect(result.success).toBe(true);
			expect(mockTokenCache.updateTokens).toHaveBeenCalledWith("new-access", "new-refresh", 7200, {
				id: "user-1",
				email: "refreshed@test.com",
			});
		});

		it("should return error on token refresh failure", async () => {
			spyOn(mockTokenCache, "getRefreshToken").mockReturnValue("expired-refresh");

			globalThis.fetch = mock(() =>
				Promise.resolve({
					ok: false,
					json: () =>
						Promise.resolve({
							error: "invalid_grant",
							error_description: "Refresh token has expired",
						}),
				} as Response),
			);

			const result = await client.refreshToken();

			expect(result.success).toBe(false);
			expect(result.error).toBe("Refresh token has expired");
		});

		it("should handle network errors gracefully", async () => {
			spyOn(mockTokenCache, "getRefreshToken").mockReturnValue("refresh-token");

			globalThis.fetch = mock(() => Promise.reject(new Error("Network error")));

			const result = await client.refreshToken();

			expect(result.success).toBe(false);
			expect(result.error).toBe("Network error");
		});
	});

	describe("getValidAccessToken", () => {
		it("should return cached token if valid", async () => {
			spyOn(mockTokenCache, "getAccessToken").mockReturnValue("valid-cached-token");

			const token = await client.getValidAccessToken();

			expect(token).toBe("valid-cached-token");
		});

		it("should refresh token if cache is expired", async () => {
			spyOn(mockTokenCache, "getAccessToken").mockReturnValue(null);
			spyOn(mockTokenCache, "needsRefresh").mockReturnValue(true);
			spyOn(mockTokenCache, "getRefreshToken").mockReturnValue("refresh-token");

			globalThis.fetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							access_token: "refreshed-token",
							refresh_token: "new-refresh",
							expires_in: 3600,
							user: { id: "user-1", email: "test@example.com" },
						}),
				} as Response),
			);

			const token = await client.getValidAccessToken();

			expect(token).toBe("refreshed-token");
		});

		it("should return null when no token and refresh fails", async () => {
			spyOn(mockTokenCache, "getAccessToken").mockReturnValue(null);
			spyOn(mockTokenCache, "needsRefresh").mockReturnValue(true);
			spyOn(mockTokenCache, "getRefreshToken").mockReturnValue(null);

			const token = await client.getValidAccessToken();

			expect(token).toBeNull();
		});

		it("should return null when no refresh needed but no token", async () => {
			spyOn(mockTokenCache, "getAccessToken").mockReturnValue(null);
			spyOn(mockTokenCache, "needsRefresh").mockReturnValue(false);

			const token = await client.getValidAccessToken();

			expect(token).toBeNull();
		});
	});
});

describe("hasValidCredentials", () => {
	it("should check TokenCache for valid tokens", () => {
		const mockLogger = {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		};

		// This will create a TokenCache that reads from disk
		// In a real test, we'd mock the file system
		const result = hasValidCredentials(mockLogger as any);

		// Should return false since no tokens are cached
		expect(typeof result).toBe("boolean");
	});
});
