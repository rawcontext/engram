import { assign, createMachine } from "xstate";

export interface AgentContext {
  sessionId: string;
  input: string;
  contextString?: string;
  thoughts: string[];
  // biome-ignore lint/suspicious/noExplicitAny: Tool calls structure varies
  currentToolCalls: any[];
  // biome-ignore lint/suspicious/noExplicitAny: Tool outputs vary
  toolOutputs: any[];
  finalResponse?: string;
  // biome-ignore lint/suspicious/noExplicitAny: History structure varies
  history: any[];
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
        onError: { target: "idle" },
      },
      after: {
        10000: {
          target: "idle",
          actions: assign({ error: "Analysis timed out" }),
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
          target: "idle",
          actions: assign({ error: "Thought generation failed" }),
        },
      },
      after: {
        30000: {
          target: "idle",
          actions: assign({ error: "Deliberation timed out" }),
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
