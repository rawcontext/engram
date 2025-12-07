# Product Requirements Document (PRD): The Soul - Bitemporal Cognitive Knowledge Graph

**Project Name:** The Soul
**Version:** 2.0.0-CODE
**Status:** APPROVED FOR IMPLEMENTATION
**Date:** December 6, 2025
**Source Context:** `docs/bitemporal/result.md`

---

## 1. Executive Summary

"The Soul" is a Bitemporal Cognitive Knowledge Graph designed to capture, structure, and query the "Stream of Consciousness" of autonomous coding agents. Unlike traditional version control systems (like Git) that track *what* changed, The Soul tracks *why* it changed by ingesting the agent's hidden reasoning ("thinking tokens"), tool executions, and terminal telemetry.

This system addresses the critical observability gap in agentic coding: the loss of cognitive context. By treating the agent's reasoning process as a first-class citizen in the data model, The Soul enables "Deep Cognitive Observability," allowing developers to debug agent logic, agents to recall past architectural decisions, and evaluators to audit the alignment between reasoning and action.

## 2. Problem Definition

### 2.1 The "Black Box" Commit
Autonomous coding agents (e.g., Claude Code, GitHub Copilot Workspace) generate massive amounts of reasoning data ("thinking tokens") before producing a code change. Once the session ends or the context window rolls over, this reasoning is discarded.
*   **Issue:** If a refactor introduces a bug, developers have the code (the effect) but have lost the reasoning (the cause).
*   **Impact:** Debugging becomes a guessing game of "hallucination vs. logic error."

### 2.2 Context Window Amnesia
As agent sessions extend beyond the context window (e.g., 200k tokens), early architectural decisions and the reasoning behind them are dropped.
*   **Issue:** Agents "forget" why they chose a specific pattern 50 turns ago.
*   **Impact:** Agents may regressively refactor code, undoing previous valid work due to lack of historical context.

### 2.3 Disconnected Artifacts
Current tooling treats code, logs, and chat as separate entities.
*   **Issue:** There is no structural link between a specific `ThoughtBlock` (e.g., "I need to fix the race condition") and the resulting `DiffHunk` in `api_client.py`.

## 3. User Personas & User Stories

### 3.1 The Developer (User)
*   **Goal:** Debug agent behavior and understand the rationale behind code changes.
*   **Story:** "As a developer, I want to query the system to find out why the agent deleted the retry logic in `api_client.py`, so I can determine if it was a hallucination or a valid decision based on a specific error log."

### 3.2 The Agent (Self)
*   **Goal:** Maintain long-term coherence and avoid repetitive mistakes.
*   **Story:** "As an agent, I want to query my past sessions to see if I have modified `server.go` before and if that modification triggered a regression, so I can avoid making the same mistake twice."

### 3.3 The Model Evaluator
*   **Goal:** Audit the quality and safety of agent code generation.
*   **Story:** "As an evaluator, I want to find all instances where the agent's 'Thinking Trace' identified a security vulnerability but the resulting 'Code Diff' failed to patch it."

## 4. Functional Requirements

### 4.1 Cognitive Ingestion & Stream Decomposition
The system must be able to ingest and parse raw, high-volume data streams from coding agents.
*   **FR-I1: Stream Parsing:** The system MUST ingest raw agent streams (e.g., Anthropic's XML tags `<thinking>`, `<function_calls>`, JSON-RPC) and decompose them into atomic events.
*   **FR-I2: Thinking Token Extraction:** The system MUST extract "Thinking Tokens" (hidden reasoning chains) and store them as distinct `ThoughtNode` entities.
*   **FR-I3: Terminal Telemetry:** The system MUST capture `stdout`, `stderr`, and exit codes from agent-executed commands (e.g., `npm test`) and store them as `Observation` nodes.

### 4.2 Cognitive AST & Graph Linking
The system must structure the ingested data into a connected graph that links reasoning to artifacts.
*   **FR-L1: Causal Linking:** The system MUST link `ThoughtNode` entities to `ToolCall` entities (via `TRIGGERS`) and `CodeArtifactNode` entities (via `INTENDED_MODIFICATION` or `MODIFIES`).
*   **FR-L2: AST Mapping:** The system MUST map generated code artifacts (files, functions) back to the specific reasoning blocks that spawned them.
*   **FR-L3: Observation Linking:** The system MUST link the results of actions (e.g., file reads, test outputs) back to the `ToolCall` that initiated them via `YIELDS` edges.

### 4.3 Bitemporal State Management
The system must handle the time dimension to reconstruct past states.
*   **FR-T1: File State Versioning:** The system MUST track the state of files as perceived by the agent at any given time $T$.
*   **FR-T2: VFS Reconstruction:** The system MUST be able to reconstruct the Virtual File System (VFS) at any point in the interaction history to debug issues like "File not found" hallucinations.
*   **FR-T3: Temporal Validity:** All graph nodes and edges MUST have `valid_from` and `valid_to` properties to support bitemporal querying.

### 4.4 Semantic Search & Retrieval
The system must enable advanced querying capabilities.
*   **FR-S1: Cross-Modal Search:** The system MUST allow users to search using natural language (e.g., "Fix race conditions") and retrieve relevant `ThinkingBlock`s and `DiffHunk`s.
*   **FR-S2: Hybrid Retrieval:** The system MUST utilize both sparse (keyword/graph) and dense (vector embedding) retrieval methods to find code and reasoning.

### 4.5 Data Sanitization
*   **FR-D1: Secret Redaction:** The system MUST detect and redact secrets (API keys, passwords) from the agent output before storage.

## 5. Non-Functional Requirements

### 5.1 Scalability
*   **NFR-S1: High Volume:** The system MUST handle sessions generating 20,000+ thinking tokens per turn.
*   **NFR-S2: Concurrency:** The system SHOULD support at least 50 concurrent agent sessions with an ingestion rate of ~5,000 TPS.

### 5.2 Performance
*   **NFR-P1: Real-Time Ingestion:** The system MUST parse and ingest streams in near real-time to support active agent loops.
*   **NFR-P2: Query Latency:** Semantic search queries SHOULD return results in under 200ms.

### 5.3 Storage Efficiency
*   **NFR-E1: Token Bloat Management:** To manage storage costs, the system SHOULD store full text of large "Thinking Blocks" in Blob Storage (S3/MinIO) while keeping summaries and embeddings in the graph/vector store.

### 5.4 Reliability
*   **NFR-R1: Data Integrity:** Critical data like Code Diffs MUST be ingested with high reliability (e.g., `acks=all` in Redpanda). Telemetry data can be lossy (`acks=1`).

## 6. Data Model (Conceptual)

### 6.1 Nodes (Entities)
*   **Session:** The container for the interaction.
*   **UserPrompt:** The human input.
*   **ThoughtBlock:** The agent's hidden reasoning (e.g., "I see the user wants to switch to Postgres...").
*   **ToolCall:** The intent to act (e.g., `fs.readFile("go.mod")`).
*   **Observation:** The result of the act (e.g., content of `go.mod`, or Error).
*   **CodeArtifact:** A specific file or function entity at a specific time.
*   **DiffHunk:** The actual patch applied.

### 6.2 Edges (Relationships)
*   **MOTIVATED_BY:** `ThoughtBlock` -> `UserPrompt`
*   **TRIGGERS:** `ThoughtBlock` -> `ToolCall`
*   **YIELDS:** `ToolCall` -> `Observation`
*   **MODIFIES:** `DiffHunk` -> `CodeArtifact`
*   **INTRODUCED_ERROR:** `DiffHunk` -> `Observation` (if subsequent test failed)

## 7. Technical Stack (Reference)

*   **Ingestion (Nervous System):** Redpanda with Wasm parsers (Rust).
*   **Memory (Hippocampus):** FalkorDB (Graph).
*   **Search (Cortex):** Qdrant (Vector).
*   **Replay (Motor Cortex):** Wassette (Sandbox).
*   **Language:** Python (Graphiti/Pydantic) for the Orchestrator.

## 8. Success Metrics

*   **Debuggability:** Time to identify the root cause of an agent logic error is reduced by 50%.
*   **Recall:** Agent is able to correctly cite reasoning from >50 turns ago in 90% of test cases.
*   **Completeness:** 100% of code changes are linked to a `ThoughtBlock`.
