import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as tracer from "./tracer";
import { tracingMiddleware, traceWebSocket } from "./middleware";

describe("Middleware Module", () => {
	let mockSpan: {
		setAttribute: ReturnType<typeof mock>;
		setStatus: ReturnType<typeof mock>;
		recordException: ReturnType<typeof mock>;
		end: ReturnType<typeof mock>;
	};
	let mockTracer: {
		startSpan: ReturnType<typeof mock>;
	};
	let getTracerSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		mockSpan = {
			setAttribute: mock(() => {}),
			setStatus: mock(() => {}),
			recordException: mock(() => {}),
			end: mock(() => {}),
		};

		mockTracer = {
			startSpan: mock(() => mockSpan),
		};

		getTracerSpy = spyOn(tracer, "getTracer");
		getTracerSpy.mockReturnValue(mockTracer as any);
	});

	afterEach(() => {
		getTracerSpy.mockRestore();
	});

	describe("tracingMiddleware", () => {
		it("should create middleware function", () => {
			const middleware = tracingMiddleware();

			expect(typeof middleware).toBe("function");
		});

		it("should create span for request and call next", async () => {
			const middleware = tracingMiddleware();
			const mockNext = mock(async () => {});
			const mockContext = {
				req: {
					method: "GET",
					url: "https://api.example.com/users",
					routePath: "/users",
				},
				res: {
					status: 200,
				},
				get: mock((key: string) => {
					if (key === "orgId") return "org-123";
					if (key === "orgSlug") return "my-org";
					if (key === "userId") return "user-456";
					return undefined;
				}),
			};

			await middleware(mockContext as any, mockNext);

			expect(mockTracer.startSpan).toHaveBeenCalledWith("GET /users", {
				attributes: {
					"http.method": "GET",
					"http.url": "https://api.example.com/users",
					"http.route": "/users",
					"http.scheme": "https",
					"http.target": "/users",
				},
			});
			expect(mockNext).toHaveBeenCalled();
			expect(mockSpan.setAttribute).toHaveBeenCalledWith("tenant.org_id", "org-123");
			expect(mockSpan.setAttribute).toHaveBeenCalledWith("tenant.org_slug", "my-org");
			expect(mockSpan.setAttribute).toHaveBeenCalledWith("user.id", "user-456");
			expect(mockSpan.setAttribute).toHaveBeenCalledWith("http.status_code", 200);
			expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
			expect(mockSpan.end).toHaveBeenCalled();
		});

		it("should fall back to URL path when routePath not available", async () => {
			const middleware = tracingMiddleware();
			const mockNext = mock(async () => {});
			const mockContext = {
				req: {
					method: "POST",
					url: "https://api.example.com/api/data?key=value",
					routePath: undefined,
				},
				res: {
					status: 201,
				},
				get: mock(() => undefined),
			};

			await middleware(mockContext as any, mockNext);

			expect(mockTracer.startSpan).toHaveBeenCalledWith("POST /api/data", expect.any(Object));
		});

		it("should set error status for 4xx responses", async () => {
			const middleware = tracingMiddleware();
			const mockNext = mock(async () => {});
			const mockContext = {
				req: {
					method: "GET",
					url: "https://api.example.com/not-found",
					routePath: "/not-found",
				},
				res: {
					status: 404,
				},
				get: mock(() => undefined),
			};

			await middleware(mockContext as any, mockNext);

			expect(mockSpan.setStatus).toHaveBeenCalledWith({
				code: 2,
				message: "HTTP 404",
			});
		});

		it("should set error status for 5xx responses", async () => {
			const middleware = tracingMiddleware();
			const mockNext = mock(async () => {});
			const mockContext = {
				req: {
					method: "POST",
					url: "https://api.example.com/error",
					routePath: "/error",
				},
				res: {
					status: 500,
				},
				get: mock(() => undefined),
			};

			await middleware(mockContext as any, mockNext);

			expect(mockSpan.setStatus).toHaveBeenCalledWith({
				code: 2,
				message: "HTTP 500",
			});
		});

		it("should record exception when handler throws", async () => {
			const middleware = tracingMiddleware();
			const error = new Error("Handler failed");
			const mockNext = mock(async () => {
				throw error;
			});
			const mockContext = {
				req: {
					method: "POST",
					url: "https://api.example.com/action",
					routePath: "/action",
				},
				res: {
					status: 200,
				},
				get: mock(() => undefined),
			};

			await expect(middleware(mockContext as any, mockNext)).rejects.toThrow("Handler failed");

			expect(mockSpan.recordException).toHaveBeenCalledWith(error);
			expect(mockSpan.setStatus).toHaveBeenCalledWith({
				code: 2,
				message: "Handler failed",
			});
			expect(mockSpan.end).toHaveBeenCalled();
		});

		it("should handle non-Error exceptions", async () => {
			const middleware = tracingMiddleware();
			const mockNext = mock(async () => {
				throw "string error";
			});
			const mockContext = {
				req: {
					method: "GET",
					url: "https://api.example.com/test",
					routePath: "/test",
				},
				res: {
					status: 200,
				},
				get: mock(() => undefined),
			};

			await expect(middleware(mockContext as any, mockNext)).rejects.toThrow();

			expect(mockSpan.recordException).toHaveBeenCalled();
			const recordedError = mockSpan.recordException.mock.calls[0][0];
			expect(recordedError.message).toBe("string error");
		});

		it("should not set tenant context when not available", async () => {
			const middleware = tracingMiddleware();
			const mockNext = mock(async () => {});
			const mockContext = {
				req: {
					method: "GET",
					url: "https://api.example.com/public",
					routePath: "/public",
				},
				res: {
					status: 200,
				},
				get: mock(() => undefined),
			};

			await middleware(mockContext as any, mockNext);

			// setAttribute should only be called for http.status_code
			const setAttributeCalls = mockSpan.setAttribute.mock.calls;
			const tenantCalls = setAttributeCalls.filter(
				(call: any) => call[0].startsWith("tenant.") || call[0] === "user.id",
			);
			expect(tenantCalls.length).toBe(0);
		});
	});

	describe("traceWebSocket", () => {
		it("should create span for connect action", async () => {
			const result = await traceWebSocket("connect", "session-123", async () => {
				return { connected: true };
			});

			expect(result).toEqual({ connected: true });
			expect(mockTracer.startSpan).toHaveBeenCalledWith("websocket.connect", {
				attributes: {
					"websocket.action": "connect",
					"session.id": "session-123",
				},
			});
			expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
			expect(mockSpan.end).toHaveBeenCalled();
		});

		it("should create span for disconnect action", async () => {
			await traceWebSocket("disconnect", "session-456", async () => {});

			expect(mockTracer.startSpan).toHaveBeenCalledWith("websocket.disconnect", {
				attributes: {
					"websocket.action": "disconnect",
					"session.id": "session-456",
				},
			});
		});

		it("should create span for message action", async () => {
			await traceWebSocket("message", "session-789", async () => {
				return { messageCount: 5 };
			});

			expect(mockTracer.startSpan).toHaveBeenCalledWith("websocket.message", {
				attributes: {
					"websocket.action": "message",
					"session.id": "session-789",
				},
			});
		});

		it("should record exception on error", async () => {
			const error = new Error("WebSocket disconnected unexpectedly");

			await expect(
				traceWebSocket("message", "session-abc", async () => {
					throw error;
				}),
			).rejects.toThrow("WebSocket disconnected unexpectedly");

			expect(mockSpan.recordException).toHaveBeenCalledWith(error);
			expect(mockSpan.setStatus).toHaveBeenCalledWith({
				code: 2,
				message: "WebSocket disconnected unexpectedly",
			});
		});

		it("should handle non-Error exceptions", async () => {
			await expect(
				traceWebSocket("connect", "session-def", async () => {
					throw { code: "WS_ERROR" };
				}),
			).rejects.toThrow();

			const recordedError = mockSpan.recordException.mock.calls[0][0];
			expect(recordedError).toBeInstanceOf(Error);
		});
	});
});
