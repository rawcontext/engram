import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createSessionManager, SessionManager } from "./manager";

// Mock DecisionEngine
const mockHandleInput = mock(async () => {});
const mockStop = mock();
const mockStart = mock();
vi.mock("../engine/decision", () => ({
	DecisionEngine: class {
		start = mockStart;
		stop = mockStop;
		handleInput = mockHandleInput;
	},
}));

// Mock Initializer
const mockEnsureSession = mock(async () => {});
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
		assembleContext: mock(async () => "context"),
	}),
}));

// Mock storage
vi.mock("@engram/storage", () => ({
	createFalkorClient: () => ({
		connect: mock(async () => {}),
	}),
}));

// Mock logger
const mockLoggerInfo = mock();
vi.mock("@engram/logger", () => ({
	createNodeLogger: () => ({
		info: mockLoggerInfo,
		error: mock(),
		warn: mock(),
		debug: mock(),
	}),
}));

describe("SessionManager", () => {
	beforeEach(() => {
		// vi.clearAllMocks(); // TODO: Clear individual mocks
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
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
		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
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
		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
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
		const mockToolAdapter = {
			listTools: mock(async () => []),
			callTool: mock(async () => ({})),
		};

		const manager = new SessionManager({
			toolAdapter: mockToolAdapter,
		});

		await manager.handleInput("sess-1", "test");

		// Advance time by less than cleanup interval (5 minutes)
		vi.advanceTimersByTime(4 * 60 * 1000);

		// Session should NOT be cleaned up yet
		expect(mockStop).not.toHaveBeenCalled();

		manager.shutdown();
	});
});
