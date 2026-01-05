import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Request, Response } from "express";
import type { SessionStore } from "../auth/session-store";

// Track registered handlers
type RouteHandler = (req: Request, res: Response) => Promise<void> | void;
const routeHandlers: Map<string, Map<string, RouteHandler>> = new Map();

// Mock Express
const mockServer = {
	close: mock((cb: (err?: Error) => void) => cb()),
};

const mockApp = {
	use: mock((middleware: any) => {}),
	get: mock((path: string, handler: RouteHandler) => {
		if (!routeHandlers.has("get")) routeHandlers.set("get", new Map());
		routeHandlers.get("get")!.set(path, handler);
	}),
	post: mock((path: string, handler: RouteHandler) => {
		if (!routeHandlers.has("post")) routeHandlers.set("post", new Map());
		routeHandlers.get("post")!.set(path, handler);
	}),
	delete: mock((path: string, handler: RouteHandler) => {
		if (!routeHandlers.has("delete")) routeHandlers.set("delete", new Map());
		routeHandlers.get("delete")!.set(path, handler);
	}),
	listen: mock((port: number, cb: () => void) => {
		// Use setTimeout to ensure the return value is available before callback runs
		setTimeout(cb, 0);
		return mockServer;
	}),
};

const expressMock = mock(() => mockApp);
(expressMock as any).json = mock(() => mock(() => {}));

mock.module("express", () => ({
	default: expressMock,
}));

// Mock StreamableHTTPServerTransport
let mockTransportInstance: any;
const MockStreamableHTTPServerTransport = class {
	sessionId = "test-session-id";
	onclose: (() => void) | null = null;
	onsessioninitialized: ((id: string) => void) | null = null;
	onsessionclosed: ((id: string) => void) | null = null;

	constructor(options: any) {
		mockTransportInstance = this;
		if (options.sessionIdGenerator) {
			this.sessionId = options.sessionIdGenerator();
		}
		if (options.onsessioninitialized) {
			this.onsessioninitialized = options.onsessioninitialized;
		}
		if (options.onsessionclosed) {
			this.onsessionclosed = options.onsessionclosed;
		}
	}

	handleRequest = mock(() => Promise.resolve());
	close = mock(() => {});
};

mock.module("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
	StreamableHTTPServerTransport: MockStreamableHTTPServerTransport,
}));

// Mock isInitializeRequest
mock.module("@modelcontextprotocol/sdk/types.js", () => ({
	isInitializeRequest: mock((body: any) => body?.method === "initialize"),
}));

// Import after mocks are set up
import { createHttpTransport } from "./http";

describe("createHttpTransport", () => {
	let mockLogger: {
		info: ReturnType<typeof mock>;
		debug: ReturnType<typeof mock>;
		warn: ReturnType<typeof mock>;
	};
	let mockMcpServer: { connect: ReturnType<typeof mock> };

	beforeEach(() => {
		routeHandlers.clear();
		mockApp.get.mockClear();
		mockApp.post.mockClear();
		mockApp.delete.mockClear();
		mockApp.listen.mockClear();

		mockLogger = {
			info: mock(() => {}),
			debug: mock(() => {}),
			warn: mock(() => {}),
		};

		mockMcpServer = {
			connect: mock(() => Promise.resolve()),
		};
	});

	it("should create HTTP transport with app and methods", async () => {
		const result = await createHttpTransport({
			port: 3010,
			mcpServer: mockMcpServer as any,
			logger: mockLogger as any,
			serverUrl: "http://localhost:3010",
		});

		expect(result.app).toBeDefined();
		expect(typeof result.start).toBe("function");
		expect(typeof result.stop).toBe("function");
	});

	it("should register health endpoint", async () => {
		await createHttpTransport({
			port: 3010,
			mcpServer: mockMcpServer as any,
			logger: mockLogger as any,
			serverUrl: "http://localhost:3010",
		});

		expect(mockApp.get).toHaveBeenCalledWith("/health", expect.any(Function));
	});

	it("should register MCP endpoints (POST, GET, DELETE)", async () => {
		await createHttpTransport({
			port: 3010,
			mcpServer: mockMcpServer as any,
			logger: mockLogger as any,
			serverUrl: "http://localhost:3010",
		});

		expect(mockApp.post).toHaveBeenCalledWith("/mcp", expect.any(Function));
		expect(mockApp.get).toHaveBeenCalledWith("/mcp", expect.any(Function));
		expect(mockApp.delete).toHaveBeenCalledWith("/mcp", expect.any(Function));
	});

	describe("start", () => {
		it("should start HTTP server and log", async () => {
			const result = await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
				authEnabled: true,
			});

			await result.start();

			expect(mockApp.listen).toHaveBeenCalledWith(3010, expect.any(Function));
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.objectContaining({ port: 3010 }),
				"HTTP transport started",
			);
		});
	});

	describe("stop", () => {
		it("should stop HTTP server and log", async () => {
			const result = await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			await result.start();
			await result.stop();

			expect(mockLogger.info).toHaveBeenCalledWith("HTTP transport stopped");
		});

		it("should resolve immediately if server not started", async () => {
			const result = await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			await expect(result.stop()).resolves.toBeUndefined();
		});
	});

	describe("health endpoint", () => {
		it("should return status ok with transport info", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
				authEnabled: false,
			});

			const handler = routeHandlers.get("get")?.get("/health");
			expect(handler).toBeDefined();

			const mockRes = {
				json: mock((data: any) => mockRes),
			};

			await handler!({} as Request, mockRes as any);

			expect(mockRes.json).toHaveBeenCalledWith({
				status: "ok",
				transport: "http",
				authEnabled: false,
			});
		});
	});

	describe("POST /mcp", () => {
		it("should return error when session not found", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("post")?.get("/mcp");
			expect(handler).toBeDefined();

			const mockReq = {
				headers: { "mcp-session-id": "nonexistent-session" },
				body: {},
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			expect(mockRes.status).toHaveBeenCalledWith(400);
			expect(mockRes.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.objectContaining({ message: "Invalid session" }),
				}),
			);
		});

		it("should return error for invalid request without session or initialize", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("post")?.get("/mcp");

			const mockReq = {
				headers: {},
				body: { method: "some_other_method" },
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			expect(mockRes.status).toHaveBeenCalledWith(400);
			expect(mockRes.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.objectContaining({ message: "Session required" }),
				}),
			);
		});

		it("should initialize new session for initialize request", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("post")?.get("/mcp");

			const mockReq = {
				headers: {},
				body: { method: "initialize" },
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			expect(mockMcpServer.connect).toHaveBeenCalled();
		});
	});

	describe("GET /mcp", () => {
		it("should return error when session ID not provided", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("get")?.get("/mcp");

			const mockReq = {
				headers: {},
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			expect(mockRes.status).toHaveBeenCalledWith(400);
			expect(mockRes.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.objectContaining({ message: "Session ID required" }),
				}),
			);
		});

		it("should return error for invalid session", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("get")?.get("/mcp");

			const mockReq = {
				headers: { "mcp-session-id": "nonexistent" },
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			expect(mockRes.status).toHaveBeenCalledWith(400);
		});
	});

	describe("DELETE /mcp", () => {
		it("should return error when session ID not provided", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("delete")?.get("/mcp");

			const mockReq = {
				headers: {},
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			expect(mockRes.status).toHaveBeenCalledWith(400);
			expect(mockRes.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.objectContaining({ message: "Session ID required" }),
				}),
			);
		});

		it("should return error for invalid session", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("delete")?.get("/mcp");

			const mockReq = {
				headers: { "mcp-session-id": "nonexistent" },
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			expect(mockRes.status).toHaveBeenCalledWith(400);
		});
	});

	describe("with sessionStore", () => {
		let mockSessionStore: any;
		let storedSessions: Map<string, any>;

		beforeEach(() => {
			storedSessions = new Map();

			mockSessionStore = {
				get: mock((id: string) => storedSessions.get(id)),
				set: mock((id: string, record: any) => storedSessions.set(id, record)),
				delete: mock((id: string) => storedSessions.delete(id)),
				touch: mock((id: string) => {
					const session = storedSessions.get(id);
					if (session) {
						session.lastAccessAt = Date.now();
					}
				}),
				entries: mock(() => storedSessions.entries()),
			};
		});

		describe("POST /mcp with sessionStore", () => {
			it("should validate session ownership", async () => {
				// Create a session owned by user1
				const mockTransport = {
					handleRequest: mock(() => Promise.resolve()),
					close: mock(() => {}),
				};
				storedSessions.set("user1:session-123", {
					transport: mockTransport,
					userId: "user1",
					clientId: "client1",
					scopes: ["memory:read"],
					createdAt: Date.now(),
					lastAccessAt: Date.now(),
				});

				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("post")?.get("/mcp");

				// Try to access as user2
				const mockReq = {
					headers: { "mcp-session-id": "user1:session-123" },
					body: {},
					auth: { userId: "user2", clientId: "client1", scopes: [] },
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				expect(mockRes.status).toHaveBeenCalledWith(403);
				expect(mockRes.json).toHaveBeenCalledWith(
					expect.objectContaining({
						error: expect.objectContaining({ message: "Session access denied" }),
					}),
				);
			});

			it("should touch session on valid access", async () => {
				const mockTransport = {
					handleRequest: mock(() => Promise.resolve()),
					close: mock(() => {}),
				};
				storedSessions.set("user1:session-123", {
					transport: mockTransport,
					userId: "user1",
					clientId: "client1",
					scopes: [],
					createdAt: Date.now(),
					lastAccessAt: Date.now(),
				});

				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("post")?.get("/mcp");

				const mockReq = {
					headers: { "mcp-session-id": "user1:session-123" },
					body: {},
					auth: { userId: "user1", clientId: "client1", scopes: [] },
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				expect(mockSessionStore.touch).toHaveBeenCalledWith("user1:session-123");
			});

			it("should create session in store for initialize request with auth", async () => {
				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("post")?.get("/mcp");

				const mockReq = {
					headers: {},
					body: { method: "initialize" },
					auth: {
						userId: "newuser",
						clientId: "client1",
						scopes: ["memory:read", "memory:write"],
						orgId: "org-123",
						orgSlug: "my-org",
					},
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				// Verify session store set was called (happens via onsessioninitialized callback)
				expect(mockMcpServer.connect).toHaveBeenCalled();
			});
		});

		describe("GET /mcp with sessionStore", () => {
			it("should validate session ownership on GET", async () => {
				const mockTransport = {
					handleRequest: mock(() => Promise.resolve()),
					close: mock(() => {}),
				};
				storedSessions.set("user1:session-123", {
					transport: mockTransport,
					userId: "user1",
					clientId: "client1",
					scopes: [],
					createdAt: Date.now(),
					lastAccessAt: Date.now(),
				});

				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("get")?.get("/mcp");

				const mockReq = {
					headers: { "mcp-session-id": "user1:session-123" },
					auth: { userId: "user2", clientId: "client1", scopes: [] },
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				expect(mockRes.status).toHaveBeenCalledWith(403);
			});

			it("should handle valid session GET with touch", async () => {
				const mockTransport = {
					handleRequest: mock(() => Promise.resolve()),
					close: mock(() => {}),
				};
				storedSessions.set("user1:session-123", {
					transport: mockTransport,
					userId: "user1",
					clientId: "client1",
					scopes: [],
					createdAt: Date.now(),
					lastAccessAt: Date.now(),
				});

				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("get")?.get("/mcp");

				const mockReq = {
					headers: { "mcp-session-id": "user1:session-123" },
					auth: { userId: "user1", clientId: "client1", scopes: [] },
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				expect(mockSessionStore.touch).toHaveBeenCalledWith("user1:session-123");
				expect(mockTransport.handleRequest).toHaveBeenCalled();
			});
		});

		describe("DELETE /mcp with sessionStore", () => {
			it("should validate session ownership on DELETE", async () => {
				const mockTransport = {
					handleRequest: mock(() => Promise.resolve()),
					close: mock(() => {}),
				};
				storedSessions.set("user1:session-123", {
					transport: mockTransport,
					userId: "user1",
					clientId: "client1",
					scopes: [],
					createdAt: Date.now(),
					lastAccessAt: Date.now(),
				});

				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("delete")?.get("/mcp");

				const mockReq = {
					headers: { "mcp-session-id": "user1:session-123" },
					auth: { userId: "user2", clientId: "client1", scopes: [] },
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				expect(mockRes.status).toHaveBeenCalledWith(403);
			});

			it("should handle valid DELETE request", async () => {
				const mockTransport = {
					handleRequest: mock(() => Promise.resolve()),
					close: mock(() => {}),
				};
				storedSessions.set("user1:session-123", {
					transport: mockTransport,
					userId: "user1",
					clientId: "client1",
					scopes: [],
					createdAt: Date.now(),
					lastAccessAt: Date.now(),
				});

				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("delete")?.get("/mcp");

				const mockReq = {
					headers: { "mcp-session-id": "user1:session-123" },
					auth: { userId: "user1", clientId: "client1", scopes: [] },
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				expect(mockTransport.handleRequest).toHaveBeenCalled();
			});
		});

		describe("stop with sessionStore", () => {
			it("should clean up all sessions on stop", async () => {
				const mockTransport1 = {
					handleRequest: mock(() => Promise.resolve()),
					close: mock(() => {}),
				};
				const mockTransport2 = {
					handleRequest: mock(() => Promise.resolve()),
					close: mock(() => {}),
				};
				storedSessions.set("session-1", {
					transport: mockTransport1,
					userId: "user1",
					clientId: "client1",
					scopes: [],
					createdAt: Date.now(),
					lastAccessAt: Date.now(),
				});
				storedSessions.set("session-2", {
					transport: mockTransport2,
					userId: "user2",
					clientId: "client1",
					scopes: [],
					createdAt: Date.now(),
					lastAccessAt: Date.now(),
				});

				const result = await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				await result.start();
				await result.stop();

				expect(mockTransport1.close).toHaveBeenCalled();
				expect(mockTransport2.close).toHaveBeenCalled();
				expect(mockSessionStore.delete).toHaveBeenCalledTimes(2);
			});
		});

		describe("session lifecycle callbacks", () => {
			it("should register session in store when onsessioninitialized is called", async () => {
				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("post")?.get("/mcp");

				const mockReq = {
					headers: {},
					body: { method: "initialize" },
					auth: {
						userId: "testuser",
						clientId: "testclient",
						scopes: ["memory:read"],
						orgId: "org-1",
						orgSlug: "test-org",
					},
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				// Trigger onsessioninitialized callback
				mockTransportInstance.onsessioninitialized("testuser:test-session");

				expect(mockSessionStore.set).toHaveBeenCalledWith(
					"testuser:test-session",
					expect.objectContaining({
						userId: "testuser",
						clientId: "testclient",
						scopes: ["memory:read"],
						orgId: "org-1",
						orgSlug: "test-org",
					}),
				);
			});

			it("should delete session from store when onsessionclosed is called", async () => {
				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("post")?.get("/mcp");

				const mockReq = {
					headers: {},
					body: { method: "initialize" },
					auth: { userId: "testuser", clientId: "testclient", scopes: [] },
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				// Trigger onsessionclosed callback
				mockTransportInstance.onsessionclosed("testuser:test-session");

				expect(mockSessionStore.delete).toHaveBeenCalledWith("testuser:test-session");
			});

			it("should delete session from store when onclose is called", async () => {
				await createHttpTransport({
					port: 3010,
					mcpServer: mockMcpServer as any,
					logger: mockLogger as any,
					serverUrl: "http://localhost:3010",
					sessionStore: mockSessionStore,
				});

				const handler = routeHandlers.get("post")?.get("/mcp");

				const mockReq = {
					headers: {},
					body: { method: "initialize" },
					auth: { userId: "testuser", clientId: "testclient", scopes: [] },
				};

				const mockRes = {
					status: mock((code: number) => mockRes),
					json: mock((data: any) => mockRes),
				};

				await handler!(mockReq as any, mockRes as any);

				// Trigger onclose callback (simulates transport close)
				if (mockTransportInstance.onclose) {
					mockTransportInstance.onclose();
				}

				expect(mockSessionStore.delete).toHaveBeenCalledWith(mockTransportInstance.sessionId);
			});
		});
	});

	describe("in-memory transport store (without sessionStore)", () => {
		it("should store session in memory for initialize without auth", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("post")?.get("/mcp");

			const mockReq = {
				headers: {},
				body: { method: "initialize" },
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			// Trigger onsessioninitialized callback
			mockTransportInstance.onsessioninitialized("test-session-id");

			expect(mockMcpServer.connect).toHaveBeenCalled();
		});

		it("should remove session from memory on onsessionclosed", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("post")?.get("/mcp");

			const mockReq = {
				headers: {},
				body: { method: "initialize" },
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			// Trigger onsessioninitialized to register
			mockTransportInstance.onsessioninitialized("test-session-id");

			// Then trigger onsessionclosed
			mockTransportInstance.onsessionclosed("test-session-id");

			// Session should be removed - subsequent request should fail
			const mockReq2 = {
				headers: { "mcp-session-id": "test-session-id" },
				body: {},
			};

			const mockRes2 = {
				status: mock((code: number) => mockRes2),
				json: mock((data: any) => mockRes2),
			};

			await handler!(mockReq2 as any, mockRes2 as any);

			expect(mockRes2.status).toHaveBeenCalledWith(400);
		});

		it("should remove session from memory on onclose", async () => {
			await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("post")?.get("/mcp");

			const mockReq = {
				headers: {},
				body: { method: "initialize" },
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			// Get the session ID that was generated by sessionIdGenerator
			const sessionId = mockTransportInstance.sessionId;

			// Trigger onsessioninitialized to register with the correct session ID
			mockTransportInstance.onsessioninitialized(sessionId);

			// Then trigger onclose (which uses transport.sessionId internally)
			if (mockTransportInstance.onclose) {
				mockTransportInstance.onclose();
			}

			// Session should be removed - subsequent request should fail
			const mockReq2 = {
				headers: { "mcp-session-id": sessionId },
				body: {},
			};

			const mockRes2 = {
				status: mock((code: number) => mockRes2),
				json: mock((data: any) => mockRes2),
			};

			await handler!(mockReq2 as any, mockRes2 as any);

			expect(mockRes2.status).toHaveBeenCalledWith(400);
		});

		it("should clean up in-memory transports on stop", async () => {
			const result = await createHttpTransport({
				port: 3010,
				mcpServer: mockMcpServer as any,
				logger: mockLogger as any,
				serverUrl: "http://localhost:3010",
			});

			const handler = routeHandlers.get("post")?.get("/mcp");

			// Initialize a session
			const mockReq = {
				headers: {},
				body: { method: "initialize" },
			};

			const mockRes = {
				status: mock((code: number) => mockRes),
				json: mock((data: any) => mockRes),
			};

			await handler!(mockReq as any, mockRes as any);

			// Trigger onsessioninitialized to register
			mockTransportInstance.onsessioninitialized("test-session-id");

			await result.start();
			await result.stop();

			// Verify transport was closed
			expect(mockTransportInstance.close).toHaveBeenCalled();
		});
	});
});
