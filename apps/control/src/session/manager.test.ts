import { describe, expect, it, mock, spyOn } from "bun:test";
import { DecisionEngine } from "../engine/decision";
import { SessionManager } from "./manager";

// Mocks
const mockFalkor = {
	connect: mock(async () => {}),
};

const mockAssembler = {
	assembleContext: mock(async () => "context"),
};

const mockMcp = {
	listTools: mock(async () => []),
};

// Mock DecisionEngine
const mockHandleInput = mock(async () => {});
mock.module("../engine/decision", () => ({
	DecisionEngine: class {
		constructor() {}
		start() {}
		handleInput = mockHandleInput;
	},
}));

// Mock Initializer
const mockEnsureSession = mock(async () => {});
mock.module("./initializer", () => ({
	SessionInitializer: class {
		ensureSession = mockEnsureSession;
	},
}));

describe("SessionManager", () => {
	it("should spawn engine and dispatch input", async () => {
		const manager = new SessionManager(mockAssembler as any, mockMcp as any, mockFalkor as any);
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
