import { describe, expect, it, mock } from "bun:test";
import { ThinkingExtractor } from "@engram/parser";
import { ContextAssembler } from "../../apps/control/src/context/assembler";
import { DecisionEngine } from "../../apps/control/src/engine/decision";
import { McpToolAdapter, MultiMcpAdapter } from "../../apps/control/src/tools/mcp_client";

// Mocks
const mockMcp = new MultiMcpAdapter();
const mockAdapter = new McpToolAdapter("echo", []);
mockAdapter.connect = mock(async () => {});
mockAdapter.listTools = mock(async () => [{ name: "read_file", description: "read" }]);
mockAdapter.callTool = mock(async (name, args) => {
	console.log(`[MockExecution] Tool ${name} called with`, args);
	return { content: [{ type: "text", text: "success" }] };
});
mockMcp.addAdapter(mockAdapter);
mockMcp.callTool = mock(async (name, args) => mockAdapter.callTool(name, args));
mockMcp.listTools = mock(async () => [{ name: "read_file", description: "read" }]);

const mockFalkor = {
	connect: mock(async () => {}),
	query: mock(async () => []),
};

const mockSearch = {
	search: mock(async () => []),
};

describe("System E2E Simulation", () => {
	it("should extract thinking tags correctly", () => {
		const extractor = new ThinkingExtractor();
		const input = "Hello <thinking>I need to process this</thinking> world";
		const delta = extractor.process(input);

		expect(delta.content).toBe("Hello  world");
		expect(delta.thought).toBe("I need to process this");
	});

	it("should initialize decision engine", async () => {
		const assembler = new ContextAssembler(
			mockSearch as Parameters<typeof ContextAssembler>[0],
			mockFalkor as Parameters<typeof ContextAssembler>[1],
		);

		const engine = new DecisionEngine(assembler, mockMcp);
		engine.start();

		// Just verify it starts without crashing
		expect(engine).toBeDefined();
	});
});
