import type { CreateToolCallInput, ToolCall, ToolResult } from "./types";

/**
 * ToolCallRepository abstracts data access for ToolCall entities.
 *
 * ToolCall nodes capture every tool invocation during agent execution.
 * They are linked to Turns via INVOKES edges and may be TRIGGERED by Reasoning.
 */
export interface ToolCallRepository {
	/**
	 * Find a tool call by its ULID.
	 * @param id - The tool call ID
	 * @returns The tool call or null if not found
	 */
	findById(id: string): Promise<ToolCall | null>;

	/**
	 * Find a tool call by its provider call ID.
	 * @param callId - The provider's call ID (e.g., "toolu_01ABC...")
	 * @returns The tool call or null if not found
	 */
	findByCallId(callId: string): Promise<ToolCall | null>;

	/**
	 * Find all tool calls within a turn.
	 * @param turnId - The parent turn ID
	 * @returns Array of tool calls, ordered by sequence index
	 */
	findByTurn(turnId: string): Promise<ToolCall[]>;

	/**
	 * Find all tool calls within a session.
	 * Aggregates tool calls across all turns in the session.
	 * @param sessionId - The session ID
	 * @returns Array of tool calls, ordered by turn sequence then tool sequence
	 */
	findBySession(sessionId: string): Promise<ToolCall[]>;

	/**
	 * Find tool calls by tool type within a session.
	 * @param sessionId - The session ID
	 * @param toolType - The categorized tool type (e.g., "file_read", "bash_exec")
	 * @returns Array of matching tool calls
	 */
	findByToolType(sessionId: string, toolType: string): Promise<ToolCall[]>;

	/**
	 * Find tool calls by status within a session.
	 * @param sessionId - The session ID
	 * @param status - The tool call status (pending, success, error, cancelled)
	 * @returns Array of matching tool calls
	 */
	findByStatus(sessionId: string, status: string): Promise<ToolCall[]>;

	/**
	 * Find pending tool calls (not yet completed).
	 * @param sessionId - Optional session ID to filter by
	 * @returns Array of pending tool calls
	 */
	findPending(sessionId?: string): Promise<ToolCall[]>;

	/**
	 * Create a new tool call and link it to its turn.
	 * @param input - Tool call creation parameters including turnId
	 * @returns The created tool call
	 */
	create(input: CreateToolCallInput): Promise<ToolCall>;

	/**
	 * Create multiple tool calls in a batch.
	 * More efficient than creating one at a time.
	 * @param inputs - Array of tool call creation parameters
	 * @returns Array of created tool calls
	 */
	createBatch(inputs: CreateToolCallInput[]): Promise<ToolCall[]>;

	/**
	 * Update a tool call with its execution result.
	 * Typically called after tool execution completes.
	 * @param id - The tool call ID
	 * @param result - The execution result (status, error, timing)
	 * @returns The updated tool call
	 * @throws Error if tool call not found
	 */
	updateResult(id: string, result: ToolResult): Promise<ToolCall>;

	/**
	 * Count tool calls in a turn.
	 * @param turnId - The parent turn ID
	 * @returns Number of tool calls in the turn
	 */
	count(turnId: string): Promise<number>;

	/**
	 * Count tool calls by status in a session.
	 * @param sessionId - The session ID
	 * @returns Object with counts per status
	 */
	countByStatus(sessionId: string): Promise<Record<string, number>>;
}
