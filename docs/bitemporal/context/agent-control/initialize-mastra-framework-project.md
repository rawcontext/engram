# Bead: Initialize Mastra Framework Project

## Context
**Agent Control** is the brain. We use the **Mastra** framework (TypeScript-first) to orchestrate agents, as it provides built-in primitives for Workflows, Agents, and RAG, fitting our "System" architecture perfectly.

## Goal
Initialize the `apps/control` directory as a Mastra application within the Turborepo.

## Structure
```text
apps/control/
├── src/
│   ├── agents/         # Agent definitions
│   ├── workflows/      # State machines (Think/Act loops)
│   ├── tools/          # MCP Tool Adapters
│   ├── memory/         # Mastra Memory integration (pointing to our Graphiti)
│   └── mastra.config.ts
├── package.json
└── tsconfig.json
```

## Dependencies
-   `@mastra/core` (or equivalent package name based on docs)
-   `zod`
-   `ai` (Vercel AI SDK, used by Mastra)

## Acceptance Criteria
-   [ ] `apps/control` created.
-   [ ] `mastra` installed.
-   [ ] Basic "Hello World" agent runnable via `bun run dev`.
