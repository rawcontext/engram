/**
 * @engram/common/testing - Shared test utilities and mock factories for the Engram system.
 *
 * This module provides reusable test infrastructure for integration and unit testing
 * across the monorepo. It includes mock factories for storage interfaces and
 * fixture helpers for domain types.
 *
 * @example
 * ```ts
 * import {
 *   createTestGraphClient,
 *   createTestMessageClient,
 *   createTestSession,
 *   createTestTurn,
 * } from "@engram/common/testing";
 *
 * describe("MyService", () => {
 *   it("should handle session creation", async () => {
 *     // Arrange
 *     const graphClient = createTestGraphClient();
 *     const session = createTestSession({ user_id: "user-123" });
 *
 *     // Act
 *     await myService.createSession(session);
 *
 *     // Assert
 *     expect(graphClient.query).toHaveBeenCalled();
 *   });
 * });
 * ```
 *
 * @module @engram/common/testing
 */

import type {
	FileTouchNode,
	ObservationNode,
	ReasoningNode,
	SessionNode,
	ToolCallNode,
	TurnNode,
} from "@engram/graph";
import type { Logger } from "@engram/logger";
import type {
	BlobStore,
	Consumer,
	ConsumerConfig,
	GraphClient,
	Message,
	MessageClient,
	Producer,
	RedisPublisher,
} from "@engram/storage";
import type { Mock } from "bun:test";
import { mock } from "bun:test";

// =============================================================================
// ID Generation Utilities
// =============================================================================

/**
 * Generate a test ULID-like ID for use in fixtures.
 * Format: 01XXXX... (26 character ULID format)
 */
export function createTestId(prefix = "01TEST"): string {
	const chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let result = prefix;
	while (result.length < 26) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result.slice(0, 26);
}

/**
 * Generate a test content hash (SHA256-like).
 */
export function createTestHash(): string {
	return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

// =============================================================================
// Logger Mock Factory
// =============================================================================

/**
 * Type for a mock logger with all standard log levels as mock functions.
 */
export interface MockLogger {
	trace: Mock;
	debug: Mock;
	info: Mock;
	warn: Mock;
	error: Mock;
	fatal: Mock;
	child: Mock;
	level: string;
	bindings: Mock;
	flush: Mock;
	isLevelEnabled: Mock;
	silent: Mock;
}

/**
 * Create a mock Logger with mock() stubs.
 * Compatible with pino's Logger interface for testing purposes.
 *
 * @example
 * ```ts
 * const logger = createTestLogger();
 * myService.doSomething();
 * expect(logger.info).toHaveBeenCalledWith("Operation completed");
 * ```
 */
export function createTestLogger(): MockLogger & Logger {
	const mockLogger: MockLogger = {
		trace: mock(),
		debug: mock(),
		info: mock(),
		warn: mock(),
		error: mock(),
		fatal: mock(),
		child: mock().mockReturnThis(),
		level: "info",
		bindings: mock().mockReturnValue({}),
		flush: mock(),
		isLevelEnabled: mock().mockReturnValue(true),
		silent: mock(),
	};
	return mockLogger as MockLogger & Logger;
}

// =============================================================================
// Bitemporal Time Utilities
// =============================================================================

const INFINITY_END = 9999999999999;

/**
 * Create bitemporal timestamps for test fixtures.
 * Returns valid time and transaction time bounds.
 */
export function createTestBitemporalProps(overrides?: {
	vt_start?: number;
	vt_end?: number;
	tt_start?: number;
	tt_end?: number;
}): { vt_start: number; vt_end: number; tt_start: number; tt_end: number } {
	const now = Date.now();
	return {
		vt_start: overrides?.vt_start ?? now,
		vt_end: overrides?.vt_end ?? INFINITY_END,
		tt_start: overrides?.tt_start ?? now,
		tt_end: overrides?.tt_end ?? INFINITY_END,
	};
}

// =============================================================================
// Mock Producer/Consumer for Message Queues
// =============================================================================

/**
 * Create a mock producer with mock() stubs.
 */
export function createTestProducer(overrides?: Partial<Producer>): Producer {
	return {
		connect: mock().mockResolvedValue(undefined),
		disconnect: mock().mockResolvedValue(undefined),
		send: mock().mockResolvedValue(undefined),
		...overrides,
	};
}

/**
 * Create a mock consumer with mock() stubs.
 */
export function createTestConsumer(overrides?: Partial<Consumer>): Consumer {
	return {
		connect: mock().mockResolvedValue(undefined),
		disconnect: mock().mockResolvedValue(undefined),
		subscribe: mock().mockResolvedValue(undefined),
		run: mock(),
		...overrides,
	};
}

// =============================================================================
// Storage Interface Mock Factories
// =============================================================================

/**
 * Create a mock GraphClient with mock() stubs.
 * All methods are mocked with sensible defaults that can be overridden.
 *
 * @example
 * ```ts
 * const graphClient = createTestGraphClient({
 *   query: mock().mockResolvedValue([{ id: "123", name: "test" }]),
 * });
 * ```
 */
export function createTestGraphClient(overrides?: Partial<GraphClient>): GraphClient {
	return {
		connect: mock().mockResolvedValue(undefined),
		disconnect: mock().mockResolvedValue(undefined),
		query: mock().mockResolvedValue([]),
		isConnected: mock().mockReturnValue(true),
		...overrides,
	};
}

/**
 * Create a mock MessageClient with mock() stubs.
 * Returns pre-configured mock producer and consumer instances.
 *
 * @example
 * ```ts
 * const messageClient = createTestMessageClient();
 * const producer = await messageClient.getProducer();
 * await producer.send({ topic: "events", messages: [...] });
 * expect(producer.send).toHaveBeenCalledWith({ topic: "events", messages: [...] });
 * ```
 */
export function createTestMessageClient(overrides?: Partial<MessageClient>): MessageClient {
	const mockProducer = createTestProducer();
	const mockConsumer = createTestConsumer();

	return {
		getProducer: mock().mockResolvedValue(mockProducer),
		getConsumer: mock((_config: ConsumerConfig) => Promise.resolve(mockConsumer)),
		disconnect: mock().mockResolvedValue(undefined),
		...overrides,
	};
}

/**
 * Create a mock RedisPublisher with mock() stubs.
 *
 * @example
 * ```ts
 * const redisPublisher = createTestRedisPublisher();
 * await redisPublisher.publishSessionUpdate("session-123", { type: "turn_added" });
 * expect(redisPublisher.publishSessionUpdate).toHaveBeenCalledWith("session-123", { type: "turn_added" });
 * ```
 */
export function createTestRedisPublisher(overrides?: Partial<RedisPublisher>): RedisPublisher {
	return {
		publishSessionUpdate: mock().mockResolvedValue(undefined),
		disconnect: mock().mockResolvedValue(undefined),
		...overrides,
	};
}

/**
 * Create a mock BlobStore with mock() stubs.
 *
 * @example
 * ```ts
 * const blobStore = createTestBlobStore({
 *   load: mock().mockResolvedValue("file contents"),
 * });
 * ```
 */
export function createTestBlobStore(overrides?: Partial<BlobStore>): BlobStore {
	return {
		save: mock().mockResolvedValue("file://test/blob/abc123"),
		load: mock().mockResolvedValue(""),
		...overrides,
	};
}

// =============================================================================
// Message Helpers
// =============================================================================

/**
 * Create a test message payload.
 */
export function createTestMessage(overrides?: Partial<Message>): Message {
	return {
		key: Buffer.from("test-key"),
		value: Buffer.from(JSON.stringify({ type: "test", data: {} })),
		offset: "0",
		timestamp: String(Date.now()),
		...overrides,
	};
}

// =============================================================================
// Domain Model Fixture Factories
// =============================================================================

/**
 * Create a test Session fixture.
 * All required fields are populated with sensible defaults.
 *
 * @example
 * ```ts
 * const session = createTestSession({
 *   user_id: "user-123",
 *   working_dir: "/home/user/project",
 * });
 * ```
 */
export function createTestSession(overrides?: Partial<SessionNode>): SessionNode {
	const bitemporal = createTestBitemporalProps();
	return {
		id: createTestId("01SESS"),
		labels: ["Session"] as const,
		user_id: "test-user",
		started_at: Date.now(),
		agent_type: "unknown",
		...bitemporal,
		...overrides,
	} as SessionNode;
}

/**
 * Create a test Turn fixture.
 * Represents a single conversation turn (user prompt + assistant response).
 *
 * @example
 * ```ts
 * const turn = createTestTurn({
 *   user_content: "How do I create a new file?",
 *   sequence_index: 0,
 * });
 * ```
 */
export function createTestTurn(overrides?: Partial<TurnNode>): TurnNode {
	const bitemporal = createTestBitemporalProps();
	const userContent = overrides?.user_content ?? "Test user prompt";
	return {
		id: createTestId("01TURN"),
		labels: ["Turn"] as const,
		user_content: userContent,
		user_content_hash: createTestHash(),
		assistant_preview: "Test assistant response preview",
		sequence_index: 0,
		files_touched: [],
		tool_calls_count: 0,
		...bitemporal,
		...overrides,
	} as TurnNode;
}

/**
 * Create a test ToolCall fixture.
 * Represents a tool invocation within a turn.
 *
 * @example
 * ```ts
 * const toolCall = createTestToolCall({
 *   tool_name: "Read",
 *   tool_type: "file_read",
 *   arguments_json: JSON.stringify({ file_path: "/src/index.ts" }),
 * });
 * ```
 */
export function createTestToolCall(overrides?: Partial<ToolCallNode>): ToolCallNode {
	const bitemporal = createTestBitemporalProps();
	return {
		id: createTestId("01TOOL"),
		labels: ["ToolCall"] as const,
		call_id: `toolu_${createTestId("01CALL")}`,
		tool_name: "TestTool",
		tool_type: "unknown",
		arguments_json: "{}",
		status: "success",
		sequence_index: 0,
		...bitemporal,
		...overrides,
	} as ToolCallNode;
}

/**
 * Create a test Reasoning fixture.
 * Represents a thinking/reasoning block within a turn.
 *
 * @example
 * ```ts
 * const reasoning = createTestReasoning({
 *   preview: "I should read the file first to understand its structure...",
 *   reasoning_type: "planning",
 * });
 * ```
 */
export function createTestReasoning(overrides?: Partial<ReasoningNode>): ReasoningNode {
	const bitemporal = createTestBitemporalProps();
	return {
		id: createTestId("01REAS"),
		labels: ["Reasoning"] as const,
		content_hash: createTestHash(),
		preview: "Test reasoning content",
		reasoning_type: "unknown",
		sequence_index: 0,
		...bitemporal,
		...overrides,
	} as ReasoningNode;
}

/**
 * Create a test FileTouch fixture.
 * Represents a file operation within a turn.
 *
 * @example
 * ```ts
 * const fileTouch = createTestFileTouch({
 *   file_path: "src/auth/login.ts",
 *   action: "edit",
 *   lines_added: 5,
 *   lines_removed: 2,
 * });
 * ```
 */
export function createTestFileTouch(overrides?: Partial<FileTouchNode>): FileTouchNode {
	const bitemporal = createTestBitemporalProps();
	return {
		id: createTestId("01FILE"),
		labels: ["FileTouch"] as const,
		file_path: "test/file.ts",
		action: "read",
		...bitemporal,
		...overrides,
	} as FileTouchNode;
}

/**
 * Create a test Observation fixture.
 * Represents tool execution results.
 *
 * @example
 * ```ts
 * const observation = createTestObservation({
 *   tool_call_id: "toolu_01ABC...",
 *   content: "File contents here...",
 *   is_error: false,
 * });
 * ```
 */
export function createTestObservation(overrides?: Partial<ObservationNode>): ObservationNode {
	const bitemporal = createTestBitemporalProps();
	return {
		id: createTestId("01OBSR"),
		labels: ["Observation"] as const,
		tool_call_id: `toolu_${createTestId("01CALL")}`,
		content: "Test observation content",
		is_error: false,
		...bitemporal,
		...overrides,
	} as ObservationNode;
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Wait for a specified number of milliseconds.
 * Useful for testing async operations with timing.
 */
export function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a deferred promise for testing async control flow.
 *
 * @example
 * ```ts
 * const { promise, resolve, reject } = createDeferred<string>();
 * // Later...
 * resolve("done");
 * await promise; // "done"
 * ```
 */
export function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// Sentinel class to distinguish "promise resolved" errors from actual rejections
class PromiseResolvedError extends Error {
	constructor(expectedType: string) {
		super(`Expected promise to reject with ${expectedType}, but it resolved`);
		this.name = "PromiseResolvedError";
	}
}

/**
 * Assert that a promise rejects with a specific error type.
 *
 * @example
 * ```ts
 * await expectToReject(
 *   myService.doSomething(),
 *   ValidationError,
 *   "Invalid input"
 * );
 * ```
 */
export async function expectToReject<E extends Error>(
	promise: Promise<unknown>,
	errorType: new (...args: unknown[]) => E,
	messageMatch?: string | RegExp,
): Promise<E> {
	try {
		await promise;
		throw new PromiseResolvedError(errorType.name);
	} catch (error) {
		// Re-throw our sentinel error
		if (error instanceof PromiseResolvedError) {
			throw error;
		}
		if (!(error instanceof errorType)) {
			throw new Error(
				`Expected ${errorType.name} but got ${(error as Error).constructor.name}: ${(error as Error).message}`,
			);
		}
		if (messageMatch) {
			const matches =
				typeof messageMatch === "string"
					? error.message.includes(messageMatch)
					: messageMatch.test(error.message);
			if (!matches) {
				throw new Error(
					`Error message "${error.message}" does not match expected pattern "${messageMatch}"`,
				);
			}
		}
		return error;
	}
}

/**
 * Spy on console methods and capture output.
 * Returns cleanup function to restore original methods.
 *
 * @example
 * ```ts
 * const { logs, errors, restore } = spyOnConsole();
 * myService.doSomething();
 * expect(logs).toContain("Operation completed");
 * restore();
 * ```
 */
export function spyOnConsole(): {
	logs: string[];
	errors: string[];
	warns: string[];
	restore: () => void;
} {
	const logs: string[] = [];
	const errors: string[] = [];
	const warns: string[] = [];

	const originalLog = console.log;
	const originalError = console.error;
	const originalWarn = console.warn;

	console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
	console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
	console.warn = (...args: unknown[]) => warns.push(args.map(String).join(" "));

	return {
		logs,
		errors,
		warns,
		restore: () => {
			console.log = originalLog;
			console.error = originalError;
			console.warn = originalWarn;
		},
	};
}
