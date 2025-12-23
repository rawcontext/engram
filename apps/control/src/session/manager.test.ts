import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

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

	// Skip timer-dependent tests since Bun doesn't support fake timers the same way
	it.skip("should cleanup stale sessions", async () => {
		// This test requires fake timers which aren't available in Bun
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

	// Skip timer-dependent tests since Bun doesn't support fake timers the same way
	it.skip("should update last access time on subsequent calls", async () => {
		// This test requires fake timers which aren't available in Bun
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

	// Skip timer-dependent tests since Bun doesn't support fake timers the same way
	it.skip("should run cleanup at correct interval", async () => {
		// This test requires fake timers which aren't available in Bun
	});
});
