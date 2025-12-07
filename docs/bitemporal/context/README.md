# Strategic Domain-Driven Design Report: The Soul

## 1. Bounded Contexts

Based on the biological metaphor and architectural separation defined in the SDD, I have identified 7 distinct Bounded Contexts.

| Context Name | Type | Description | Source Components |
| :--- | :--- | :--- | :--- |
| **Cognitive Ingestion** | **Core** | Handles the raw "Nervous System" of the agent. Responsible for stream intake, protocol detection (Claude/OpenAI), event decomposition (thoughts vs. code), and security sanitization (PII/Secrets). | `Redpanda`, `Wasm Parsers`, `Stream Protocol` |
| **Bitemporal Memory** | **Core** | The "Hippocampus" and heart of the system. Manages the ontology (Nodes/Edges), implements the bitemporal logic (Valid/Transaction time), and handles graph persistence. | `FalkorDB`, `Graphiti Orchestrator`, `Cognitive Ontology` |
| **Semantic Search** | **Supporting** | The "Cortex". Responsible for generating embeddings (code & text), managing vector indices, and executing hybrid retrieval strategies. | `Qdrant`, `Embedder`, `Hybrid Search Resolver` |
| **Deterministic Execution** | **Core** | The "Motor Cortex". Manages the Virtual File System (VFS) reconstruction, "time-travel" state rehydration, and safe tool execution sandboxing. | `Wassette`, `VFS`, `MCP Tools` |
| **Agent Control** | **Supporting** | The "Frontal Cortex". Orchestrates the agent lifecycle, integrates with the Mastra framework, and manages decision loops via MCP. | `Mastra`, `Agent Workflows` |
| **Observability Interface** | **Generic** | The public-facing API layer allowing developers and evaluators to query the "Soul". Exposes GraphQL/REST endpoints for lineage and replay. | `Query API`, `Session Replay Endpoint` |
| **System Infrastructure** | **Generic** | The foundational deployment configuration, container orchestration, and database provisioning. | `Kubernetes`, `Docker`, `Helm` |

---

## 2. Contexts Overview

1.  **Bounded Context: Cognitive Ingestion**
2.  **Bounded Context: Bitemporal Memory**
3.  **Bounded Context: Semantic Search**
4.  **Bounded Context: Deterministic Execution**
5.  **Bounded Context: Agent Control**
6.  **Bounded Context: Observability Interface**
7.  **Bounded Context: System Infrastructure**

---

## 3. Detailed Breakdown per Context

### Bounded Context: Cognitive Ingestion
*   Define Raw Stream Event Schema
*   Implement Stream Protocol Detector
*   Create Anthropic XML Parser Strategy
*   Create OpenAI JSON Parser Strategy
*   Implement Thinking Tag Extractor
*   Implement Diff Block Extractor
*   Implement Tool Call Extractor
*   Define Normalized Event Structure
*   Implement PII Redaction Logic
*   Implement Secret Masking Regex
*   Create Redpanda Producer Configuration
*   Create Redpanda Consumer Configuration
*   Implement Wasm Transform Scaffolding
*   Develop Stream De-multiplexer
*   Implement Dead Letter Queue Handler
*   Create Ingestion Throughput Telemetry
*   Define Parsed Event Validation Rules
*   Implement Batch Event Processor
*   Create Stream Replay Utility

### Bounded Context: Bitemporal Memory
*   Define Graphiti Project Structure
*   Define Base Node Model
*   Define Base Edge Model
*   Implement Bitemporal Timestamp Logic
*   Define Session Node Schema
*   Define ThoughtNode Schema
*   Define ToolCall Node Schema
*   Define CodeArtifact Node Schema
*   Define DiffHunk Node Schema
*   Define Observation Node Schema
*   Define MotivatedBy Edge Schema
*   Define Triggers Edge Schema
*   Define Modifies Edge Schema
*   Define Yields Edge Schema
*   Implement FalkorDB Connection Manager
*   Implement Graph Node Writer
*   Implement Graph Edge Writer
*   Develop Bitemporal Query Builder
*   Implement Transaction Time Logic
*   Implement Valid Time Logic
*   Create Blob Storage Adapter for Large Text
*   Implement Graph Pruning Strategy
*   Develop Node Merging Logic
*   Create Graphiti MCP Server Wrapper

### Bounded Context: Semantic Search
*   Define Vector Point Schema
*   Select Text Embedding Model
*   Select Code Embedding Model
*   Implement Text Embedding Service
*   Implement Code Embedding Service
*   Configure Qdrant Collection Manager
*   Implement Vector Upsert Logic
*   Define Hybrid Search Request Schema
*   Implement Intent Classifier for Queries
*   Develop Dense Vector Retrieval
*   Develop Sparse Graph Keyword Retrieval
*   Implement Result Re-ranking Logic
*   Create Embedding Batch Processor
*   Implement Qdrant Snapshot Manager
*   Create Similarity Score Threshold Configuration
*   Develop Semantic Deduplication Logic

### Bounded Context: Deterministic Execution
*   Define Virtual File System (VFS) Structure
*   Implement VFS Snapshot Logic
*   Implement Diff Application Logic
*   Create File State Rehydrator
*   Define Wassette Runtime Configuration
*   Implement Wasm Module Loader
*   Develop Sandbox Security Policy
*   Implement Standard Tool Wrapper (Wasm)
*   Create MCP Tool Registry
*   Implement Tool Execution Monitor
*   Develop Output Capture (Stdout/Stderr)
*   Implement Deterministic Replay Engine
*   Create Time-Travel State Reconstruction
*   Define Execution Error Handling
*   Implement Wassette MCP Client

### Bounded Context: Agent Control
*   Initialize Mastra Framework Project
*   Define Agent Persona Configuration
*   Implement Mastra Workflow Definitions
*   Create Agent State Machine
*   Implement Graphiti MCP Client Integration
*   Implement Wassette MCP Client Integration
*   Define Decision Loop Logic
*   Implement Context Window Manager
*   Create Agent Session Initializer
*   Implement Tool Selection Strategy
*   Develop Agent Heartbeat Monitor
*   Define Fallback Behavior Logic

### Bounded Context: Observability Interface
*   Define API Route Structure
*   Create GraphQL Schema Definition
*   Implement REST API Scaffolding
*   Develop Ingest Stream Endpoint
*   Develop Semantic Search Endpoint
*   Develop Lineage Query Endpoint
*   Develop Session Replay Endpoint
*   Implement Authentication Middleware
*   Implement RBAC Authorization Logic
*   Create API Request Validator
*   Implement Response Serialization
*   Develop API Usage Telemetry
*   Create Swagger/OpenAPI Documentation

### Bounded Context: System Infrastructure
*   Create Kubernetes Deployment Manifests
*   Create Kubernetes Service Manifests
*   Create Ingestion Service Dockerfile
*   Create Memory Service Dockerfile
*   Create Search Service Dockerfile
*   Create Execution Service Dockerfile
*   Configure Redpanda Helm Chart
*   Configure FalkorDB Helm Chart
*   Configure Qdrant Helm Chart
*   Create Development Environment Setup Script
*   Define CI/CD Pipeline Configuration
*   Create Secret Management Configuration
*   Implement Health Check Probes
*   Create Log Aggregation Configuration

---

## 4. Cross-Context Dependencies

*   **Ingestion -> Memory**: `Parsed Events` must match `Graph Node Schemas`.
*   **Ingestion -> Search**: `Parsed Thoughts/Code` must trigger `Embedding Generation`.
*   **Memory -> Execution**: `VFS Reconstruction` depends on `DiffHunk Nodes` and `Bitemporal Queries`.
*   **Control -> Memory**: `Mastra Agents` depend on `Graphiti MCP Server` for context retrieval.
*   **Control -> Execution**: `Mastra Agents` depend on `Wassette` for safe tool usage.
*   **Interface -> Memory**: `Lineage Queries` depend on `Bitemporal Graph Structure`.
*   **Interface -> Search**: `Search Endpoint` depends on `Hybrid Retrieval Logic`.
*   **Infrastructure -> All**: All contexts depend on `Docker/K8s` configurations for deployment.

---
