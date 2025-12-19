import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "./manager";

// Mock DecisionEngine
const mockHandleInput = vi.fn(async () => {});
vi.mock("../engine/decision", () => ({
	DecisionEngine: class {
		start() {}
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
vi.mock("@engram/logger", () => ({
	createNodeLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	}),
}));

describe("SessionManager", () => {
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
	});
});
