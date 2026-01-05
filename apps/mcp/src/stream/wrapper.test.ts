import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "node:events";
import type { RawStreamEvent, StreamDelta } from "./types";

// Create mock child process
class MockChildProcess extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	kill = mock(() => {});
}

let mockChildProcess: MockChildProcess;

// Mock child_process spawn
mock.module("node:child_process", () => ({
	spawn: mock((cmd: string, args: string[], options: any) => {
		mockChildProcess = new MockChildProcess();
		return mockChildProcess;
	}),
}));

// Import after mocking
import { ClaudeCodeStreamWrapper } from "./wrapper";

describe("ClaudeCodeStreamWrapper", () => {
	let wrapper: ClaudeCodeStreamWrapper;
	let mockLogger: { info: ReturnType<typeof mock>; error: ReturnType<typeof mock> };
	let ingestedEvents: RawStreamEvent[];
	let mockOnIngest: ReturnType<typeof mock>;

	beforeEach(() => {
		ingestedEvents = [];
		mockOnIngest = mock(async (event: RawStreamEvent) => {
			ingestedEvents.push(event);
		});

		mockLogger = {
			info: mock(() => {}),
			error: mock(() => {}),
		};

		wrapper = new ClaudeCodeStreamWrapper({
			onIngest: mockOnIngest,
			logger: mockLogger,
		});
	});

	describe("constructor", () => {
		it("should generate a session ID", () => {
			expect(wrapper.getSessionId()).toBeDefined();
			expect(typeof wrapper.getSessionId()).toBe("string");
			expect(wrapper.getSessionId().length).toBeGreaterThan(0);
		});

		it("should be an EventEmitter", () => {
			expect(wrapper).toBeInstanceOf(EventEmitter);
		});

		it("should work without options", () => {
			const simpleWrapper = new ClaudeCodeStreamWrapper();
			expect(simpleWrapper.getSessionId()).toBeDefined();
		});
	});

	describe("getSessionId", () => {
		it("should return consistent session ID", () => {
			const id1 = wrapper.getSessionId();
			const id2 = wrapper.getSessionId();
			expect(id1).toBe(id2);
		});
	});

	describe("kill", () => {
		it("should not throw when no process is running", () => {
			expect(() => wrapper.kill()).not.toThrow();
		});
	});

	describe("execute", () => {
		it("should spawn claude with correct arguments", async () => {
			const executePromise = wrapper.execute({
				prompt: "test prompt",
				allowedTools: ["read", "write"],
				systemPrompt: "You are a test",
			});

			// Simulate process exit
			setTimeout(() => {
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(mockLogger.info).toHaveBeenCalled();
		});

		it("should handle stdout data and parse NDJSON", async () => {
			const events: StreamDelta[] = [];
			wrapper.on("event", (delta: StreamDelta) => events.push(delta));

			const executePromise = wrapper.execute({
				prompt: "test prompt",
				printOutput: false,
			});

			// Simulate stdout with assistant message
			const payload = JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hello world" }],
				},
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from(payload + "\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(events.length).toBeGreaterThan(0);
			expect(events[0].content).toBe("Hello world");
			expect(events[0].type).toBe("content");
		});

		it("should emit ingest events", async () => {
			const executePromise = wrapper.execute({
				prompt: "test prompt",
				printOutput: false,
			});

			const payload = JSON.stringify({
				type: "assistant",
				message: { role: "assistant", content: [] },
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from(payload + "\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(mockOnIngest).toHaveBeenCalled();
			expect(ingestedEvents.length).toBe(1);
			expect(ingestedEvents[0].provider).toBe("claude_code");
		});

		it("should handle stderr output", async () => {
			const stderrMessages: string[] = [];
			wrapper.on("stderr", (msg: string) => stderrMessages.push(msg));

			const executePromise = wrapper.execute({
				prompt: "test prompt",
			});

			setTimeout(() => {
				mockChildProcess.stderr.emit("data", Buffer.from("Error message"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(stderrMessages).toContain("Error message");
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it("should reject on non-zero exit code", async () => {
			const executePromise = wrapper.execute({
				prompt: "test prompt",
			});

			setTimeout(() => {
				mockChildProcess.emit("close", 1);
			}, 10);

			await expect(executePromise).rejects.toThrow("exited with code 1");
		});

		it("should reject on process error", async () => {
			const executePromise = wrapper.execute({
				prompt: "test prompt",
			});

			setTimeout(() => {
				mockChildProcess.emit("error", new Error("Spawn failed"));
			}, 10);

			await expect(executePromise).rejects.toThrow("Spawn failed");
		});

		it("should handle parse errors gracefully", async () => {
			const errors: Error[] = [];
			wrapper.on("error", (err: Error) => errors.push(err));

			const executePromise = wrapper.execute({
				prompt: "test prompt",
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from("not valid json\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(errors.length).toBe(1);
			expect(errors[0].message).toContain("Parse error");
		});

		it("should update session ID from payload", async () => {
			const executePromise = wrapper.execute({
				prompt: "test prompt",
			});

			const payload = JSON.stringify({
				type: "assistant",
				message: { session_id: "new-session-123" },
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from(payload + "\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(wrapper.getSessionId()).toBe("new-session-123");
		});

		it("should handle multiple lines in single data chunk", async () => {
			const events: StreamDelta[] = [];
			wrapper.on("event", (delta: StreamDelta) => events.push(delta));

			const executePromise = wrapper.execute({
				prompt: "test prompt",
				printOutput: false,
			});

			// Send two complete lines in one chunk
			const line1 = JSON.stringify({
				type: "assistant",
				message: { role: "assistant", content: [{ type: "text", text: "Part 1" }] },
			});
			const line2 = JSON.stringify({
				type: "assistant",
				message: { role: "assistant", content: [{ type: "text", text: "Part 2" }] },
			});

			setTimeout(async () => {
				mockChildProcess.stdout.emit("data", Buffer.from(line1 + "\n" + line2 + "\n"));
				// Small delay to allow async line processing to complete
				await new Promise((resolve) => setTimeout(resolve, 20));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(events.length).toBe(2);
			expect(events[0].content).toBe("Part 1");
			expect(events[1].content).toBe("Part 2");
		});

		it("should handle tool_use events", async () => {
			const events: StreamDelta[] = [];
			wrapper.on("event", (delta: StreamDelta) => events.push(delta));

			const executePromise = wrapper.execute({
				prompt: "test prompt",
				printOutput: false,
			});

			const payload = JSON.stringify({
				type: "tool_use",
				tool_use: {
					tool_use_id: "tool-123",
					name: "read_file",
					input: { path: "/test.txt" },
				},
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from(payload + "\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(events.length).toBe(1);
			expect(events[0].type).toBe("tool_call");
			expect(events[0].toolCall?.name).toBe("read_file");
		});

		it("should handle result events with usage", async () => {
			const events: StreamDelta[] = [];
			wrapper.on("event", (delta: StreamDelta) => events.push(delta));

			const executePromise = wrapper.execute({
				prompt: "test prompt",
				printOutput: false,
			});

			const payload = JSON.stringify({
				type: "result",
				result: true,
				subtype: "end_turn",
				usage: {
					input_tokens: 100,
					output_tokens: 50,
				},
				total_cost_usd: 0.05,
				duration_ms: 1500,
				session_id: "result-session",
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from(payload + "\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(events.length).toBe(1);
			expect(events[0].type).toBe("usage");
			expect(events[0].cost).toBe(0.05);
			expect(events[0].session?.id).toBe("result-session");
		});

		it("should handle system init events", async () => {
			const events: StreamDelta[] = [];
			wrapper.on("event", (delta: StreamDelta) => events.push(delta));

			const executePromise = wrapper.execute({
				prompt: "test prompt",
				printOutput: false,
			});

			const payload = JSON.stringify({
				type: "system",
				subtype: "init",
				model: "claude-3-sonnet",
				tools: ["read", "write"],
				session_id: "init-session",
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from(payload + "\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(events.length).toBe(1);
			expect(events[0].type).toBe("content");
			expect(events[0].model).toBe("claude-3-sonnet");
			expect(events[0].session?.id).toBe("init-session");
		});

		it("should handle content with tool_use blocks", async () => {
			const events: StreamDelta[] = [];
			wrapper.on("event", (delta: StreamDelta) => events.push(delta));

			const executePromise = wrapper.execute({
				prompt: "test prompt",
				printOutput: false,
			});

			const payload = JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-abc",
							name: "bash",
							input: { command: "ls" },
						},
					],
				},
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from(payload + "\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(events.length).toBe(1);
			expect(events[0].type).toBe("tool_call");
			expect(events[0].toolCall?.id).toBe("tool-abc");
		});

		it("should handle usage in assistant messages", async () => {
			const events: StreamDelta[] = [];
			wrapper.on("event", (delta: StreamDelta) => events.push(delta));

			const executePromise = wrapper.execute({
				prompt: "test prompt",
				printOutput: false,
			});

			const payload = JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 200,
						output_tokens: 100,
						cache_read_input_tokens: 50,
						cache_creation_input_tokens: 25,
					},
					model: "claude-3-opus",
					stop_reason: "end_turn",
				},
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from(payload + "\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(events.length).toBe(1);
			expect(events[0].usage?.input).toBe(200);
			expect(events[0].usage?.cacheRead).toBe(50);
			expect(events[0].model).toBe("claude-3-opus");
			expect(events[0].stopReason).toBe("end_turn");
		});

		it("should handle ingestion failure gracefully", async () => {
			const failingOnIngest = mock(async () => {
				throw new Error("Ingestion failed");
			});

			const failingWrapper = new ClaudeCodeStreamWrapper({
				onIngest: failingOnIngest,
				logger: mockLogger,
			});

			const executePromise = failingWrapper.execute({
				prompt: "test prompt",
			});

			const payload = JSON.stringify({
				type: "assistant",
				message: { role: "assistant" },
			});

			setTimeout(() => {
				mockChildProcess.stdout.emit("data", Buffer.from(payload + "\n"));
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;

			expect(mockLogger.error).toHaveBeenCalled();
		});

		it("should use custom cwd", async () => {
			const executePromise = wrapper.execute({
				prompt: "test prompt",
				cwd: "/custom/path",
			});

			setTimeout(() => {
				mockChildProcess.emit("close", 0);
			}, 10);

			await executePromise;
			// Just verify it doesn't throw
		});
	});
});
