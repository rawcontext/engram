import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as tracer from "./tracer";
import {
	traceDbOperation,
	traceHttpCall,
	traceJob,
	traceMcpTool,
	traceNatsOperation,
} from "./clients";

describe("Client Tracing Functions", () => {
	let mockSpan: {
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

	describe("traceDbOperation", () => {
		it("should create span for database operation", async () => {
			const result = await traceDbOperation(
				"query",
				"postgresql",
				"SELECT * FROM users",
				async () => {
					return [{ id: 1, name: "test" }];
				},
			);

			expect(result).toEqual([{ id: 1, name: "test" }]);
			expect(mockTracer.startSpan).toHaveBeenCalledWith("db.query", {
				attributes: {
					"db.system": "postgresql",
					"db.operation": "query",
					"db.statement": "SELECT * FROM users",
				},
			});
			expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
			expect(mockSpan.end).toHaveBeenCalled();
		});

		it("should truncate long queries", async () => {
			const longQuery = "SELECT ".padEnd(2000, "x");

			await traceDbOperation("query", "falkordb", longQuery, async () => {});

			const call = mockTracer.startSpan.mock.calls[0];
			const attrs = call[1].attributes;
			expect(attrs["db.statement"].length).toBe(1000);
		});

		it("should record exception on error", async () => {
			const error = new Error("Database connection failed");

			await expect(
				traceDbOperation("query", "qdrant", "MATCH (n) RETURN n", async () => {
					throw error;
				}),
			).rejects.toThrow("Database connection failed");

			expect(mockSpan.recordException).toHaveBeenCalledWith(error);
			expect(mockSpan.setStatus).toHaveBeenCalledWith({
				code: 2,
				message: "Database connection failed",
			});
			expect(mockSpan.end).toHaveBeenCalled();
		});

		it("should handle non-Error exceptions", async () => {
			await expect(
				traceDbOperation("insert", "redis", "SET key value", async () => {
					throw "string error";
				}),
			).rejects.toThrow();

			expect(mockSpan.recordException).toHaveBeenCalled();
			const recordedError = mockSpan.recordException.mock.calls[0][0];
			expect(recordedError).toBeInstanceOf(Error);
			expect(recordedError.message).toBe("string error");
		});
	});

	describe("traceNatsOperation", () => {
		it("should create span for publish operation", async () => {
			await traceNatsOperation("publish", "events.session.created", async () => {});

			expect(mockTracer.startSpan).toHaveBeenCalledWith("messaging.publish", {
				attributes: {
					"messaging.system": "nats",
					"messaging.operation": "publish",
					"messaging.destination": "events.session.created",
				},
			});
		});

		it("should create span for subscribe operation", async () => {
			await traceNatsOperation("subscribe", "events.>", async () => {});

			expect(mockTracer.startSpan).toHaveBeenCalledWith("messaging.subscribe", {
				attributes: {
					"messaging.system": "nats",
					"messaging.operation": "subscribe",
					"messaging.destination": "events.>",
				},
			});
		});

		it("should create span for consume operation", async () => {
			await traceNatsOperation("consume", "events.parsed", async () => {
				return { processed: 10 };
			});

			expect(mockTracer.startSpan).toHaveBeenCalledWith("messaging.consume", {
				attributes: {
					"messaging.system": "nats",
					"messaging.operation": "consume",
					"messaging.destination": "events.parsed",
				},
			});
		});

		it("should record exception on error", async () => {
			const error = new Error("NATS connection timeout");

			await expect(
				traceNatsOperation("publish", "events.test", async () => {
					throw error;
				}),
			).rejects.toThrow("NATS connection timeout");

			expect(mockSpan.recordException).toHaveBeenCalledWith(error);
		});
	});

	describe("traceHttpCall", () => {
		it("should create span for HTTP call", async () => {
			await traceHttpCall("GET", "https://api.example.com/users?limit=10", async () => {
				return { users: [] };
			});

			expect(mockTracer.startSpan).toHaveBeenCalledWith("http.client.get", {
				attributes: {
					"http.method": "GET",
					"http.url": "https://api.example.com/users?limit=10",
					"http.scheme": "https",
					"http.host": "api.example.com",
					"http.target": "/users?limit=10",
				},
			});
		});

		it("should handle POST requests", async () => {
			await traceHttpCall("POST", "http://localhost:3000/api/data", async () => {});

			const call = mockTracer.startSpan.mock.calls[0];
			expect(call[0]).toBe("http.client.post");
			expect(call[1].attributes["http.scheme"]).toBe("http");
		});

		it("should record exception on error", async () => {
			const error = new Error("Network error");

			await expect(
				traceHttpCall("DELETE", "https://api.example.com/resource/1", async () => {
					throw error;
				}),
			).rejects.toThrow("Network error");

			expect(mockSpan.recordException).toHaveBeenCalledWith(error);
		});
	});

	describe("traceMcpTool", () => {
		it("should create span for MCP tool invocation", async () => {
			const params = { content: "Test memory", type: "insight", tags: ["test"] };

			await traceMcpTool("remember", params, async () => {
				return { success: true, id: "mem-123" };
			});

			expect(mockTracer.startSpan).toHaveBeenCalledWith("mcp.tool.remember", {
				attributes: {
					"mcp.tool.name": "remember",
					"mcp.tool.params": JSON.stringify(params),
				},
			});
		});

		it("should truncate large params", async () => {
			const largeParams = { data: "x".repeat(1000) };

			await traceMcpTool("query", largeParams, async () => {});

			const call = mockTracer.startSpan.mock.calls[0];
			const attrs = call[1].attributes;
			expect(attrs["mcp.tool.params"].length).toBe(500);
		});

		it("should record exception on error", async () => {
			const error = new Error("Tool execution failed");

			await expect(
				traceMcpTool("recall", { query: "test" }, async () => {
					throw error;
				}),
			).rejects.toThrow("Tool execution failed");

			expect(mockSpan.recordException).toHaveBeenCalledWith(error);
		});
	});

	describe("traceJob", () => {
		it("should create span for job execution", async () => {
			const result = await traceJob("community-detection", async () => {
				return { communitiesDetected: 5 };
			});

			expect(result).toEqual({ communitiesDetected: 5 });
			expect(mockTracer.startSpan).toHaveBeenCalledWith("job.community-detection", {
				attributes: {
					"job.name": "community-detection",
				},
			});
		});

		it("should record exception on error", async () => {
			const error = new Error("Job timeout");

			await expect(
				traceJob("decay-calculator", async () => {
					throw error;
				}),
			).rejects.toThrow("Job timeout");

			expect(mockSpan.recordException).toHaveBeenCalledWith(error);
			expect(mockSpan.setStatus).toHaveBeenCalledWith({
				code: 2,
				message: "Job timeout",
			});
		});

		it("should handle non-Error exceptions", async () => {
			await expect(
				traceJob("summarizer", async () => {
					throw 42;
				}),
			).rejects.toThrow();

			const recordedError = mockSpan.recordException.mock.calls[0][0];
			expect(recordedError.message).toBe("42");
		});
	});
});
