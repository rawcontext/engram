import type { ParsedStreamEvent } from "@engram/events";
import { ToolCallType, type ToolCallTypeValue } from "@engram/graph";
import type {
	EventHandler,
	HandlerContext,
	HandlerResult,
	ToolCallState,
	TurnState,
} from "./handler.interface";

/**
 * ToolCallEventHandler processes tool invocation events.
 * Creates ToolCall nodes with INVOKES edges from Turn and TRIGGERS
 * edges from pending Reasoning blocks.
 */
export class ToolCallEventHandler implements EventHandler {
	readonly eventType = "tool_call";

	canHandle(event: ParsedStreamEvent): boolean {
		return event.type === "tool_call" && event.tool_call !== undefined && !!event.tool_call.name;
	}

	async handle(
		event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult> {
		if (!event.tool_call || !event.tool_call.name) {
			return { handled: false };
		}

		// Type narrowing: we've verified name exists above
		const toolCall = event.tool_call as { name: string; id?: string; arguments_delta?: string };

		turn.toolCallsCount++;

		// Extract file path from tool call if it's a file operation
		const filePath = this.extractFilePath(toolCall.name, toolCall.arguments_delta);
		const fileAction = filePath ? this.inferFileAction(toolCall.name) : undefined;

		// Create ToolCall node with file info embedded
		const toolCallState = await this.createToolCallNode(
			turn,
			toolCall,
			context,
			filePath ?? undefined,
			fileAction,
		);

		turn.toolCalls.push(toolCallState);
		turn.contentBlockIndex++;

		// Track files touched at turn level for aggregation
		if (filePath) {
			const existing = turn.filesTouched.get(filePath);
			if (existing) {
				existing.count++;
			} else if (fileAction) {
				turn.filesTouched.set(filePath, {
					action: fileAction,
					count: 1,
					toolCallId: toolCallState.id,
				});
			}
		}

		return {
			handled: true,
			action: "toolcall_created",
			nodeId: toolCallState.id,
		};
	}

	/**
	 * Create a ToolCall node and link to pending reasoning blocks via TRIGGERS edges
	 */
	private async createToolCallNode(
		turn: TurnState,
		toolCall: { name: string; id?: string | undefined; arguments_delta?: string | undefined },
		context: HandlerContext,
		filePath?: string,
		fileAction?: string,
	): Promise<ToolCallState> {
		const toolCallId = crypto.randomUUID();
		const now = Date.now();
		const callId = toolCall.id || `call_${crypto.randomUUID().slice(0, 8)}`;
		const toolType = this.inferToolType(toolCall.name);
		const argumentsJson = toolCall.arguments_delta || "{}";
		const argumentsPreview = argumentsJson.slice(0, 500);

		// Capture the pending reasoning IDs that triggered this tool call
		const triggeringReasoningIds = [...turn.pendingReasoningIds];
		// Get the sequence of the last reasoning block (if any)
		const reasoningSequence =
			turn.reasoningBlocks.length > 0
				? turn.reasoningBlocks[turn.reasoningBlocks.length - 1].sequenceIndex
				: undefined;

		// Create the ToolCall node with INVOKES edge from Turn
		const createQuery = `
			MATCH (t:Turn {id: $turnId})
			CREATE (tc:ToolCall {
				id: $toolCallId,
				call_id: $callId,
				tool_name: $toolName,
				tool_type: $toolType,
				arguments_json: $argumentsJson,
				arguments_preview: $argumentsPreview,
				file_path: $filePath,
				file_action: $fileAction,
				status: 'pending',
				sequence_index: $sequenceIndex,
				reasoning_sequence: $reasoningSequence,
				vt_start: $now,
				tt_start: $now
			})
			MERGE (t)-[:INVOKES]->(tc)
			RETURN tc
		`;

		await context.graphClient.query(createQuery, {
			turnId: turn.turnId,
			toolCallId,
			callId,
			toolName: toolCall.name,
			toolType,
			argumentsJson,
			argumentsPreview,
			filePath: filePath ?? null,
			fileAction: fileAction ?? null,
			sequenceIndex: turn.contentBlockIndex,
			reasoningSequence: reasoningSequence ?? null,
			now,
		});

		// Create TRIGGERS edges from all pending reasoning blocks to this ToolCall
		if (triggeringReasoningIds.length > 0) {
			const triggersQuery = `
				MATCH (r:Reasoning) WHERE r.id IN $reasoningIds
				MATCH (tc:ToolCall {id: $toolCallId})
				MERGE (r)-[:TRIGGERS]->(tc)
			`;
			await context.graphClient.query(triggersQuery, {
				reasoningIds: triggeringReasoningIds,
				toolCallId,
			});
		}

		// Clear pending reasoning IDs - they've been linked
		turn.pendingReasoningIds = [];

		context.logger.debug(
			{
				toolCallId,
				toolName: toolCall.name,
				toolType,
				filePath,
				fileAction,
				turnId: turn.turnId,
				triggeringReasoningCount: triggeringReasoningIds.length,
			},
			"Created tool call node with triggers",
		);

		// Emit node created event for real-time WebSocket updates
		if (context.emitNodeCreated) {
			try {
				context.emitNodeCreated({
					id: toolCallId,
					type: "toolcall",
					label: "ToolCall",
					properties: {
						tool_name: toolCall.name,
						tool_type: toolType,
						arguments_preview: argumentsPreview,
						file_path: filePath,
						file_action: fileAction,
						sequence_index: turn.contentBlockIndex,
					},
				});
			} catch (error) {
				context.logger.error({ err: error, toolCallId }, "Failed to emit node created event");
			}
		}

		return {
			id: toolCallId,
			callId,
			toolName: toolCall.name,
			toolType,
			argumentsJson,
			sequenceIndex: turn.contentBlockIndex,
			triggeringReasoningIds,
			filePath,
			fileAction,
		};
	}

	/**
	 * Extract file path from tool call arguments
	 */
	private extractFilePath(toolName: string, argsJson?: string): string | null {
		if (!argsJson) return null;

		// Common file operation tools
		const fileTools = [
			"Read",
			"Write",
			"Edit",
			"Glob",
			"Grep",
			"read_file",
			"write_file",
			"edit_file",
		];
		if (!fileTools.some((t) => toolName.toLowerCase().includes(t.toLowerCase()))) {
			return null;
		}

		try {
			// Arguments come as partial JSON during streaming, try to extract file_path or path
			const pathMatch = argsJson.match(/"(?:file_path|path|file)":\s*"([^"]+)"/);
			if (pathMatch) {
				return pathMatch[1];
			}
		} catch {
			// Ignore parse errors for partial JSON
		}
		return null;
	}

	/**
	 * Infer file action from tool name
	 */
	private inferFileAction(toolName: string): string {
		const lowerName = toolName.toLowerCase();
		if (lowerName.includes("glob")) return "search";
		if (lowerName.includes("grep")) return "search";
		if (lowerName.includes("ls") || lowerName === "list") return "list";
		if (lowerName.includes("read")) return "read";
		if (lowerName.includes("write") || lowerName.includes("create")) return "create";
		if (lowerName.includes("edit")) return "edit";
		if (lowerName.includes("delete") || lowerName.includes("remove")) return "delete";
		return "read";
	}

	/**
	 * Infer tool call type from tool name
	 */
	private inferToolType(toolName: string): ToolCallTypeValue {
		const name = toolName.toLowerCase();

		// MCP tools
		if (name.startsWith("mcp__") || name.startsWith("mcp_")) {
			return ToolCallType.MCP;
		}

		// File operations
		if (name === "read" || name === "read_file" || name === "readfile") {
			return ToolCallType.FILE_READ;
		}
		if (name === "write" || name === "write_file" || name === "writefile") {
			return ToolCallType.FILE_WRITE;
		}
		if (name === "edit" || name === "edit_file" || name === "editfile") {
			return ToolCallType.FILE_EDIT;
		}
		if (name === "multiedit" || name === "multi_edit" || name === "multifileedit") {
			return ToolCallType.FILE_MULTI_EDIT;
		}
		if (name === "glob") {
			return ToolCallType.FILE_GLOB;
		}
		if (name === "grep") {
			return ToolCallType.FILE_GREP;
		}
		if (name === "ls" || name === "list" || name === "listfiles") {
			return ToolCallType.FILE_LIST;
		}

		// Execution
		if (name === "bash" || name === "shell" || name === "execute") {
			return ToolCallType.BASH_EXEC;
		}
		if (name === "notebookread" || name === "notebook_read") {
			return ToolCallType.NOTEBOOK_READ;
		}
		if (name === "notebookedit" || name === "notebook_edit") {
			return ToolCallType.NOTEBOOK_EDIT;
		}

		// Web
		if (name === "webfetch" || name === "web_fetch" || name === "fetch") {
			return ToolCallType.WEB_FETCH;
		}
		if (name === "websearch" || name === "web_search" || name === "search") {
			return ToolCallType.WEB_SEARCH;
		}

		// Agent
		if (name === "task" || name === "spawn" || name === "agent") {
			return ToolCallType.AGENT_SPAWN;
		}
		if (name === "todoread" || name === "todo_read") {
			return ToolCallType.TODO_READ;
		}
		if (name === "todowrite" || name === "todo_write") {
			return ToolCallType.TODO_WRITE;
		}

		return ToolCallType.UNKNOWN;
	}
}
