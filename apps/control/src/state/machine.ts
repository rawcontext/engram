import { createMachine } from "xstate";

export const agentMachine = createMachine({
  id: "agent",
  initial: "idle",
  context: {
    // Context data structure
    sessionId: "",
    input: "",
    thoughts: [],
    history: [],
  },
  states: {
    idle: {
      on: {
        START: { target: "analyzing", actions: "assignInput" },
      },
    },
    analyzing: {
      // Query Memory/Search
      invoke: {
        src: "fetchContext",
        onDone: { target: "deliberating" },
        onError: { target: "idle" }, // Simplified error handling
      },
    },
    deliberating: {
      // Generate thought
      invoke: {
        src: "generateThought",
        onDone: [{ target: "acting", guard: "requiresTool" }, { target: "responding" }],
      },
    },
    acting: {
      // Execute tool
      invoke: {
        src: "executeTool",
        onDone: { target: "reviewing" },
        onError: { target: "reviewing" }, // Review errors too
      },
    },
    reviewing: {
      // Check tool output, loop back to deliberating
      always: { target: "deliberating" },
    },
    responding: {
      // Stream response
      invoke: {
        src: "streamResponse",
        onDone: { target: "idle" },
      },
    },
  },
});
