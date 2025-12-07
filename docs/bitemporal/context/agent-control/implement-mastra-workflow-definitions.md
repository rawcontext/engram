# Bead: Implement Mastra Workflow Definitions

## Context
Agents aren't just one-shot prompts. They are loops. Mastra "Workflows" define these steps.

## Goal
Define the "Think-Act-Observe" loop as a Mastra Workflow.

## Workflow: `MainLoop`
1.  **Start**: Receive User Input.
2.  **Context Fetch**: Query Graphiti (Memory) for relevant past thoughts/facts.
3.  **Plan**: Generate a `ThoughtNode` (Reasoning).
4.  **Decide**: Select a Tool or Answer.
    *   *If Tool*: -> Go to **Execute**.
    *   *If Answer*: -> Go to **Finalize**.
5.  **Execute**: Call MCP Tool (Wassette).
6.  **Observe**: Read Tool Output. -> Loop back to **Plan**.
7.  **Finalize**: Stream response to user.

## Acceptance Criteria
-   [ ] `src/workflows/main_loop.ts` created.
-   [ ] Steps defined using Mastra's workflow syntax.
