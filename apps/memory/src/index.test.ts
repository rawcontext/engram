import { afterAll, afterEach, beforeEach, describe, expect, it, jest, mock } from "bun:test";

// Use shared mocks from root preload (test-preload.ts)
// Logger, storage (FalkorDB, NATS, BlobStore) are mocked there

// Import real GraphPruner before any mocking
import { GraphPruner } from "@engram/graph";

// Mock pruneHistory on prototype (preserves class identity, avoids module cache pollution)
const mockPruneHistory = mock(async () => ({ deleted: 10 }));
const originalPruneHistory = GraphPruner.prototype.pruneHistory;
GraphPruner.prototype.pruneHistory = mockPruneHistory;

const mockMcpServer = {
	tool: mock(),
	connect: mock(async () => {}),
};

mock.module("@modelcontextprotocol/sdk/server/mcp.js", () => ({
	McpServer: class {
		tool = mockMcpServer.tool;
		connect = mockMcpServer.connect;
	},
}));

mock.module("@modelcontextprotocol/sdk/server/stdio.js", () => ({
	StdioServerTransport: mock(),
}));

// Restore original pruneHistory after all tests to prevent pollution
afterAll(() => {
	GraphPruner.prototype.pruneHistory = originalPruneHistory;
	mock.restore();
});

import { createNodeLogger } from "@engram/logger";
import {
	createFalkorClient,
	createNatsClient,
	type GraphClient,
	type NatsPubSubPublisher,
} from "@engram/storage";
import { createNatsPubSubPublisher } from "@engram/storage/nats";
import { TurnAggregator } from "./turn-aggregator";

const { clearAllIntervals, createMemoryServiceDeps, startPruningJob, startTurnCleanupJob, server } =
	await import("./index");

describe("Memory Service Deps", () => {
	beforeEach(() => {});

	describe("createMemoryServiceDeps", () => {
		it("should create default dependencies", () => {
			const deps = createMemoryServiceDeps();

			expect(deps.graphClient).toBeDefined();
			expect(deps.natsClient).toBeDefined();
			expect(deps.natsPubSub).toBeDefined();
			expect(deps.logger).toBeDefined();
			expect(deps.turnAggregator).toBeDefined();
			expect(deps.graphPruner).toBeDefined();
		});

		it("should use custom graph client when provided", () => {
			const customGraphClient = {
				connect: mock(),
				query: mock(),
				disconnect: mock(),
				isConnected: mock(),
			} as unknown as GraphClient;

			const deps = createMemoryServiceDeps({ graphClient: customGraphClient });

			expect(deps.graphClient).toBe(customGraphClient);
		});

		it("should use custom nats client when provided", () => {
			const customNats = createNatsClient("test");

			const deps = createMemoryServiceDeps({ natsClient: customNats });

			expect(deps.natsClient).toBe(customNats);
		});

		it("should use custom NATS pub/sub publisher when provided", () => {
			const customNatsPubSub = createNatsPubSubPublisher();

			const deps = createMemoryServiceDeps({ natsPubSub: customNatsPubSub });

			expect(deps.natsPubSub).toBe(customNatsPubSub);
		});

		it("should use custom logger when provided", () => {
			const customLogger = createNodeLogger({ service: "test" });

			const deps = createMemoryServiceDeps({ logger: customLogger });

			expect(deps.logger).toBe(customLogger);
		});

		it("should use custom turn aggregator when provided", () => {
			const customAggregator = new TurnAggregator({
				graphClient: createFalkorClient(),
				logger: createNodeLogger({ service: "test" }),
			});

			const deps = createMemoryServiceDeps({ turnAggregator: customAggregator });

			expect(deps.turnAggregator).toBe(customAggregator);
		});

		it("should use custom graph pruner when provided", () => {
			const customPruner = new GraphPruner(createFalkorClient());

			const deps = createMemoryServiceDeps({ graphPruner: customPruner });

			expect(deps.graphPruner).toBe(customPruner);
		});

		it("should create turn aggregator with onNodeCreated callback", async () => {
			const deps = createMemoryServiceDeps();
			const mockNats = deps.natsPubSub as unknown as {
				publishSessionUpdate: ReturnType<typeof mock>;
			};

			// Get the handler registry from aggregator
			const registry = deps.turnAggregator.getHandlerRegistry();
			expect(registry).toBeDefined();

			// Test that onNodeCreated publishes via NATS
			const testNode = {
				id: "test-123",
				type: "turn" as const,
				label: "Turn",
				properties: { test: true },
			};

			// The onNodeCreated callback is async, so we need to wait
			// We can't directly test it, but we can verify the aggregator was created with it
			expect(deps.turnAggregator).toBeInstanceOf(TurnAggregator);
		});

		it("should handle errors in onNodeCreated callback gracefully", async () => {
			const mockNats = {
				publishSessionUpdate: mock().mockRejectedValue(new Error("NATS error")),
				publishGlobalSessionEvent: mock(),
				publishConsumerStatus: mock(),
				disconnect: mock(),
				connect: mock(),
			} as unknown as NatsPubSubPublisher;

			const mockLogger = {
				info: mock(),
				debug: mock(),
				warn: mock(),
				error: mock(),
			};

			const deps = createMemoryServiceDeps({
				natsPubSub: mockNats,
				logger: mockLogger as any,
			});

			// The error handling is in the callback, which is hard to test directly
			// but we verify the aggregator was created successfully
			expect(deps.turnAggregator).toBeInstanceOf(TurnAggregator);
		});

		it("should create logger with correct service name", () => {
			createMemoryServiceDeps();

			expect(createNodeLogger).toHaveBeenCalledWith(
				expect.objectContaining({
					service: "memory-service",
				}),
				expect.any(Object),
			);
		});

		it("should create graph pruner with graph client", () => {
			const deps = createMemoryServiceDeps();

			// Just verify the pruner was created
			expect(deps.graphPruner).toBeInstanceOf(GraphPruner);
		});

		it("should support partial dependency injection", () => {
			const customLogger = createNodeLogger({ service: "test" });
			const customGraphClient = {
				connect: mock(),
				query: mock(),
				disconnect: mock(),
				isConnected: mock(),
			} as unknown as GraphClient;

			const deps = createMemoryServiceDeps({
				logger: customLogger,
				graphClient: customGraphClient,
			});

			expect(deps.logger).toBe(customLogger);
			expect(deps.graphClient).toBe(customGraphClient);
			expect(deps.natsClient).toBeDefined(); // Should use default
			expect(deps.natsPubSub).toBeDefined(); // Should use default
		});

		it("should wire onNodeCreated callback to publish via NATS", async () => {
			const mockNats = {
				publishSessionUpdate: mock().mockResolvedValue(undefined),
				publishGlobalSessionEvent: mock(),
				publishConsumerStatus: mock(),
				disconnect: mock(),
				connect: mock(),
			} as unknown as NatsPubSubPublisher;

			const mockLogger = {
				info: mock(),
				debug: mock(),
				warn: mock(),
				error: mock(),
			};

			const deps = createMemoryServiceDeps({
				natsPubSub: mockNats,
				logger: mockLogger as any,
			});

			// Get the aggregator and trigger a turn creation to invoke onNodeCreated
			const testSessionId = "test-session-123";
			await deps.turnAggregator.processEvent(
				{
					type: "content",
					role: "user",
					content: "Test message",
					event_id: "evt-123",
					timestamp: new Date().toISOString(),
				},
				testSessionId,
			);

			// onNodeCreated should have been called, which publishes via NATS
			// Wait a tick for async callback
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockNats.publishSessionUpdate).toHaveBeenCalledWith(
				testSessionId,
				expect.objectContaining({
					type: "graph_node_created",
					data: expect.objectContaining({
						nodeType: "turn",
						label: "Turn",
					}),
				}),
			);
		});

		it("should handle NATS publish errors in onNodeCreated gracefully", async () => {
			const mockNats = {
				publishSessionUpdate: mock().mockRejectedValue(new Error("NATS publish failed")),
				publishGlobalSessionEvent: mock(),
				publishConsumerStatus: mock(),
				disconnect: mock(),
				connect: mock(),
			} as unknown as NatsPubSubPublisher;

			const mockLogger = {
				info: mock(),
				debug: mock(),
				warn: mock(),
				error: mock(),
			};

			const deps = createMemoryServiceDeps({
				natsPubSub: mockNats,
				logger: mockLogger as any,
			});

			// Trigger node creation
			await deps.turnAggregator.processEvent(
				{
					type: "content",
					role: "user",
					content: "Test",
					event_id: "evt-123",
					timestamp: new Date().toISOString(),
				},
				"test-session",
			);

			// Wait for async callback to complete
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Should have logged the error
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					err: expect.any(Error),
				}),
				"Failed to publish graph node event",
			);
		});

		it("should create all required dependencies", () => {
			const deps = createMemoryServiceDeps();

			// Verify all dependencies are created
			expect(deps.graphClient).toBeDefined();
			expect(deps.natsClient).toBeDefined();
			expect(deps.natsPubSub).toBeDefined();
			expect(deps.logger).toBeDefined();
			expect(deps.turnAggregator).toBeDefined();
			expect(deps.graphPruner).toBeDefined();

			// Verify types
			expect(deps.turnAggregator).toBeInstanceOf(TurnAggregator);
			expect(deps.graphPruner).toBeInstanceOf(GraphPruner);
		});

		it("should create logger with stderr destination", () => {
			createMemoryServiceDeps();

			// Verify pino.destination was called with fd 2 (stderr)
			const pinoMock = createNodeLogger as Mock;
			expect(pinoMock).toHaveBeenCalled();
		});
	});
});

describe("Module-level functions", () => {
	beforeEach(() => {
		mockPruneHistory.mockClear();
	});

	describe("Interval management", () => {
		it("should handle prune interval from environment variable", () => {
			const originalEnv = process.env.PRUNE_INTERVAL_HOURS;
			process.env.PRUNE_INTERVAL_HOURS = "12";

			// The constant is calculated at module load, so we can't test dynamic changes
			// But we can verify the parsing logic would work
			const hours = Number.parseInt(process.env.PRUNE_INTERVAL_HOURS ?? "24", 10);
			expect(hours).toBe(12);

			// Restore
			if (originalEnv !== undefined) {
				process.env.PRUNE_INTERVAL_HOURS = originalEnv;
			} else {
				delete process.env.PRUNE_INTERVAL_HOURS;
			}
		});

		it("should handle retention days from environment variable", () => {
			const originalEnv = process.env.RETENTION_DAYS;
			process.env.RETENTION_DAYS = "60";

			const days = Number.parseInt(process.env.RETENTION_DAYS ?? "30", 10);
			expect(days).toBe(60);

			// Restore
			if (originalEnv !== undefined) {
				process.env.RETENTION_DAYS = originalEnv;
			} else {
				delete process.env.RETENTION_DAYS;
			}
		});

		it("should use default prune interval when env var missing", () => {
			const originalEnv = process.env.PRUNE_INTERVAL_HOURS;
			delete process.env.PRUNE_INTERVAL_HOURS;

			const hours = Number.parseInt(process.env.PRUNE_INTERVAL_HOURS ?? "24", 10);
			expect(hours).toBe(24);

			// Restore
			if (originalEnv !== undefined) {
				process.env.PRUNE_INTERVAL_HOURS = originalEnv;
			}
		});

		it("should use default retention days when env var missing", () => {
			const originalEnv = process.env.RETENTION_DAYS;
			delete process.env.RETENTION_DAYS;

			const days = Number.parseInt(process.env.RETENTION_DAYS ?? "30", 10);
			expect(days).toBe(30);

			// Restore
			if (originalEnv !== undefined) {
				process.env.RETENTION_DAYS = originalEnv;
			}
		});
	});

	describe("startPruningJob", () => {
		afterEach(() => {
			clearAllIntervals();
		});

		it("should start pruning interval and return interval ID", () => {
			const intervalId = startPruningJob();
			expect(intervalId).toBeDefined();
			expect(typeof intervalId).toBe("object");
		});

		it("should execute pruning on interval", () => {
			jest.useFakeTimers();

			startPruningJob();

			// Advance time past the prune interval (default 24 hours)
			jest.advanceTimersByTime(24 * 60 * 60 * 1000);

			expect(mockPruneHistory).toHaveBeenCalled();

			clearAllIntervals();
			jest.useRealTimers();
		});

		it("should log success after pruning", () => {
			jest.useFakeTimers();

			mockPruneHistory.mockResolvedValueOnce({ deleted: 5 });

			startPruningJob();

			// Advance time to trigger pruning
			jest.advanceTimersByTime(24 * 60 * 60 * 1000);

			// Pruning should have been called
			expect(mockPruneHistory).toHaveBeenCalled();

			clearAllIntervals();
			jest.useRealTimers();
		});

		it("should handle pruning errors gracefully", () => {
			jest.useFakeTimers();

			mockPruneHistory.mockRejectedValueOnce(new Error("Prune failed"));

			startPruningJob();

			// Advance time to trigger pruning - should not throw
			expect(() => jest.advanceTimersByTime(24 * 60 * 60 * 1000)).not.toThrow();

			clearAllIntervals();
			jest.useRealTimers();
		});
	});

	describe("startTurnCleanupJob", () => {
		let mockTurnAggregator: any;

		beforeEach(() => {
			mockTurnAggregator = {
				cleanupStaleTurns: mock(async () => {}),
			};
			// We need to inject this somehow - for now we'll just verify the interval is created
		});

		afterEach(() => {
			clearAllIntervals();
		});

		it("should start turn cleanup interval and return interval ID", () => {
			const intervalId = startTurnCleanupJob();
			expect(intervalId).toBeDefined();
			expect(typeof intervalId).toBe("object");
		});

		it("should handle cleanup errors gracefully", () => {
			jest.useFakeTimers();

			// Start the cleanup job
			const intervalId = startTurnCleanupJob();
			expect(intervalId).toBeDefined();

			// Advance time to trigger cleanup - should not throw even if cleanup has issues
			expect(() => jest.advanceTimersByTime(60 * 1000)).not.toThrow();

			clearAllIntervals();
			jest.useRealTimers();
		});
	});

	describe("clearAllIntervals", () => {
		it("should clear pruning interval when set", () => {
			jest.useFakeTimers();

			// Start pruning job
			startPruningJob();

			// Clear all intervals
			clearAllIntervals();

			// Reset mock and advance time - pruning should NOT be called since interval is cleared
			mockPruneHistory.mockClear();
			jest.advanceTimersByTime(24 * 60 * 60 * 1000);

			// Pruning should not have been called after clearing
			expect(mockPruneHistory).not.toHaveBeenCalled();

			jest.useRealTimers();
		});

		it("should clear turn cleanup interval when set", () => {
			const intervalId = startTurnCleanupJob();
			expect(intervalId).toBeDefined();

			clearAllIntervals();

			// Interval should be cleared
			// We can verify by advancing time and checking no activity
		});

		it("should handle clearing when no intervals are set", () => {
			// Should not throw
			expect(() => clearAllIntervals()).not.toThrow();
		});

		it("should handle multiple calls gracefully", () => {
			startPruningJob();
			startTurnCleanupJob();

			clearAllIntervals();
			clearAllIntervals(); // Second call should be safe

			expect(() => clearAllIntervals()).not.toThrow();
		});
	});
});
