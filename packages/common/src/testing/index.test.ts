/**
 * Tests for @engram/common/testing utilities.
 * These tests validate the mock factories and fixture helpers work correctly.
 */

import { describe, expect, it, vi } from "vitest";
import {
	createDeferred,
	createTestBitemporalProps,
	createTestBlobStore,
	createTestConsumer,
	createTestFileTouch,
	// Mock factories
	createTestGraphClient,
	createTestHash,
	// ID and hash utilities
	createTestId,
	createTestKafkaClient,
	createTestKafkaMessage,
	createTestLogger,
	createTestObservation,
	createTestProducer,
	createTestReasoning,
	createTestRedisPublisher,
	// Fixture factories
	createTestSession,
	createTestToolCall,
	createTestTurn,
	expectToReject,
	spyOnConsole,
	// Test utilities
	wait,
} from "./index";

// =============================================================================
// ID and Hash Utilities
// =============================================================================

describe("createTestId", () => {
	it("should generate a 26-character ULID-like ID", () => {
		// Act
		const id = createTestId();

		// Assert
		expect(id).toHaveLength(26);
		expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
	});

	it("should use custom prefix", () => {
		// Act
		const id = createTestId("01CUST");

		// Assert
		expect(id).toHaveLength(26);
		expect(id).toMatch(/^01CUST/);
	});

	it("should generate unique IDs", () => {
		// Act
		const ids = Array.from({ length: 100 }, () => createTestId());
		const uniqueIds = new Set(ids);

		// Assert
		expect(uniqueIds.size).toBe(100);
	});
});

describe("createTestHash", () => {
	it("should generate a 64-character hex string", () => {
		// Act
		const hash = createTestHash();

		// Assert
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]+$/);
	});
});

describe("createTestBitemporalProps", () => {
	it("should generate valid bitemporal properties", () => {
		// Arrange
		const before = Date.now();

		// Act
		const props = createTestBitemporalProps();

		// Assert
		expect(props.vt_start).toBeGreaterThanOrEqual(before);
		expect(props.tt_start).toBeGreaterThanOrEqual(before);
		expect(props.vt_end).toBe(9999999999999);
		expect(props.tt_end).toBe(9999999999999);
	});

	it("should allow overriding properties", () => {
		// Arrange
		const customStart = 1000000000000;

		// Act
		const props = createTestBitemporalProps({
			vt_start: customStart,
			tt_start: customStart,
		});

		// Assert
		expect(props.vt_start).toBe(customStart);
		expect(props.tt_start).toBe(customStart);
	});
});

// =============================================================================
// Mock Factory Tests
// =============================================================================

describe("createTestLogger", () => {
	it("should create a mock logger with all standard levels", () => {
		// Act
		const logger = createTestLogger();

		// Assert
		expect(logger.trace).toBeDefined();
		expect(logger.debug).toBeDefined();
		expect(logger.info).toBeDefined();
		expect(logger.warn).toBeDefined();
		expect(logger.error).toBeDefined();
		expect(logger.fatal).toBeDefined();
		expect(logger.child).toBeDefined();
		expect(logger.bindings).toBeDefined();
		expect(logger.flush).toBeDefined();
		expect(logger.isLevelEnabled).toBeDefined();
		expect(logger.silent).toBeDefined();
	});

	it("should have working mock implementations", () => {
		// Arrange
		const logger = createTestLogger();

		// Act
		logger.info("test message");
		logger.error("error message");
		const childLogger = logger.child({ component: "test" });
		const bindings = logger.bindings();
		const isEnabled = logger.isLevelEnabled("info");

		// Assert
		expect(logger.info).toHaveBeenCalledWith("test message");
		expect(logger.error).toHaveBeenCalledWith("error message");
		expect(childLogger).toBe(logger); // mockReturnThis
		expect(bindings).toEqual({});
		expect(isEnabled).toBe(true);
	});

	it("should have info level by default", () => {
		// Act
		const logger = createTestLogger();

		// Assert
		expect(logger.level).toBe("info");
	});
});

describe("createTestProducer", () => {
	it("should create a mock producer with all required methods", () => {
		// Act
		const producer = createTestProducer();

		// Assert
		expect(producer.connect).toBeDefined();
		expect(producer.disconnect).toBeDefined();
		expect(producer.send).toBeDefined();
	});

	it("should allow overriding methods", async () => {
		// Arrange
		const customSend = vi.fn().mockResolvedValue(undefined);
		const producer = createTestProducer({ send: customSend });

		// Act
		await producer.send({ topic: "test", messages: [] });

		// Assert
		expect(customSend).toHaveBeenCalledWith({ topic: "test", messages: [] });
	});
});

describe("createTestConsumer", () => {
	it("should create a mock consumer with all required methods", () => {
		// Act
		const consumer = createTestConsumer();

		// Assert
		expect(consumer.connect).toBeDefined();
		expect(consumer.disconnect).toBeDefined();
		expect(consumer.subscribe).toBeDefined();
		expect(consumer.run).toBeDefined();
	});

	it("should allow overriding methods", async () => {
		// Arrange
		const customSubscribe = vi.fn().mockResolvedValue(undefined);
		const consumer = createTestConsumer({ subscribe: customSubscribe });

		// Act
		await consumer.subscribe({ topic: "test-topic" });

		// Assert
		expect(customSubscribe).toHaveBeenCalledWith({ topic: "test-topic" });
	});
});

describe("createTestGraphClient", () => {
	it("should create a mock with all required methods", () => {
		// Act
		const client = createTestGraphClient();

		// Assert
		expect(client.connect).toBeDefined();
		expect(client.disconnect).toBeDefined();
		expect(client.query).toBeDefined();
		expect(client.isConnected).toBeDefined();
	});

	it("should have working mock implementations", async () => {
		// Arrange
		const client = createTestGraphClient();

		// Act
		await client.connect();
		const results = await client.query("MATCH (n) RETURN n");
		const connected = client.isConnected();
		await client.disconnect();

		// Assert
		expect(results).toEqual([]);
		expect(connected).toBe(true);
		expect(client.connect).toHaveBeenCalled();
		expect(client.query).toHaveBeenCalledWith("MATCH (n) RETURN n");
		expect(client.disconnect).toHaveBeenCalled();
	});

	it("should allow overriding methods", async () => {
		// Arrange
		const mockData = [{ id: "123", name: "test" }];
		const client = createTestGraphClient({
			query: vi.fn().mockResolvedValue(mockData),
		});

		// Act
		const results = await client.query("MATCH (n) RETURN n");

		// Assert
		expect(results).toEqual(mockData);
	});
});

describe("createTestKafkaClient", () => {
	it("should create a mock with all required methods", () => {
		// Act
		const client = createTestKafkaClient();

		// Assert
		expect(client.getProducer).toBeDefined();
		expect(client.getConsumer).toBeDefined();
		expect(client.disconnect).toBeDefined();
	});

	it("should return mock producer and consumer", async () => {
		// Arrange
		const client = createTestKafkaClient();

		// Act
		const producer = await client.getProducer();
		const consumer = await client.getConsumer({ groupId: "test-group" });

		// Assert
		expect(producer.connect).toBeDefined();
		expect(producer.send).toBeDefined();
		expect(producer.disconnect).toBeDefined();
		expect(consumer.connect).toBeDefined();
		expect(consumer.subscribe).toBeDefined();
		expect(consumer.run).toBeDefined();
		expect(consumer.disconnect).toBeDefined();
	});
});

describe("createTestRedisPublisher", () => {
	it("should create a mock with all required methods", () => {
		// Act
		const publisher = createTestRedisPublisher();

		// Assert
		expect(publisher.publishSessionUpdate).toBeDefined();
		expect(publisher.disconnect).toBeDefined();
	});

	it("should track method calls", async () => {
		// Arrange
		const publisher = createTestRedisPublisher();
		const event = { type: "turn_added", data: {} };

		// Act
		await publisher.publishSessionUpdate("session-123", event);

		// Assert
		expect(publisher.publishSessionUpdate).toHaveBeenCalledWith("session-123", event);
	});

	it("should allow overriding methods", async () => {
		// Arrange
		const customPublish = vi.fn().mockResolvedValue(undefined);
		const publisher = createTestRedisPublisher({
			publishSessionUpdate: customPublish,
		});

		// Act
		await publisher.publishSessionUpdate("session-123", { type: "test" });

		// Assert
		expect(customPublish).toHaveBeenCalledWith("session-123", { type: "test" });
	});
});

describe("createTestBlobStore", () => {
	it("should create a mock with all required methods", () => {
		// Act
		const store = createTestBlobStore();

		// Assert
		expect(store.save).toBeDefined();
		expect(store.load).toBeDefined();
	});

	it("should have working mock implementations", async () => {
		// Arrange
		const store = createTestBlobStore();

		// Act
		const uri = await store.save("test content");
		const content = await store.load(uri);

		// Assert
		expect(uri).toMatch(/^file:\/\//);
		expect(content).toBe("");
	});

	it("should allow overriding methods", async () => {
		// Arrange
		const customLoad = vi.fn().mockResolvedValue("custom content");
		const store = createTestBlobStore({
			load: customLoad,
		});

		// Act
		const content = await store.load("uri://test");

		// Assert
		expect(content).toBe("custom content");
		expect(customLoad).toHaveBeenCalledWith("uri://test");
	});
});

describe("createTestKafkaMessage", () => {
	it("should create a valid Kafka message", () => {
		// Act
		const message = createTestKafkaMessage();

		// Assert
		expect(message.key).toBeInstanceOf(Buffer);
		expect(message.value).toBeInstanceOf(Buffer);
		expect(message.offset).toBe("0");
		expect(message.timestamp).toBeDefined();
	});

	it("should allow overriding properties", () => {
		// Arrange
		const customValue = Buffer.from(JSON.stringify({ custom: "data" }));

		// Act
		const message = createTestKafkaMessage({
			value: customValue,
			offset: "100",
		});

		// Assert
		expect(message.value).toBe(customValue);
		expect(message.offset).toBe("100");
	});
});

// =============================================================================
// Domain Fixture Tests
// =============================================================================

describe("createTestSession", () => {
	it("should create a valid session fixture", () => {
		// Act
		const session = createTestSession();

		// Assert
		expect(session.id).toHaveLength(26);
		expect(session.labels).toEqual(["Session"]);
		expect(session.user_id).toBe("test-user");
		expect(session.started_at).toBeDefined();
		expect(session.vt_start).toBeDefined();
		expect(session.tt_start).toBeDefined();
	});

	it("should allow overriding properties", () => {
		// Act
		const session = createTestSession({
			user_id: "custom-user",
			working_dir: "/home/user/project",
			agent_type: "claude-code",
		});

		// Assert
		expect(session.user_id).toBe("custom-user");
		expect(session.working_dir).toBe("/home/user/project");
		expect(session.agent_type).toBe("claude-code");
	});
});

describe("createTestTurn", () => {
	it("should create a valid turn fixture", () => {
		// Act
		const turn = createTestTurn();

		// Assert
		expect(turn.id).toHaveLength(26);
		expect(turn.labels).toEqual(["Turn"]);
		expect(turn.user_content).toBe("Test user prompt");
		expect(turn.user_content_hash).toHaveLength(64);
		expect(turn.sequence_index).toBe(0);
		expect(turn.files_touched).toEqual([]);
		expect(turn.tool_calls_count).toBe(0);
	});

	it("should allow overriding properties", () => {
		// Act
		const turn = createTestTurn({
			user_content: "How do I create a file?",
			sequence_index: 5,
			tool_calls_count: 3,
		});

		// Assert
		expect(turn.user_content).toBe("How do I create a file?");
		expect(turn.sequence_index).toBe(5);
		expect(turn.tool_calls_count).toBe(3);
	});
});

describe("createTestToolCall", () => {
	it("should create a valid tool call fixture", () => {
		// Act
		const toolCall = createTestToolCall();

		// Assert
		expect(toolCall.id).toHaveLength(26);
		expect(toolCall.labels).toEqual(["ToolCall"]);
		expect(toolCall.call_id).toMatch(/^toolu_/);
		expect(toolCall.tool_name).toBe("TestTool");
		expect(toolCall.tool_type).toBe("unknown");
		expect(toolCall.status).toBe("success");
	});

	it("should allow overriding properties", () => {
		// Act
		const toolCall = createTestToolCall({
			tool_name: "Read",
			tool_type: "file_read",
			arguments_json: JSON.stringify({ file_path: "/src/index.ts" }),
		});

		// Assert
		expect(toolCall.tool_name).toBe("Read");
		expect(toolCall.tool_type).toBe("file_read");
		expect(JSON.parse(toolCall.arguments_json)).toEqual({ file_path: "/src/index.ts" });
	});
});

describe("createTestReasoning", () => {
	it("should create a valid reasoning fixture", () => {
		// Act
		const reasoning = createTestReasoning();

		// Assert
		expect(reasoning.id).toHaveLength(26);
		expect(reasoning.labels).toEqual(["Reasoning"]);
		expect(reasoning.content_hash).toHaveLength(64);
		expect(reasoning.preview).toBe("Test reasoning content");
		expect(reasoning.reasoning_type).toBe("unknown");
	});

	it("should allow overriding properties", () => {
		// Act
		const reasoning = createTestReasoning({
			preview: "I need to read the file first",
			reasoning_type: "planning",
		});

		// Assert
		expect(reasoning.preview).toBe("I need to read the file first");
		expect(reasoning.reasoning_type).toBe("planning");
	});
});

describe("createTestFileTouch", () => {
	it("should create a valid file touch fixture", () => {
		// Act
		const fileTouch = createTestFileTouch();

		// Assert
		expect(fileTouch.id).toHaveLength(26);
		expect(fileTouch.labels).toEqual(["FileTouch"]);
		expect(fileTouch.file_path).toBe("test/file.ts");
		expect(fileTouch.action).toBe("read");
	});

	it("should allow overriding properties", () => {
		// Act
		const fileTouch = createTestFileTouch({
			file_path: "src/index.ts",
			action: "edit",
			lines_added: 10,
			lines_removed: 5,
		});

		// Assert
		expect(fileTouch.file_path).toBe("src/index.ts");
		expect(fileTouch.action).toBe("edit");
		expect(fileTouch.lines_added).toBe(10);
		expect(fileTouch.lines_removed).toBe(5);
	});
});

describe("createTestObservation", () => {
	it("should create a valid observation fixture", () => {
		// Act
		const observation = createTestObservation();

		// Assert
		expect(observation.id).toHaveLength(26);
		expect(observation.labels).toEqual(["Observation"]);
		expect(observation.tool_call_id).toMatch(/^toolu_/);
		expect(observation.content).toBe("Test observation content");
		expect(observation.is_error).toBe(false);
	});

	it("should allow overriding properties", () => {
		// Act
		const observation = createTestObservation({
			content: "Error: File not found",
			is_error: true,
		});

		// Assert
		expect(observation.content).toBe("Error: File not found");
		expect(observation.is_error).toBe(true);
	});
});

// =============================================================================
// Test Utility Tests
// =============================================================================

describe("wait", () => {
	it("should wait for specified duration", async () => {
		// Arrange
		const start = Date.now();

		// Act
		await wait(50);

		// Assert
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small variance
	});
});

describe("createDeferred", () => {
	it("should create a controllable promise", async () => {
		// Arrange
		const { promise, resolve } = createDeferred<string>();
		let resolved = false;

		// Act
		const resultPromise = promise.then((v) => {
			resolved = true;
			return v;
		});

		// Assert - not resolved yet
		await wait(10);
		expect(resolved).toBe(false);

		// Resolve and check
		resolve("done");
		const result = await resultPromise;
		expect(result).toBe("done");
		expect(resolved).toBe(true);
	});

	it("should support rejection", async () => {
		// Arrange
		const { promise, reject } = createDeferred<string>();
		const error = new Error("test error");

		// Act
		reject(error);

		// Assert
		await expect(promise).rejects.toThrow("test error");
	});

	it("should handle rejection with non-Error objects", async () => {
		// Arrange
		const { promise, reject } = createDeferred<string>();

		// Act
		reject("string error");

		// Assert
		await expect(promise).rejects.toBe("string error");
	});
});

describe("expectToReject", () => {
	it("should pass when promise rejects with expected error type", async () => {
		// Arrange
		const promise = Promise.reject(new TypeError("invalid type"));

		// Act & Assert
		const error = await expectToReject(promise, TypeError);
		expect(error).toBeInstanceOf(TypeError);
	});

	it("should pass when error message matches string", async () => {
		// Arrange
		const promise = Promise.reject(new Error("invalid input value"));

		// Act & Assert
		const error = await expectToReject(promise, Error, "invalid input");
		expect(error.message).toContain("invalid input");
	});

	it("should pass when error message matches regex", async () => {
		// Arrange
		const promise = Promise.reject(new Error("Error code: 404"));

		// Act & Assert
		const error = await expectToReject(promise, Error, /code: \d+/);
		expect(error.message).toMatch(/code: \d+/);
	});

	it("should fail when promise resolves", async () => {
		// Arrange
		const promise = Promise.resolve("success");

		// Act
		let thrownError: Error | undefined;
		try {
			await expectToReject(promise, Error);
		} catch (error) {
			thrownError = error as Error;
		}

		// Assert
		expect(thrownError).toBeDefined();
		expect(thrownError?.message).toContain("Expected promise to reject");
	});

	it("should fail when error type does not match", async () => {
		// Arrange
		const promise = Promise.reject(new TypeError("wrong type"));

		// Act
		let thrownError: Error | undefined;
		try {
			await expectToReject(promise, RangeError);
		} catch (error) {
			thrownError = error as Error;
		}

		// Assert
		expect(thrownError).toBeDefined();
		expect(thrownError?.message).toContain("Expected RangeError but got TypeError");
	});

	it("should fail when error message does not match string pattern", async () => {
		// Arrange
		const promise = Promise.reject(new Error("unexpected message"));

		// Act
		let thrownError: Error | undefined;
		try {
			await expectToReject(promise, Error, "expected pattern");
		} catch (error) {
			thrownError = error as Error;
		}

		// Assert
		expect(thrownError).toBeDefined();
		expect(thrownError?.message).toContain("does not match expected pattern");
	});

	it("should fail when error message does not match regex pattern", async () => {
		// Arrange
		const promise = Promise.reject(new Error("error without numbers"));

		// Act
		let thrownError: Error | undefined;
		try {
			await expectToReject(promise, Error, /\d+/);
		} catch (error) {
			thrownError = error as Error;
		}

		// Assert
		expect(thrownError).toBeDefined();
		expect(thrownError?.message).toContain("does not match expected pattern");
	});
});

describe("spyOnConsole", () => {
	it("should capture console.log output", () => {
		// Arrange
		const { logs, restore } = spyOnConsole();

		// Act
		console.log("test message");
		console.log("another", "message");

		// Assert
		expect(logs).toContain("test message");
		expect(logs).toContain("another message");

		// Cleanup
		restore();
	});

	it("should capture console.error output", () => {
		// Arrange
		const { errors, restore } = spyOnConsole();

		// Act
		console.error("error message");

		// Assert
		expect(errors).toContain("error message");

		// Cleanup
		restore();
	});

	it("should capture console.warn output", () => {
		// Arrange
		const { warns, restore } = spyOnConsole();

		// Act
		console.warn("warning message");

		// Assert
		expect(warns).toContain("warning message");

		// Cleanup
		restore();
	});

	it("should restore original console methods", () => {
		// Arrange
		const originalLog = console.log;
		const { restore } = spyOnConsole();

		// Act
		restore();

		// Assert
		expect(console.log).toBe(originalLog);
	});
});
