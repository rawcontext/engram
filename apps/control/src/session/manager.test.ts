import { afterEach, beforeEach, describe, expect, it, jest, mock } from "bun:test";

// Mock DecisionEngine
const mockHandleInput = mock(async () => {});
const mockStop = mock();
const mockStart = mock();

mock.module("../engine/decision", () => ({
	DecisionEngine: class {
		start = mockStart;
		stop = mockStop;
		handleInput = mockHandleInput;
	},
}));

// Mock Initializer
const mockEnsureSession = mock(async () => {});
mock.module("./initializer", () => ({
	SessionInitializer: class {
		ensureSession = mockEnsureSession;
	},
	createSessionInitializer: () => ({
		ensureSession: mockEnsureSession,
	}),
}));

// Mock context assembler
mock.module("../context/assembler", () => ({
	createContextAssembler: () => ({
		assembleContext: mock(async () => "context"),
	}),
}));

// Mock storage
mock.module("@engram/storage", () => ({
	createFalkorClient: () => ({
		connect: mock(async () => {}),
	}),
}));

// Mock logger
const mockLoggerInfo = mock();
mock.module("@engram/logger", () => ({
	createNodeLogger: () => ({
		info: mockLoggerInfo,
		error: mock(),
		warn: mock(),
		debug: mock(),
	}),
}));

// Import after mocks are set up
import { createSessionManager, SessionManager } from "./manager";

describe("SessionManager", () => {
	beforeEach(() => {
		mockHandleInput.mockClear();
		mockStop.mockClear();
		mockStart.mockClear();
		mockEnsureSession.mockClear();
		mockLoggerInfo.mockClear();
	});

	it("should spawn engine and dispatch input", async () => {
		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
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
		jest.useFakeTimers();

		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
		});

		// Create a session
		await manager.handleInput("sess-stale", "test");
		expect(mockStart).toHaveBeenCalledTimes(1);

		// Advance time past SESSION_ENGINE_TTL_MS (1 hour) + cleanup interval (5 minutes)
		jest.advanceTimersByTime(65 * 60 * 1000); // 65 minutes

		// Session should have been cleaned up
		expect(mockStop).toHaveBeenCalled();

		manager.shutdown();
		jest.useRealTimers();
	});

	it("should shutdown and clear all sessions", async () => {
		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
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
		jest.useFakeTimers();

		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
		});

		// Create a session
		await manager.handleInput("sess-active", "test");

		// Advance time by 30 minutes (not stale yet)
		jest.advanceTimersByTime(30 * 60 * 1000);

		// Access the session again - this should update lastAccess
		await manager.handleInput("sess-active", "test again");

		// Advance time by another 40 minutes (would be stale from first access, but not from second)
		jest.advanceTimersByTime(40 * 60 * 1000);

		// Session should NOT be cleaned up because lastAccess was updated
		// Engine should still be active (only 1 engine created, not stopped yet)
		expect(mockStart).toHaveBeenCalledTimes(1);

		manager.shutdown();
		jest.useRealTimers();
	});

	it("should create manager via factory function", () => {
		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
		};

		const manager = createSessionManager({
			toolAdapter: mockToolAdapter,
		});

		expect(manager).toBeInstanceOf(SessionManager);

		manager.shutdown();
	});

	it("should not start cleanup job twice", () => {
		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
		});

		// Call private startCleanupJob method directly (it's called in constructor)
		(manager as any).startCleanupJob();

		// Should still only have one interval
		expect((manager as any).cleanupInterval).toBeDefined();

		manager.shutdown();
	});

	it("should accept injected dependencies", () => {
		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
		};

		const mockContextAssembler = {
			assembleContext: mock(async () => "context"),
		};

		const mockGraphClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => false),
		};

		const mockSessionInitializer = {
			ensureSession: mock(async () => {}),
		};

		const mockLogger = {
			info: mock(),
			error: mock(),
			warn: mock(),
			debug: mock(),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
			contextAssembler: mockContextAssembler as any,
			graphClient: mockGraphClient,
			sessionInitializer: mockSessionInitializer,
			logger: mockLogger as any,
		});

		expect(manager).toBeInstanceOf(SessionManager);

		manager.shutdown();
	});

	it("should run cleanup at correct interval", async () => {
		jest.useFakeTimers();

		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
		});

		// Create a stale session
		await manager.handleInput("sess-interval", "test");

		// Advance time past TTL but before first cleanup interval (< 5 min)
		jest.advanceTimersByTime(4 * 60 * 1000); // 4 minutes

		// Session should NOT be cleaned up yet (cleanup runs every 5 minutes)
		expect(mockStop).not.toHaveBeenCalled();

		// Advance past first cleanup interval
		jest.advanceTimersByTime(2 * 60 * 1000); // Now at 6 minutes, but session is only 6 min old

		// Still not stale (needs 60+ min inactivity)
		expect(mockStop).not.toHaveBeenCalled();

		// Advance to make session stale (past 60 min) and past next cleanup
		jest.advanceTimersByTime(60 * 60 * 1000); // Now session is 66 min old

		// Cleanup should have run and removed the stale session
		expect(mockStop).toHaveBeenCalled();

		manager.shutdown();
		jest.useRealTimers();
	});
});
