import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionManager, SessionManager } from "./manager";

// Mock DecisionEngine
const mockHandleInput = vi.fn(async () => {});
const mockStop = vi.fn();
const mockStart = vi.fn();
vi.mock("../engine/decision", () => ({
	DecisionEngine: class {
		start = mockStart;
		stop = mockStop;
		handleInput = mockHandleInput;
	},
}));

// Mock Initializer
const mockEnsureSession = vi.fn(async () => {});
vi.mock("./initializer", () => ({
	SessionInitializer: class {
		ensureSession = mockEnsureSession;
	},
	createSessionInitializer: () => ({
		ensureSession: mockEnsureSession,
	}),
}));

// Mock context assembler
vi.mock("../context/assembler", () => ({
	createContextAssembler: () => ({
		assembleContext: vi.fn(async () => "context"),
	}),
}));

// Mock storage
vi.mock("@engram/storage", () => ({
	createFalkorClient: () => ({
		connect: vi.fn(async () => {}),
	}),
}));

// Mock logger
const mockLoggerInfo = vi.fn();
vi.mock("@engram/logger", () => ({
	createNodeLogger: () => ({
		info: mockLoggerInfo,
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	}),
}));

describe("SessionManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should spawn engine and dispatch input", async () => {
		const mockToolAdapter = {
			listTools: vi.fn(async () => []),
			callTool: vi.fn(async () => ({})),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
		});
		const sessionId = "sess-1";
		const input = "Hello";

		await manager.handleInput(sessionId, input);

		expect(mockEnsureSession).toHaveBeenCalledWith(sessionId);
		expect(mockHandleInput).toHaveBeenCalledWith(sessionId, input);

		// Call again, should reuse engine
		await manager.handleInput(sessionId, "Again");
		expect(mockHandleInput).toHaveBeenCalledTimes(2);

		manager.shutdown();
	});

	it("should cleanup stale sessions", async () => {
		const mockToolAdapter = {
			listTools: vi.fn(async () => []),
			callTool: vi.fn(async () => ({})),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
		});

		await manager.handleInput("sess-1", "test");

		// Cleanup job runs every 5 minutes, and TTL is 1 hour
		// Advance time to trigger the cleanup job, then advance past TTL
		vi.advanceTimersByTime(5 * 60 * 1000); // Trigger cleanup job
		vi.advanceTimersByTime(61 * 60 * 1000); // Now the session is stale

		expect(mockStop).toHaveBeenCalled();
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			{ sessionId: "sess-1" },
			"Cleaning up stale session engine",
		);

		manager.shutdown();
	});

	it("should shutdown and clear all sessions", async () => {
		const mockToolAdapter = {
			listTools: vi.fn(async () => []),
			callTool: vi.fn(async () => ({})),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
		});

		await manager.handleInput("sess-1", "test");
		await manager.handleInput("sess-2", "test");

		mockStop.mockClear();
		manager.shutdown();

		expect(mockStop).toHaveBeenCalledTimes(2);
	});

	it("should update last access time on subsequent calls", async () => {
		const mockToolAdapter = {
			listTools: vi.fn(async () => []),
			callTool: vi.fn(async () => ({})),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
		});

		await manager.handleInput("sess-1", "first");

		// Advance time by 30 minutes (less than TTL)
		vi.advanceTimersByTime(30 * 60 * 1000);

		await manager.handleInput("sess-1", "second");

		// Advance time by another 45 minutes (would exceed TTL from first access, but not from second)
		vi.advanceTimersByTime(45 * 60 * 1000);

		// Session should NOT be cleaned up since last access was updated
		expect(mockStop).not.toHaveBeenCalled();

		manager.shutdown();
	});

	it("should create manager via factory function", () => {
		const mockToolAdapter = {
			listTools: vi.fn(async () => []),
			callTool: vi.fn(async () => ({})),
		};

		const manager = createSessionManager({
			toolAdapter: mockToolAdapter,
		});

		expect(manager).toBeInstanceOf(SessionManager);

		manager.shutdown();
	});
});
