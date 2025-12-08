import { assign, createMachine } from "xstate";

export interface ToolCall {
	toolName: string;
	args: Record<string, unknown>;
}

export interface ToolOutput {
	result?: unknown;
	error?: string;
}

export interface HistoryEntry {
	role: "user" | "assistant" | "tool";
	content: string;
	timestamp?: number;
}

export interface AgentContext {
	sessionId: string;
	input: string;
	contextString?: string;
	thoughts: string[];
	currentToolCalls: ToolCall[];
	toolOutputs: ToolOutput[];
	finalResponse?: string;
	history: HistoryEntry[];
	error?: string;
}

export const agentMachine = createMachine({
	id: "agent",
	initial: "idle",
	context: {
		sessionId: "",
		input: "",
		thoughts: [],
		currentToolCalls: [],
		toolOutputs: [],
		history: [],
		error: undefined,
	} as AgentContext,
	states: {
		idle: {
			on: {
				START: {
					target: "analyzing",
					actions: "assignInput",
				},
			},
		},
		analyzing: {
			invoke: {
				src: "fetchContext",
				input: ({ context }) => context,
				onDone: {
					target: "deliberating",
					actions: assign(({ event }) => ({
						contextString: event.output.contextString,
					})),
				},
				onError: {
					// Graceful degradation: proceed without context
					target: "deliberating",
					actions: assign({ error: "Context retrieval failed, proceeding without context." }),
				},
			},
			after: {
				10000: {
					target: "deliberating",
					actions: assign({ error: "Analysis timed out, proceeding." }),
				},
			},
		},
		deliberating: {
			invoke: {
				src: "generateThought",
				input: ({ context }) => context,
				onDone: [
					{
						target: "acting",
						guard: "requiresTool",
						actions: assign(({ event }) => ({
							thoughts: event.output.thought ? [event.output.thought] : [],
							currentToolCalls: event.output.toolCalls || [],
						})),
					},
					{
						target: "responding",
						actions: assign(({ event }) => ({
							finalResponse: event.output.thought,
						})),
					},
				],
				onError: {
					target: "recovering",
					actions: assign({ error: "Thought generation failed" }),
				},
			},
			after: {
				30000: {
					target: "recovering",
					actions: assign({ error: "Deliberation timed out" }),
				},
			},
		},
		recovering: {
			invoke: {
				src: "recoverError",
				input: ({ context }) => context,
				onDone: {
					target: "responding",
					actions: assign(({ event }) => ({
						finalResponse: event.output.recoveryResponse,
					})),
				},
				onError: {
					// Ultimate fallback if recovery fails
					target: "idle",
					actions: assign({ finalResponse: "System Critical Error: Unable to recover." }),
				},
			},
		},
		acting: {
			invoke: {
				src: "executeTool",
				input: ({ context }) => context,
				onDone: {
					target: "reviewing",
					actions: assign(({ event }) => ({
						toolOutputs: event.output.toolOutputs,
					})),
				},
				onError: { target: "reviewing" },
			},
			after: {
				// Heartbeat / Watchdog logic: Timeout after 30s
				30000: {
					target: "reviewing",
					actions: assign({
						error: "Tool execution timed out",
						toolOutputs: [{ error: "Timeout" }], // Mock error output
					}),
				},
			},
		},
		reviewing: {
			always: { target: "deliberating" },
		},
		responding: {
			invoke: {
				src: "streamResponse",
				input: ({ context }) => context,
				onDone: { target: "idle" },
			},
		},
	},
});
