# Tool Call Lineage Enhancement Plan

## Overview

This plan addresses the need to properly link tool calls to their triggering reasoning blocks, creating a true causal lineage in the graph:

```
Session → Turn → Reasoning → ToolCall → FileTouch/Observation
```

**Current State:**
- FileTouch nodes exist but are children of Turn (siblings to Reasoning)
- ToolCall nodes are defined in schema but NOT created
- No causal link between Reasoning and tool execution

**Target State:**
- ToolCall nodes capture every tool invocation
- Reasoning nodes link to ToolCalls they triggered via `TRIGGERS` edge
- FileTouch becomes a specialized view/child of file-operation ToolCalls
- Full lineage: `Reasoning -[TRIGGERS]-> ToolCall -[TOUCHES]-> FileTouch`

---

## Part 1: Tool Call Node Types

Based on [Claude Code's built-in tools](https://www.vtrivedy.com/posts/claudecode-tools-reference), we need these ToolCall subtypes:

### 1.1 File System Tools

| Tool Name | Node Type | Description |
|-----------|-----------|-------------|
| `Read` | `ToolCall:FileRead` | Read file contents |
| `Write` | `ToolCall:FileWrite` | Create/overwrite file |
| `Edit` | `ToolCall:FileEdit` | Modify existing file |
| `MultiEdit` | `ToolCall:FileMultiEdit` | Batch file modifications |
| `Glob` | `ToolCall:FileGlob` | Pattern-based file search |
| `Grep` | `ToolCall:FileGrep` | Content search across files |
| `LS` | `ToolCall:FileList` | Directory listing |

### 1.2 Execution Tools

| Tool Name | Node Type | Description |
|-----------|-----------|-------------|
| `Bash` | `ToolCall:BashExec` | Shell command execution |
| `NotebookRead` | `ToolCall:NotebookRead` | Read Jupyter notebook |
| `NotebookEdit` | `ToolCall:NotebookEdit` | Modify Jupyter notebook |

### 1.3 Web Tools

| Tool Name | Node Type | Description |
|-----------|-----------|-------------|
| `WebFetch` | `ToolCall:WebFetch` | Fetch URL content |
| `WebSearch` | `ToolCall:WebSearch` | Web search query |

### 1.4 Agent Tools

| Tool Name | Node Type | Description |
|-----------|-----------|-------------|
| `Task` | `ToolCall:AgentSpawn` | Spawn sub-agent |
| `TodoRead` | `ToolCall:TodoRead` | Read task list |
| `TodoWrite` | `ToolCall:TodoWrite` | Update task list |

### 1.5 MCP Tools (Dynamic)

| Tool Pattern | Node Type | Description |
|--------------|-----------|-------------|
| `mcp__*` | `ToolCall:MCP` | MCP server tool invocation |

---

## Part 2: Enhanced Graph Schema

### 2.1 ToolCall Node (Base)

```typescript
interface ToolCallNode {
  // Identity
  id: string;                    // UUID
  call_id: string;               // Provider's tool_use ID (e.g., "toolu_01ABC...")

  // Tool info
  tool_name: string;             // Original tool name (e.g., "Read", "Bash")
  tool_type: ToolCallType;       // Categorized type (see enum below)

  // Arguments
  arguments_json: string;        // Full JSON arguments
  arguments_preview: string;     // Truncated for display (500 chars)

  // Execution state
  status: "pending" | "success" | "error" | "cancelled";
  error_message?: string;

  // Sequence tracking
  sequence_index: number;        // Position within Turn's content blocks
  reasoning_sequence?: number;   // Index of triggering Reasoning block

  // Bitemporal
  vt_start: number;
  vt_end: number;
  tt_start: number;
  tt_end: number;
}

enum ToolCallType {
  // File operations
  FILE_READ = "file_read",
  FILE_WRITE = "file_write",
  FILE_EDIT = "file_edit",
  FILE_MULTI_EDIT = "file_multi_edit",
  FILE_GLOB = "file_glob",
  FILE_GREP = "file_grep",
  FILE_LIST = "file_list",

  // Execution
  BASH_EXEC = "bash_exec",
  NOTEBOOK_READ = "notebook_read",
  NOTEBOOK_EDIT = "notebook_edit",

  // Web
  WEB_FETCH = "web_fetch",
  WEB_SEARCH = "web_search",

  // Agent
  AGENT_SPAWN = "agent_spawn",
  TODO_READ = "todo_read",
  TODO_WRITE = "todo_write",

  // MCP
  MCP = "mcp",

  // Unknown/Other
  UNKNOWN = "unknown"
}
```

### 2.2 FileTouch Node (Enhanced)

```typescript
interface FileTouchNode {
  // Identity
  id: string;
  file_path: string;

  // Link to ToolCall
  tool_call_id: string;          // NEW: Reference to parent ToolCall

  // Operation details
  action: "read" | "write" | "edit" | "create" | "delete" | "list" | "search";

  // Diff information (for edit operations)
  diff_preview?: string;
  lines_added?: number;
  lines_removed?: number;

  // Search results (for grep/glob)
  match_count?: number;
  matched_files?: string[];      // For glob results

  // Bitemporal
  vt_start: number;
  vt_end: number;
}
```

### 2.3 Observation Node (Tool Results)

```typescript
interface ObservationNode {
  // Identity
  id: string;
  tool_call_id: string;          // Reference to ToolCall

  // Result
  content: string;               // Full result content
  content_preview: string;       // Truncated for display
  content_hash: string;          // SHA256 for deduplication

  // Status
  is_error: boolean;
  error_type?: string;           // e.g., "FileNotFound", "PermissionDenied"

  // Metadata
  execution_time_ms?: number;

  // Bitemporal
  vt_start: number;
  vt_end: number;
}
```

### 2.4 Edge Types

```typescript
// Existing edges (keep)
Session -[HAS_TURN]-> Turn
Turn -[NEXT]-> Turn
Turn -[CONTAINS]-> Reasoning

// New/Modified edges
Turn -[INVOKES]-> ToolCall           // Turn invokes tool (was defined, now used)
Reasoning -[TRIGGERS]-> ToolCall     // NEW: Causal link from reasoning to tool
ToolCall -[TOUCHES]-> FileTouch      // NEW: Tool touches file (moved from Turn)
ToolCall -[YIELDS]-> Observation     // Tool produces result

// Remove (migrate existing data)
Turn -[TOUCHES]-> FileTouch          // DEPRECATED: Replace with ToolCall->FileTouch
```

---

## Part 3: Content Block Processing Algorithm

### 3.1 Anthropic Content Block Structure

From the API, a Turn's content array looks like:

```json
{
  "content": [
    { "type": "thinking", "thinking": "I need to read the file...", "signature": "..." },
    { "type": "text", "text": "Let me check that file." },
    { "type": "tool_use", "id": "toolu_01ABC", "name": "Read", "input": {"file_path": "/src/index.ts"} },
    { "type": "thinking", "thinking": "The file contains...", "signature": "..." },
    { "type": "tool_use", "id": "toolu_02DEF", "name": "Edit", "input": {"file_path": "/src/index.ts", ...} },
    { "type": "text", "text": "I've updated the file." }
  ]
}
```

### 3.2 Processing Algorithm

```typescript
interface ContentBlockContext {
  turnId: string;
  sessionId: string;

  // Tracking state
  currentReasoningIds: string[];     // Stack of recent reasoning block IDs
  lastReasoningSequence: number;     // Sequence of last reasoning block
  toolCallCount: number;             // Tool calls seen so far

  // Created nodes
  reasoningNodes: ReasoningNode[];
  toolCallNodes: ToolCallNode[];
  fileTouchNodes: FileTouchNode[];
}

async function processContentBlocks(
  contentBlocks: ContentBlock[],
  ctx: ContentBlockContext
): Promise<void> {

  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i];
    const sequenceIndex = i;

    switch (block.type) {
      case "thinking":
        // Create Reasoning node
        const reasoningNode = await createReasoningNode({
          turnId: ctx.turnId,
          content: block.thinking,
          sequenceIndex,
          reasoningType: inferReasoningType(block.thinking),
        });

        // Track as potential trigger for upcoming tool calls
        ctx.currentReasoningIds.push(reasoningNode.id);
        ctx.lastReasoningSequence = sequenceIndex;
        ctx.reasoningNodes.push(reasoningNode);
        break;

      case "tool_use":
        // Create ToolCall node
        const toolCallNode = await createToolCallNode({
          turnId: ctx.turnId,
          callId: block.id,
          toolName: block.name,
          toolType: inferToolType(block.name),
          argumentsJson: JSON.stringify(block.input),
          sequenceIndex,
          reasoningSequence: ctx.lastReasoningSequence,
          status: "pending",
        });

        // Create TRIGGERS edges from all pending reasoning blocks
        for (const reasoningId of ctx.currentReasoningIds) {
          await createTriggersEdge(reasoningId, toolCallNode.id);
        }

        // Clear reasoning stack (they've been linked)
        ctx.currentReasoningIds = [];

        // Create specialized child nodes based on tool type
        await createToolSpecificNodes(toolCallNode, block.input, ctx);

        ctx.toolCallNodes.push(toolCallNode);
        ctx.toolCallCount++;
        break;

      case "text":
        // Text blocks don't create nodes, but they DO clear the reasoning stack
        // (reasoning before text that's NOT followed by tool_use is just commentary)
        // Actually, keep reasoning stack - text can be interspersed
        break;
    }
  }
}

async function createToolSpecificNodes(
  toolCall: ToolCallNode,
  input: Record<string, unknown>,
  ctx: ContentBlockContext
): Promise<void> {

  switch (toolCall.toolType) {
    case ToolCallType.FILE_READ:
    case ToolCallType.FILE_WRITE:
    case ToolCallType.FILE_EDIT:
    case ToolCallType.FILE_MULTI_EDIT:
      await createFileTouchFromToolCall(toolCall, input, ctx);
      break;

    case ToolCallType.FILE_GLOB:
      // Glob can touch multiple files - create FileTouch for pattern
      await createFileTouchNode({
        toolCallId: toolCall.id,
        filePath: input.pattern as string,
        action: "search",
      });
      break;

    case ToolCallType.FILE_GREP:
      await createFileTouchNode({
        toolCallId: toolCall.id,
        filePath: input.path as string || "*",
        action: "search",
      });
      break;

    case ToolCallType.FILE_LIST:
      await createFileTouchNode({
        toolCallId: toolCall.id,
        filePath: input.path as string,
        action: "list",
      });
      break;

    // Web tools, bash, etc. don't create FileTouch nodes
    // They may create Observation nodes when results come back
  }
}

function inferToolType(toolName: string): ToolCallType {
  const name = toolName.toLowerCase();

  // MCP tools
  if (name.startsWith("mcp__")) return ToolCallType.MCP;

  // File operations
  if (name === "read" || name === "read_file") return ToolCallType.FILE_READ;
  if (name === "write" || name === "write_file") return ToolCallType.FILE_WRITE;
  if (name === "edit" || name === "edit_file") return ToolCallType.FILE_EDIT;
  if (name === "multiedit" || name === "multi_edit") return ToolCallType.FILE_MULTI_EDIT;
  if (name === "glob") return ToolCallType.FILE_GLOB;
  if (name === "grep") return ToolCallType.FILE_GREP;
  if (name === "ls" || name === "list") return ToolCallType.FILE_LIST;

  // Execution
  if (name === "bash") return ToolCallType.BASH_EXEC;
  if (name === "notebookread") return ToolCallType.NOTEBOOK_READ;
  if (name === "notebookedit") return ToolCallType.NOTEBOOK_EDIT;

  // Web
  if (name === "webfetch") return ToolCallType.WEB_FETCH;
  if (name === "websearch") return ToolCallType.WEB_SEARCH;

  // Agent
  if (name === "task") return ToolCallType.AGENT_SPAWN;
  if (name === "todoread") return ToolCallType.TODO_READ;
  if (name === "todowrite") return ToolCallType.TODO_WRITE;

  return ToolCallType.UNKNOWN;
}
```

### 3.3 Handling Tool Results (Observations)

When `tool_result` content blocks arrive:

```typescript
async function processToolResult(
  toolResult: ToolResultBlock,
  ctx: ContentBlockContext
): Promise<void> {

  // Find the matching ToolCall by call_id
  const toolCall = await findToolCallByCallId(toolResult.tool_use_id);
  if (!toolCall) {
    console.warn(`Tool result for unknown call: ${toolResult.tool_use_id}`);
    return;
  }

  // Create Observation node
  const observation = await createObservationNode({
    toolCallId: toolCall.id,
    content: toolResult.content,
    isError: toolResult.is_error || false,
  });

  // Update ToolCall status
  await updateToolCallStatus(toolCall.id, {
    status: toolResult.is_error ? "error" : "success",
    errorMessage: toolResult.is_error ? toolResult.content : undefined,
  });

  // For file operations, update FileTouch with result details
  if (isFileToolType(toolCall.toolType)) {
    await updateFileTouchWithResult(toolCall.id, toolResult);
  }
}
```

---

## Part 4: Graph Queries for UI

### 4.1 Get Session Lineage (Enhanced)

```cypher
// Get full lineage with ToolCall->FileTouch relationships
MATCH (s:Session {id: $sessionId})
OPTIONAL MATCH (s)-[:HAS_TURN]->(t:Turn)
OPTIONAL MATCH (t)-[:CONTAINS]->(r:Reasoning)
OPTIONAL MATCH (t)-[:INVOKES]->(tc:ToolCall)
OPTIONAL MATCH (r)-[:TRIGGERS]->(tc2:ToolCall)
OPTIONAL MATCH (tc)-[:TOUCHES]->(ft:FileTouch)
OPTIONAL MATCH (tc)-[:YIELDS]->(obs:Observation)
RETURN s, t, r, tc, tc2, ft, obs
ORDER BY t.sequence_index, r.sequence_index, tc.sequence_index
```

### 4.2 Get Reasoning Chain for FileTouch

```cypher
// Trace lineage: FileTouch <- ToolCall <- Reasoning <- Turn
MATCH (ft:FileTouch {id: $fileTouchId})
MATCH (tc:ToolCall)-[:TOUCHES]->(ft)
OPTIONAL MATCH (r:Reasoning)-[:TRIGGERS]->(tc)
MATCH (t:Turn)-[:INVOKES]->(tc)
RETURN ft, tc, r, t
```

### 4.3 Get All Tool Calls for Turn

```cypher
MATCH (t:Turn {id: $turnId})-[:INVOKES]->(tc:ToolCall)
OPTIONAL MATCH (tc)-[:TOUCHES]->(ft:FileTouch)
OPTIONAL MATCH (tc)-[:YIELDS]->(obs:Observation)
RETURN tc, collect(ft) as files, obs
ORDER BY tc.sequence_index
```

---

## Part 5: UI Component Updates

### 5.1 New Graph Node Types for ReactFlow

```typescript
// LineageGraph.tsx - Add new node type configs
const nodeTypeConfig = {
  // ... existing

  toolcall: {
    gradient: "linear-gradient(135deg, rgb(168, 85, 247), rgb(139, 92, 246))", // Purple
    borderColor: "rgb(168, 85, 247)",
    glowColor: "rgba(168, 85, 247, 0.4)",
    icon: "⚡",
  },

  observation: {
    gradient: "linear-gradient(135deg, rgb(34, 197, 94), rgb(22, 163, 74))", // Green
    borderColor: "rgb(34, 197, 94)",
    glowColor: "rgba(34, 197, 94, 0.4)",
    icon: "📋",
  },
};
```

### 5.2 ThoughtStream ToolCall Card

```typescript
// New component: ToolCallCard.tsx
interface ToolCallCardProps {
  toolName: string;
  toolType: ToolCallType;
  arguments: Record<string, unknown>;
  status: "pending" | "success" | "error";
  observation?: ObservationNode;
  isHighlighted: boolean;
}
```

### 5.3 Graph Layout Update

Current layout:
```
Session → Turn → Reasoning
              → FileTouch
```

New layout:
```
Session → Turn → Reasoning → ToolCall → FileTouch
                                     → Observation
```

---

## Part 6: Migration Plan

### 6.1 Data Migration

```cypher
// Step 1: Create ToolCall nodes for existing FileTouch
MATCH (t:Turn)-[:TOUCHES]->(ft:FileTouch)
WHERE NOT EXISTS((tc:ToolCall)-[:TOUCHES]->(ft))
CREATE (tc:ToolCall {
  id: randomUUID(),
  tool_name: CASE ft.action
    WHEN 'read' THEN 'Read'
    WHEN 'edit' THEN 'Edit'
    WHEN 'create' THEN 'Write'
    ELSE 'Unknown'
  END,
  tool_type: ft.action + '_file',
  call_id: 'migrated_' + ft.id,
  arguments_json: '{"file_path": "' + ft.file_path + '"}',
  status: 'success',
  sequence_index: 0,
  vt_start: ft.vt_start,
  vt_end: ft.vt_end
})
CREATE (t)-[:INVOKES]->(tc)
CREATE (tc)-[:TOUCHES]->(ft)
SET ft.tool_call_id = tc.id

// Step 2: Remove old Turn->FileTouch edges (after verification)
MATCH (t:Turn)-[r:TOUCHES]->(ft:FileTouch)
WHERE EXISTS((tc:ToolCall)-[:TOUCHES]->(ft))
DELETE r
```

### 6.2 Rollout Phases

1. **Phase 1: Schema Addition** (non-breaking)
   - Add ToolCall node creation to TurnAggregator
   - Add TRIGGERS edge creation
   - Keep existing Turn->FileTouch for backwards compatibility

2. **Phase 2: UI Updates**
   - Add ToolCall nodes to graph visualization
   - Update lineage queries to use new paths
   - Update highlight logic for new edges

3. **Phase 3: Migration**
   - Run migration script to create ToolCall nodes for existing data
   - Update queries to prefer new paths

4. **Phase 4: Cleanup**
   - Remove deprecated Turn->FileTouch edges
   - Remove backwards-compat code

---

## Part 7: Implementation Order

### Step 1: Schema Updates
- [ ] Update `packages/memory-core/src/models/nodes.ts` with enhanced ToolCall interface
- [ ] Update `packages/memory-core/src/models/edges.ts` with TRIGGERS edge
- [ ] Add ToolCallType enum

### Step 2: Ingestion Updates
- [ ] Update `apps/memory/src/turn-aggregator.ts`:
  - [ ] Add `createToolCallNode()` method
  - [ ] Add `processContentBlocks()` with reasoning tracking
  - [ ] Update `handleParsedEvent()` to use new processing
  - [ ] Add `createTriggersEdge()` method

### Step 3: Query Updates
- [ ] Update `apps/interface/lib/graph-queries.ts`:
  - [ ] Modify `getSessionLineage()` to include ToolCall nodes
  - [ ] Modify `getSessionTimeline()` to include ToolCall events
  - [ ] Add new query for reasoning->tool lineage

### Step 4: UI Updates
- [ ] Update `apps/interface/app/components/LineageGraph.tsx`:
  - [ ] Add toolcall node type config
  - [ ] Update layout algorithm for new hierarchy
- [ ] Create `ToolCallCard.tsx` component
- [ ] Update `SessionReplay.tsx` to render ToolCall cards

### Step 5: Testing & Migration
- [ ] Write migration script
- [ ] Test with new ingestion data
- [ ] Run migration on existing data
- [ ] Verify UI displays correctly

---

## Appendix: Reference Links

- [Claude API Extended Thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Claude Code Tools Reference](https://www.vtrivedy.com/posts/claudecode-tools-reference)
- [Mastra Observability](https://mastra.ai/docs/observability/tracing/overview)
- [Anthropic Cookbook - Tool Use](https://github.com/anthropics/anthropic-cookbook/tree/main/tool_use)
