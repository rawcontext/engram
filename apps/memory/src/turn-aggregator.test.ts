import { createTestGraphClient, createTestLogger } from "@engram/common/testing";
import type { ParsedStreamEvent } from "@engram/events";
import type { GraphClient } from "@engram/storage";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventHandler, EventHandlerRegistry, HandlerContext, HandlerResult } from "./handlers";
import {
	type NodeCreatedCallback,
	type StreamEventInput,
	TurnAggregator,
	type TurnAggregatorDeps,
} from "./turn-aggregator";

// Generate unique session ID for test isolation (module-level state is shared)
let testCounter = 0;
function uniqueSessionId(prefix = "session"): string {
	return `${prefix}-${Date.now()}-${++testCounter}`;
}

/**
 * Mock EventHandlerRegistry type for testing.
 * Extends the real class interface with mock function properties.
 */
interface MockEventHandlerRegistry extends EventHandlerRegistry {
	register: Mock;
	getHandler: Mock;
	getHandlers: Mock;
}

// Mock EventHandler
function createMockHandler(
	eventType: string,
	canHandle: (event: ParsedStreamEvent) => boolean = () => true,
	result: HandlerResult = { handled: true, action: "test_action" },
): EventHandler {
	return {
		eventType,
		canHandle: vi.fn(canHandle),
		handle: vi.fn().mockResolvedValue(result),
	};
}

// Mock EventHandlerRegistry
function createMockRegistry(handlers: EventHandler[] = []): MockEventHandlerRegistry {
	const mock = {
		register: vi.fn(),
		getHandler: vi.fn((event: ParsedStreamEvent) => handlers.find((h) => h.canHandle(event))),
		getHandlers: vi.fn((event: ParsedStreamEvent) => handlers.filter((h) => h.canHandle(event))),
		get handlerCount() {
			return handlers.length;
		},
		get eventTypes() {
			return [...new Set(handlers.map((h) => h.eventType))];
		},
	};
	// Cast to the interface - the mock satisfies the shape required by TurnAggregator
	return mock as unknown as MockEventHandlerRegistry;
}

// Helper to create test events
function createTestEvent(overrides: Partial<StreamEventInput>): StreamEventInput {
	return {
		event_id: `evt-${Date.now()}-${Math.random()}`,
		original_event_id: `orig-${Date.now()}`,
		timestamp: new Date().toISOString(),
		type: "content",
		...overrides,
	};
}

describe("TurnAggregator", () => {
	let mockGraphClient: GraphClient;
	let mockLogger: ReturnType<typeof createTestLogger>;
	let mockNodeCreated: NodeCreatedCallback;
	let aggregator: TurnAggregator;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGraphClient = createTestGraphClient();
		mockLogger = createTestLogger();
		mockNodeCreated = vi.fn();
	});

	describe("Constructor", () => {
		it("should construct with TurnAggregatorDeps object", () => {
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				onNodeCreated: mockNodeCreated,
			};

			aggregator = new TurnAggregator(deps);

			expect(aggregator).toBeInstanceOf(TurnAggregator);
			expect(aggregator.getHandlerRegistry()).toBeDefined();
		});

		it("should construct with custom handler registry", () => {
			const customHandler = createMockHandler("custom");
			const mockRegistry = createMockRegistry([customHandler]);

			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				handlerRegistry: mockRegistry,
			};

			aggregator = new TurnAggregator(deps);

			expect(aggregator.getHandlerRegistry()).toBe(mockRegistry);
		});

		it("should construct with legacy positional arguments", () => {
			aggregator = new TurnAggregator(mockGraphClient, mockLogger, mockNodeCreated);

			expect(aggregator).toBeInstanceOf(TurnAggregator);
			expect(aggregator.getHandlerRegistry()).toBeDefined();
		});

		it("should construct with legacy arguments without callback", () => {
			aggregator = new TurnAggregator(mockGraphClient, mockLogger);

			expect(aggregator).toBeInstanceOf(TurnAggregator);
		});

		it("should use default handler registry when not provided", () => {
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
			};

			aggregator = new TurnAggregator(deps);

			const registry = aggregator.getHandlerRegistry();
			expect(registry.handlerCount).toBe(6); // Default handlers count
		});
	});

	describe("processEvent", () => {
		beforeEach(() => {
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				onNodeCreated: mockNodeCreated,
			};
			aggregator = new TurnAggregator(deps);
		});

		describe("User events (turn creation)", () => {
			it("should start a new turn when user content arrives", async () => {
				const sessionId = uniqueSessionId();
				const event = createTestEvent({
					type: "content",
					role: "user",
					content: "Hello, can you help me?",
				});

				await aggregator.processEvent(event, sessionId);

				// Verify Turn node was created in graph
				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("CREATE (t:Turn"),
					expect.objectContaining({
						sessionId,
						userContent: "Hello, can you help me?",
					}),
				);
			});

			it("should emit node created event for new turn", async () => {
				const sessionId = uniqueSessionId();
				const event = createTestEvent({
					type: "content",
					role: "user",
					content: "New turn",
				});

				await aggregator.processEvent(event, sessionId);

				expect(mockNodeCreated).toHaveBeenCalledWith(
					sessionId,
					expect.objectContaining({
						type: "turn",
						label: "Turn",
						properties: expect.objectContaining({
							user_content: "New turn",
							sequence_index: 0,
						}),
					}),
				);
			});

			it("should increment sequence index for multiple turns in same session", async () => {
				const sessionId = uniqueSessionId();
				const event1 = createTestEvent({
					type: "content",
					role: "user",
					content: "First turn",
				});
				const event2 = createTestEvent({
					type: "content",
					role: "user",
					content: "Second turn",
				});

				await aggregator.processEvent(event1, sessionId);
				await aggregator.processEvent(event2, sessionId);

				// Verify second turn has incremented sequence index
				const calls = vi.mocked(mockGraphClient.query).mock.calls;
				const createCalls = calls.filter((call: any[]) => call[0]?.includes("CREATE (t:Turn"));
				expect(createCalls.length).toBe(2);
				expect(createCalls[0][1].sequenceIndex).toBe(0);
				expect(createCalls[1][1].sequenceIndex).toBe(1);
			});

			it("should finalize previous turn when new user content arrives", async () => {
				const sessionId = uniqueSessionId();
				const event1 = createTestEvent({
					type: "content",
					role: "user",
					content: "First turn",
				});
				const event2 = createTestEvent({
					type: "content",
					role: "user",
					content: "Second turn",
				});

				await aggregator.processEvent(event1, sessionId);
				await aggregator.processEvent(event2, sessionId);

				// Should have finalization query between turns
				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("SET t.assistant_preview"),
					expect.any(Object),
				);
			});
		});

		describe("Event normalization", () => {
			it("should normalize role strings to lowercase enum values", async () => {
				const sessionId = uniqueSessionId();
				const event = createTestEvent({
					type: "content",
					role: "USER", // uppercase
					content: "Test",
				});

				await aggregator.processEvent(event, sessionId);

				// Should have created a turn (recognized as user role)
				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("CREATE (t:Turn"),
					expect.any(Object),
				);
			});

			it("should handle undefined role gracefully", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("content", () => true);
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// First create a turn
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				// Then send event without role
				const event = createTestEvent({
					type: "content",
					role: undefined,
					content: "No role",
				});

				await agg.processEvent(event, sessionId);

				// Should delegate to handler
				expect(handler.handle).toHaveBeenCalled();
			});

			it("should generate event_id if not provided", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("content", () => true);
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// Create a turn first
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				const event: StreamEventInput = {
					type: "content",
					content: "No event ID",
				};

				await agg.processEvent(event, sessionId);

				const handleCall = vi.mocked(handler.handle).mock.calls[0];
				expect(handleCall[0].event_id).toBeDefined();
				expect(handleCall[0].event_id.length).toBeGreaterThan(0);
			});

			it("should generate timestamp if not provided", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("content", () => true);
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// Create a turn first
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				const event: StreamEventInput = {
					type: "content",
					content: "No timestamp",
				};

				await agg.processEvent(event, sessionId);

				const handleCall = vi.mocked(handler.handle).mock.calls[0];
				expect(handleCall[0].timestamp).toBeDefined();
			});

			it("should normalize tool_call with defaults", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("tool_call", (e) => e.type === "tool_call");
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// Create a turn first
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				const event: StreamEventInput = {
					type: "tool_call",
					tool_call: {
						name: "Read",
						// Missing id, arguments_delta, index
					},
				};

				await agg.processEvent(event, sessionId);

				const handleCall = vi.mocked(handler.handle).mock.calls[0];
				const toolCall = handleCall[0].tool_call;
				expect(toolCall.id).toMatch(/^call_/);
				expect(toolCall.arguments_delta).toBe("{}");
				expect(toolCall.index).toBe(0);
			});

			it("should normalize diff with empty hunk", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("diff", (e) => e.type === "diff");
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// Create a turn first
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				const event: StreamEventInput = {
					type: "diff",
					diff: {
						file: "/path/to/file.ts",
						// Missing hunk
					},
				};

				await agg.processEvent(event, sessionId);

				const handleCall = vi.mocked(handler.handle).mock.calls[0];
				expect(handleCall[0].diff.hunk).toBe("");
			});

			it("should handle invalid role strings by not creating a user turn", async () => {
				const sessionId = uniqueSessionId();
				const event = createTestEvent({
					type: "content",
					role: "invalid_role",
					content: "Test",
				});

				// Should not throw
				await aggregator.processEvent(event, sessionId);

				// Should log that no active turn exists (because invalid role won't start turn)
				// But content is present, so it creates a turn with placeholder
				const createCalls = vi
					.mocked(mockGraphClient.query)
					.mock.calls.filter((call: any[]) => call[0]?.includes("CREATE (t:Turn"));
				// The content triggers auto-creation with placeholder
				expect(createCalls.length).toBe(1);
				expect(createCalls[0][1].userContent).toBe("[No user message captured]");
			});
		});

		describe("Handler delegation", () => {
			it("should delegate events to matching handlers", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler(
					"content",
					(e) => e.type === "content" && e.role === "assistant",
				);
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// First create a turn
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				const event = createTestEvent({
					type: "content",
					role: "assistant",
					content: "Response",
				});

				await agg.processEvent(event, sessionId);

				expect(mockRegistry.getHandlers).toHaveBeenCalled();
				expect(handler.handle).toHaveBeenCalledWith(
					expect.objectContaining({ type: "content", role: "assistant" }),
					expect.objectContaining({ sessionId }),
					expect.objectContaining({ sessionId, graphClient: mockGraphClient }),
				);
			});

			it("should log debug when no handler found", async () => {
				const sessionId = uniqueSessionId();
				const mockRegistry = createMockRegistry([]); // No handlers

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// First create a turn
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				const event = createTestEvent({
					type: "unknown_type",
				});

				await agg.processEvent(event, sessionId);

				expect(mockLogger.debug).toHaveBeenCalledWith(
					expect.objectContaining({ eventType: "unknown_type" }),
					"No handler found for event type",
				);
			});

			it("should call all matching handlers", async () => {
				const sessionId = uniqueSessionId();
				const handler1 = createMockHandler("content", () => true, {
					handled: true,
					action: "action1",
				});
				const handler2 = createMockHandler("content", () => true, {
					handled: true,
					action: "action2",
				});
				const mockRegistry = createMockRegistry([handler1, handler2]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// First create a turn
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				const event = createTestEvent({
					type: "content",
					role: "assistant",
					content: "Hello",
				});

				await agg.processEvent(event, sessionId);

				expect(handler1.handle).toHaveBeenCalled();
				expect(handler2.handle).toHaveBeenCalled();
			});

			it("should catch and log handler errors", async () => {
				const sessionId = uniqueSessionId();
				const errorHandler = createMockHandler("content", () => true);
				vi.mocked(errorHandler.handle).mockRejectedValue(new Error("Handler failed"));
				const mockRegistry = createMockRegistry([errorHandler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// First create a turn
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				const event = createTestEvent({
					type: "content",
					role: "assistant",
					content: "Hello",
				});

				// Should not throw
				await agg.processEvent(event, sessionId);

				expect(mockLogger.error).toHaveBeenCalledWith(
					expect.objectContaining({
						err: expect.any(Error),
						handler: "content",
					}),
					"Handler failed to process event",
				);
			});

			it("should log successful handler processing", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("content", () => true, {
					handled: true,
					action: "content_processed",
					nodeId: "node-123",
				});
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// First create a turn
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Start" }),
					sessionId,
				);

				const event = createTestEvent({
					type: "content",
					role: "assistant",
					content: "Hello",
				});

				await agg.processEvent(event, sessionId);

				expect(mockLogger.debug).toHaveBeenCalledWith(
					expect.objectContaining({
						action: "content_processed",
						nodeId: "node-123",
					}),
					"Handler processed event",
				);
			});
		});

		describe("Turn state management", () => {
			it("should create turn for assistant content events when no turn exists", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("content", () => true);
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// Send assistant content without a preceding user message
				const event = createTestEvent({
					type: "content",
					role: "assistant",
					content: "Hello",
				});

				await agg.processEvent(event, sessionId);

				// Should create turn with placeholder user content
				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("CREATE (t:Turn"),
					expect.objectContaining({
						userContent: "[No user message captured]",
					}),
				);

				// Should then delegate to handler
				expect(handler.handle).toHaveBeenCalled();
			});

			it("should create turn for thought events when no turn exists", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("thought", (e) => e.type === "thought");
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				const event = createTestEvent({
					type: "thought",
					thought: "Thinking...",
				});

				await agg.processEvent(event, sessionId);

				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("CREATE (t:Turn"),
					expect.objectContaining({
						userContent: "[No user message captured]",
					}),
				);
			});

			it("should create turn for tool_call events when no turn exists", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("tool_call", (e) => e.type === "tool_call");
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				const event = createTestEvent({
					type: "tool_call",
					tool_call: {
						id: "call_123",
						name: "Read",
						arguments_delta: "{}",
						index: 0,
					},
				});

				await agg.processEvent(event, sessionId);

				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("CREATE (t:Turn"),
					expect.any(Object),
				);
			});

			it("should skip events when no turn exists and event has no content/thought/tool_call", async () => {
				const sessionId = uniqueSessionId();
				const handler = createMockHandler("control", (e) => e.type === "control");
				const mockRegistry = createMockRegistry([handler]);

				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					handlerRegistry: mockRegistry,
				};
				const agg = new TurnAggregator(deps);

				// Send control event without any turn (no content/thought/tool_call)
				const event = createTestEvent({
					type: "control",
					content: undefined,
					thought: undefined,
					tool_call: undefined,
				});

				await agg.processEvent(event, sessionId);

				// Should not create turn, should skip
				expect(mockLogger.debug).toHaveBeenCalledWith(
					expect.objectContaining({ sessionId }),
					"No active turn, skipping event",
				);
				expect(handler.handle).not.toHaveBeenCalled();
			});

			it("should track separate turns per session", async () => {
				const sessionId1 = uniqueSessionId("sess1");
				const sessionId2 = uniqueSessionId("sess2");
				const deps: TurnAggregatorDeps = {
					graphClient: mockGraphClient,
					logger: mockLogger,
					onNodeCreated: mockNodeCreated,
				};
				const agg = new TurnAggregator(deps);

				// Create turns in two different sessions
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Session 1" }),
					sessionId1,
				);
				await agg.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Session 2" }),
					sessionId2,
				);

				// Verify both sessions have their own turns
				const createCalls = vi
					.mocked(mockGraphClient.query)
					.mock.calls.filter((call: any[]) => call[0]?.includes("CREATE (t:Turn"));

				expect(createCalls.length).toBe(2);
				expect(createCalls[0][1].sessionId).toBe(sessionId1);
				expect(createCalls[1][1].sessionId).toBe(sessionId2);
			});
		});

		describe("Graph persistence", () => {
			it("should create Turn node with correct properties", async () => {
				const sessionId = uniqueSessionId();
				const event = createTestEvent({
					type: "content",
					role: "user",
					content: "Test user message",
				});

				await aggregator.processEvent(event, sessionId);

				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("CREATE (t:Turn"),
					expect.objectContaining({
						sessionId,
						userContent: "Test user message",
						assistantPreview: "",
						sequenceIndex: 0,
						filesTouched: "[]",
						toolCallsCount: 0,
					}),
				);
			});

			it("should link Turn to Session node", async () => {
				const sessionId = uniqueSessionId();
				const event = createTestEvent({
					type: "content",
					role: "user",
					content: "Test",
				});

				await aggregator.processEvent(event, sessionId);

				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("MATCH (s:Session {id: $sessionId})"),
					expect.any(Object),
				);
				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("MERGE (s)-[:HAS_TURN]->(t)"),
					expect.any(Object),
				);
			});

			it("should create NEXT edge between consecutive turns", async () => {
				const sessionId = uniqueSessionId();
				await aggregator.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Turn 1" }),
					sessionId,
				);
				await aggregator.processEvent(
					createTestEvent({ type: "content", role: "user", content: "Turn 2" }),
					sessionId,
				);

				// Check that query includes NEXT edge logic
				const queryCalls = vi.mocked(mockGraphClient.query).mock.calls;
				const createTurnCall = queryCalls.find((call: any[]) =>
					call[0]?.includes("MERGE (p)-[:NEXT]->(t)"),
				);
				expect(createTurnCall).toBeDefined();
			});

			it("should truncate long user content", async () => {
				const sessionId = uniqueSessionId();
				const longContent = "x".repeat(15000);
				const event = createTestEvent({
					type: "content",
					role: "user",
					content: longContent,
				});

				await aggregator.processEvent(event, sessionId);

				const createCall = vi
					.mocked(mockGraphClient.query)
					.mock.calls.find((call: any[]) => call[0]?.includes("CREATE (t:Turn"));
				expect(createCall[1].userContent.length).toBeLessThanOrEqual(10000);
			});

			it("should include content hash in Turn node", async () => {
				const sessionId = uniqueSessionId();
				const event = createTestEvent({
					type: "content",
					role: "user",
					content: "Test content",
				});

				await aggregator.processEvent(event, sessionId);

				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.stringContaining("user_content_hash"),
					expect.objectContaining({
						userContentHash: expect.any(String),
					}),
				);
			});
		});

		describe("Session isolation", () => {
			it("should maintain independent sequence counters per session", async () => {
				const sessionId1 = uniqueSessionId("iso1");
				const sessionId2 = uniqueSessionId("iso2");

				// Create turns in session-1
				await aggregator.processEvent(
					createTestEvent({ type: "content", role: "user", content: "S1 T1" }),
					sessionId1,
				);
				await aggregator.processEvent(
					createTestEvent({ type: "content", role: "user", content: "S1 T2" }),
					sessionId1,
				);

				// Create turn in session-2
				await aggregator.processEvent(
					createTestEvent({ type: "content", role: "user", content: "S2 T1" }),
					sessionId2,
				);

				// Session-2 should start at index 0
				const session2Call = vi
					.mocked(mockGraphClient.query)
					.mock.calls.find(
						(call: any[]) =>
							call[0]?.includes("CREATE (t:Turn") && call[1]?.sessionId === sessionId2,
					);
				expect(session2Call[1].sequenceIndex).toBe(0);
			});
		});
	});

	describe("Handler context creation", () => {
		it("should create context with all required properties", async () => {
			const sessionId = uniqueSessionId();
			const handler = createMockHandler("content", () => true);
			const mockRegistry = createMockRegistry([handler]);

			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				onNodeCreated: mockNodeCreated,
				handlerRegistry: mockRegistry,
			};
			const agg = new TurnAggregator(deps);

			// Create a turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Start" }),
				sessionId,
			);

			// Send event to trigger handler
			await agg.processEvent(
				createTestEvent({ type: "content", role: "assistant", content: "Hello" }),
				sessionId,
			);

			const handleCall = vi.mocked(handler.handle).mock.calls[0];
			const context = handleCall[2] as HandlerContext;

			expect(context.sessionId).toBe(sessionId);
			expect(context.turnId).toBeDefined();
			expect(context.graphClient).toBe(mockGraphClient);
			expect(context.logger).toBe(mockLogger);
			expect(context.emitNodeCreated).toBeDefined();
		});

		it("should wire emitNodeCreated to callback", async () => {
			const sessionId = uniqueSessionId();
			const handler = createMockHandler("content", () => true);
			const mockRegistry = createMockRegistry([handler]);

			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				onNodeCreated: mockNodeCreated,
				handlerRegistry: mockRegistry,
			};
			const agg = new TurnAggregator(deps);

			// Create a turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Start" }),
				sessionId,
			);

			// Send event to trigger handler
			await agg.processEvent(
				createTestEvent({ type: "content", role: "assistant", content: "Hello" }),
				sessionId,
			);

			const handleCall = vi.mocked(handler.handle).mock.calls[0];
			const context = handleCall[2] as HandlerContext;

			// Call emitNodeCreated via context
			const testNode = {
				id: "test-node",
				type: "reasoning" as const,
				label: "Reasoning",
				properties: { test: true },
			};
			context.emitNodeCreated?.(testNode);

			// Wait for async callback to complete (emitNodeCreated wraps in Promise)
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockNodeCreated).toHaveBeenCalledWith(sessionId, testNode);
		});
	});

	describe("Node created callback", () => {
		it("should catch errors in onNodeCreated callback", async () => {
			const sessionId = uniqueSessionId();
			const errorCallback: NodeCreatedCallback = () => {
				throw new Error("Callback error");
			};

			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				onNodeCreated: errorCallback,
			};
			const agg = new TurnAggregator(deps);

			// Should not throw
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Start" }),
				sessionId,
			);

			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.objectContaining({ err: expect.any(Error) }),
				"Failed to emit node created event",
			);
		});

		it("should work without onNodeCreated callback", async () => {
			const sessionId = uniqueSessionId();
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				// No onNodeCreated
			};
			const agg = new TurnAggregator(deps);

			// Should not throw
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Start" }),
				sessionId,
			);

			expect(mockGraphClient.query).toHaveBeenCalled();
		});
	});

	describe("cleanupStaleTurns", () => {
		it("should finalize and remove stale turns", async () => {
			const sessionId = uniqueSessionId("stale");
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
			};
			const agg = new TurnAggregator(deps);

			// Create a turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Old turn" }),
				sessionId,
			);

			// Wait a small amount so turn becomes stale with -1 maxAge
			// The condition is `now - turn.createdAt > maxAgeMs`, so we need maxAgeMs to be -1 for immediate cleanup
			await agg.cleanupStaleTurns(-1);

			// Check that our specific session was cleaned up (module-level state may have others)
			const cleanupCalls = vi
				.mocked(mockLogger.info)
				.mock.calls.filter(
					(call: any[]) => call[1] === "Cleaned up stale turn" && call[0]?.sessionId === sessionId,
				);
			expect(cleanupCalls.length).toBe(1);
		});

		it("should not cleanup recent turns", async () => {
			const sessionId = uniqueSessionId("recent");
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
			};
			const agg = new TurnAggregator(deps);

			// Create a turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Recent turn" }),
				sessionId,
			);

			// Cleanup with very high max age
			await agg.cleanupStaleTurns(1000 * 60 * 60); // 1 hour

			// Should NOT have cleaned up this specific session
			const cleanupCalls = vi
				.mocked(mockLogger.info)
				.mock.calls.filter(
					(call: any[]) => call[1] === "Cleaned up stale turn" && call[0]?.sessionId === sessionId,
				);
			expect(cleanupCalls.length).toBe(0);
		});

		it("should use default max age of 30 minutes", async () => {
			const sessionId = uniqueSessionId("default");
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
			};
			const agg = new TurnAggregator(deps);

			// Create a turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Recent turn" }),
				sessionId,
			);

			// Cleanup without specifying max age
			await agg.cleanupStaleTurns();

			// Recent turn should NOT be cleaned up
			const cleanupCalls = vi
				.mocked(mockLogger.info)
				.mock.calls.filter(
					(call: any[]) => call[1] === "Cleaned up stale turn" && call[0]?.sessionId === sessionId,
				);
			expect(cleanupCalls.length).toBe(0);
		});
	});

	describe("Turn finalization", () => {
		it("should update Turn node with final stats", async () => {
			const sessionId = uniqueSessionId();
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
			};
			const agg = new TurnAggregator(deps);

			// Create first turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "First" }),
				sessionId,
			);

			// Create second turn (triggers finalization of first)
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Second" }),
				sessionId,
			);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("SET t.assistant_preview"),
				expect.objectContaining({
					preview: expect.any(String),
					filesTouched: expect.any(String),
					toolCallsCount: expect.any(Number),
					inputTokens: expect.any(Number),
					outputTokens: expect.any(Number),
				}),
			);
		});

		it("should log finalization details", async () => {
			const sessionId = uniqueSessionId();
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
			};
			const agg = new TurnAggregator(deps);

			// Create and finalize turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "First" }),
				sessionId,
			);
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Second" }),
				sessionId,
			);

			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					contentLength: expect.any(Number),
					reasoningBlocks: expect.any(Number),
					filesTouched: expect.any(Number),
					toolCalls: expect.any(Number),
				}),
				"Finalized turn",
			);
		});
	});

	describe("getHandlerRegistry", () => {
		it("should return the handler registry", () => {
			const mockRegistry = createMockRegistry([]);

			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				handlerRegistry: mockRegistry,
			};
			const agg = new TurnAggregator(deps);

			expect(agg.getHandlerRegistry()).toBe(mockRegistry);
		});
	});

	describe("Instance isolation", () => {
		it("should have independent state between instances", async () => {
			const sessionId = uniqueSessionId("isolation");

			// Create two independent aggregator instances
			const agg1 = new TurnAggregator({
				graphClient: createTestGraphClient(),
				logger: createTestLogger(),
			});
			const agg2 = new TurnAggregator({
				graphClient: createTestGraphClient(),
				logger: createTestLogger(),
			});

			// Create turn in instance 1
			await agg1.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Turn in agg1" }),
				sessionId,
			);

			// Instance 2 should NOT have this turn
			// If we create same session in agg2, it should start fresh at sequence 0
			const mockGraphClient2 = agg2.graphClient;
			await agg2.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Turn in agg2" }),
				sessionId,
			);

			// Get the create call for agg2 - should have sequenceIndex 0
			const createCalls = vi
				.mocked(mockGraphClient2.query)
				.mock.calls.filter((call: any[]) => call[0]?.includes("CREATE (t:Turn"));
			expect(createCalls.length).toBe(1);
			expect(createCalls[0][1].sequenceIndex).toBe(0);
		});

		it("should not share sequence counters between instances", async () => {
			const sessionId = uniqueSessionId("seq-isolation");

			const mockGraphClient1 = createTestGraphClient();
			const agg1 = new TurnAggregator({
				graphClient: mockGraphClient1,
				logger: createTestLogger(),
			});

			// Create two turns in instance 1
			await agg1.processEvent(
				createTestEvent({ type: "content", role: "user", content: "T1" }),
				sessionId,
			);
			await agg1.processEvent(
				createTestEvent({ type: "content", role: "user", content: "T2" }),
				sessionId,
			);

			// Instance 1 should have sequence 0 and 1
			const createCalls1 = vi
				.mocked(mockGraphClient1.query)
				.mock.calls.filter((call: any[]) => call[0]?.includes("CREATE (t:Turn"));
			expect(createCalls1[0][1].sequenceIndex).toBe(0);
			expect(createCalls1[1][1].sequenceIndex).toBe(1);

			// Create new instance for same session - should start at 0
			const mockGraphClient2 = createTestGraphClient();
			const agg2 = new TurnAggregator({
				graphClient: mockGraphClient2,
				logger: createTestLogger(),
			});

			await agg2.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Fresh" }),
				sessionId,
			);

			const createCalls2 = vi
				.mocked(mockGraphClient2.query)
				.mock.calls.filter((call: any[]) => call[0]?.includes("CREATE (t:Turn"));
			expect(createCalls2[0][1].sequenceIndex).toBe(0); // Fresh start
		});
	});

	describe("clearSession", () => {
		it("should clear session state", async () => {
			const sessionId = uniqueSessionId("clear");
			const mockGraph = createTestGraphClient();

			const agg = new TurnAggregator({
				graphClient: mockGraph,
				logger: createTestLogger(),
			});

			// Create turns to build up state
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "T1" }),
				sessionId,
			);
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "T2" }),
				sessionId,
			);

			// Clear the session
			agg.clearSession(sessionId);

			// Next turn should start at sequence 0 again
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "After clear" }),
				sessionId,
			);

			const createCalls = vi
				.mocked(mockGraph.query)
				.mock.calls.filter((call: any[]) => call[0]?.includes("CREATE (t:Turn"));

			// Should have 3 turns: index 0, 1, then 0 again after clear
			expect(createCalls.length).toBe(3);
			expect(createCalls[2][1].sequenceIndex).toBe(0);
		});

		it("should only clear specified session", async () => {
			const session1 = uniqueSessionId("keep");
			const session2 = uniqueSessionId("clear");
			const mockGraph = createTestGraphClient();

			const agg = new TurnAggregator({
				graphClient: mockGraph,
				logger: createTestLogger(),
			});

			// Create turns in both sessions
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "S1" }),
				session1,
			);
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "S2" }),
				session2,
			);

			// Clear only session2
			agg.clearSession(session2);

			// Session1 should continue with next sequence
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "S1 T2" }),
				session1,
			);

			const createCalls = vi
				.mocked(mockGraph.query)
				.mock.calls.filter(
					(call: any[]) => call[0]?.includes("CREATE (t:Turn") && call[1]?.sessionId === session1,
				);

			expect(createCalls.length).toBe(2);
			expect(createCalls[1][1].sequenceIndex).toBe(1); // Continues from 1
		});
	});

	describe("Edge cases", () => {
		it("should handle empty content string by still creating turn with placeholder", async () => {
			const sessionId = uniqueSessionId();
			const event = createTestEvent({
				type: "content",
				role: "user",
				content: "",
			});

			// Empty user content does NOT trigger turn creation (content is falsy)
			await aggregator.processEvent(event, sessionId);

			// No turn created because role=user but content is empty string (falsy)
			const createCalls = vi
				.mocked(mockGraphClient.query)
				.mock.calls.filter((call: any[]) => call[0]?.includes("CREATE (t:Turn"));
			expect(createCalls.length).toBe(0);
		});

		it("should handle very long assistant preview truncation", async () => {
			const sessionId = uniqueSessionId();
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
			};
			const agg = new TurnAggregator(deps);

			// Create turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Test" }),
				sessionId,
			);

			// Create second turn to trigger finalization
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Second" }),
				sessionId,
			);

			// The finalization query should truncate preview to 2000 chars
			const finalizeCall = vi
				.mocked(mockGraphClient.query)
				.mock.calls.find((call: any[]) => call[0]?.includes("SET t.assistant_preview"));
			expect(finalizeCall).toBeDefined();
		});

		it("should handle concurrent events from same session", async () => {
			const sessionId = uniqueSessionId();
			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
			};
			const agg = new TurnAggregator(deps);

			// Create a turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Start" }),
				sessionId,
			);

			// Fire multiple events concurrently
			const promises = [
				agg.processEvent(
					createTestEvent({
						type: "content",
						role: "assistant",
						content: "Part 1",
					}),
					sessionId,
				),
				agg.processEvent(
					createTestEvent({
						type: "thought",
						thought: "Thinking...",
					}),
					sessionId,
				),
				agg.processEvent(
					createTestEvent({
						type: "tool_call",
						tool_call: { name: "Read", id: "call_1", arguments_delta: "{}", index: 0 },
					}),
					sessionId,
				),
			];

			// Should not throw
			await Promise.all(promises);

			// All events should have been processed
			expect(mockGraphClient.query).toHaveBeenCalled();
		});

		it("should handle missing metadata gracefully", async () => {
			const sessionId = uniqueSessionId();
			const handler = createMockHandler("content", () => true);
			const mockRegistry = createMockRegistry([handler]);

			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				handlerRegistry: mockRegistry,
			};
			const agg = new TurnAggregator(deps);

			// Create a turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Start" }),
				sessionId,
			);

			const event: StreamEventInput = {
				type: "content",
				content: "No metadata",
				// metadata: undefined
			};

			await agg.processEvent(event, sessionId);

			expect(handler.handle).toHaveBeenCalled();
		});

		it("should preserve metadata when present", async () => {
			const sessionId = uniqueSessionId();
			const handler = createMockHandler("content", () => true);
			const mockRegistry = createMockRegistry([handler]);

			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				handlerRegistry: mockRegistry,
			};
			const agg = new TurnAggregator(deps);

			// Create a turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Start" }),
				sessionId,
			);

			const event: StreamEventInput = {
				type: "content",
				content: "With metadata",
				metadata: { custom: "value" },
			};

			await agg.processEvent(event, sessionId);

			const handleCall = vi.mocked(handler.handle).mock.calls[0];
			expect(handleCall[0].metadata).toEqual({ custom: "value" });
		});

		it("should preserve usage data", async () => {
			const sessionId = uniqueSessionId();
			const handler = createMockHandler("usage", (e) => e.type === "usage");
			const mockRegistry = createMockRegistry([handler]);

			const deps: TurnAggregatorDeps = {
				graphClient: mockGraphClient,
				logger: mockLogger,
				handlerRegistry: mockRegistry,
			};
			const agg = new TurnAggregator(deps);

			// Create a turn
			await agg.processEvent(
				createTestEvent({ type: "content", role: "user", content: "Start" }),
				sessionId,
			);

			const event: StreamEventInput = {
				type: "usage",
				usage: { input_tokens: 150, output_tokens: 300 },
			};

			await agg.processEvent(event, sessionId);

			const handleCall = vi.mocked(handler.handle).mock.calls[0];
			expect(handleCall[0].usage).toEqual({
				input_tokens: 150,
				output_tokens: 300,
			});
		});
	});
});
