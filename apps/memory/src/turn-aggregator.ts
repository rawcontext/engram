import { createHash, randomUUID } from "node:crypto";
import type { ParsedStreamEvent } from "@engram/events";
import type { Logger } from "@engram/logger";
import type { FalkorClient } from "@engram/storage";
import { ToolCallType, type ToolCallTypeValue } from "@engram/memory-core";

/**
 * TurnAggregator handles the aggregation of streaming events into Turn nodes.
 *
 * A Turn represents a single conversation turn (user prompt + assistant response).
 * Events arrive one at a time via Kafka, so we need to:
 * 1. Detect turn boundaries (new user message = new turn)
 * 2. Accumulate assistant content into the current turn
 * 3. Create child nodes (Reasoning, ToolCall) as events arrive
 * 4. Create lineage edges: Reasoning -[TRIGGERS]-> ToolCall
 * 5. File operations are stored as properties on ToolCall nodes (file_path, file_action)
 * 6. Finalize the turn when usage event arrives (signals end of response)
 */

interface ReasoningState {
	id: string;
	sequenceIndex: number;
	content: string;
}

interface ToolCallState {
	id: string;
	callId: string;
	toolName: string;
	toolType: ToolCallTypeValue;
	argumentsJson: string;
	sequenceIndex: number;
	triggeringReasoningIds: string[]; // IDs of reasoning blocks that triggered this
	filePath?: string; // File being operated on (if file operation)
	fileAction?: string; // read, write, edit, search, etc.
}

interface TurnState {
	turnId: string;
	sessionId: string;
	userContent: string;
	assistantContent: string;
	reasoningBlocks: ReasoningState[];
	toolCalls: ToolCallState[];
	filesTouched: Map<string, { action: string; count: number; toolCallId?: string }>;
	// Track pending reasoning blocks that haven't been linked to a tool call yet
	pendingReasoningIds: string[];
	toolCallsCount: number;
	contentBlockIndex: number; // Track position within content blocks
	inputTokens: number;
	outputTokens: number;
	sequenceIndex: number;
	createdAt: number;
	isFinalized: boolean;
}

// In-memory state for active turns per session
const activeTurns = new Map<string, TurnState>();

// Track sequence index per session
const sessionSequence = new Map<string, number>();

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

// Callback type for node creation events (for real-time WebSocket updates)
export type NodeCreatedCallback = (
	sessionId: string,
	node: {
		id: string;
		type: "turn" | "reasoning" | "toolcall";
		label: string;
		properties: Record<string, unknown>;
	},
) => void;

export class TurnAggregator {
	private onNodeCreated?: NodeCreatedCallback;

	constructor(
		private falkor: FalkorClient,
		private logger: Logger,
		onNodeCreated?: NodeCreatedCallback,
	) {
		this.onNodeCreated = onNodeCreated;
	}

	/**
	 * Emit node created event for real-time updates
	 */
	private emitNodeCreated(
		sessionId: string,
		node: {
			id: string;
			type: "turn" | "reasoning" | "toolcall";
			label: string;
			properties: Record<string, unknown>;
		},
	) {
		if (this.onNodeCreated) {
			try {
				this.onNodeCreated(sessionId, node);
			} catch (e) {
				this.logger.error({ err: e }, "Failed to emit node created event");
			}
		}
	}

	/**
	 * Process a parsed stream event and aggregate into Turn/Reasoning/FileTouch nodes
	 */
	async processEvent(event: ParsedStreamEvent, sessionId: string): Promise<void> {
		const { type, role, content, thought, tool_call, usage, diff } = event;

		// User content starts a new turn
		if (role === "user" && content) {
			await this.startNewTurn(sessionId, content);
			return;
		}

		// Get or create current turn for this session
		let turn = activeTurns.get(sessionId);

		// If no active turn and we get assistant content, create a turn without user content
		// (This handles cases where we miss the user message)
		if (!turn && (content || thought || tool_call)) {
			turn = await this.startNewTurn(sessionId, "[No user message captured]");
		}

		if (!turn) {
			this.logger.debug({ sessionId, type }, "No active turn, skipping event");
			return;
		}

		// Process based on event type
		switch (type) {
			case "content":
				if (role === "assistant" && content) {
					turn.assistantContent += content;
					turn.contentBlockIndex++;
					await this.updateTurnPreview(turn);
				}
				break;

			case "thought":
				if (thought) {
					const reasoningId = await this.createReasoningNode(turn, thought);
					const reasoningState: ReasoningState = {
						id: reasoningId,
						sequenceIndex: turn.contentBlockIndex,
						content: thought,
					};
					turn.reasoningBlocks.push(reasoningState);
					// Add to pending reasoning IDs - will be linked to next tool call
					turn.pendingReasoningIds.push(reasoningId);
					turn.contentBlockIndex++;
				}
				break;

			case "tool_call":
				if (tool_call) {
					turn.toolCallsCount++;
					// Extract file path from tool call if it's a file operation
					const filePath = this.extractFilePath(tool_call.name, tool_call.arguments_delta);
					const fileAction = filePath ? this.inferFileAction(tool_call.name) : undefined;

					// Create ToolCall node with file info embedded (no separate FileTouch node)
					const toolCallState = await this.createToolCallNode(
						turn,
						tool_call,
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
						} else {
							turn.filesTouched.set(filePath, {
								action: fileAction!,
								count: 1,
								toolCallId: toolCallState.id,
							});
						}
					}
				}
				break;

			case "diff":
				if (diff?.file) {
					const action = "edit";
					// Find the most recent tool call and update its file_path if not already set
					const recentToolCall =
						turn.toolCalls.length > 0 ? turn.toolCalls[turn.toolCalls.length - 1] : undefined;

					if (recentToolCall && !recentToolCall.filePath) {
						// Update the tool call with file info from the diff
						recentToolCall.filePath = diff.file;
						recentToolCall.fileAction = action;
						await this.updateToolCallFile(recentToolCall.id, diff.file, action, diff.hunk);
					}

					// Track files touched at turn level for aggregation
					const existing = turn.filesTouched.get(diff.file);
					if (existing) {
						existing.count++;
					} else {
						turn.filesTouched.set(diff.file, {
							action,
							count: 1,
							toolCallId: recentToolCall?.id,
						});
					}
				}
				break;

			case "usage":
				if (usage) {
					turn.inputTokens = usage.input_tokens;
					turn.outputTokens = usage.output_tokens;
					// Usage event typically signals end of response - finalize the turn
					await this.finalizeTurn(turn);
				}
				break;
		}
	}

	/**
	 * Start a new turn for a session
	 */
	private async startNewTurn(sessionId: string, userContent: string): Promise<TurnState> {
		// Finalize any existing turn for this session
		const existingTurn = activeTurns.get(sessionId);
		if (existingTurn && !existingTurn.isFinalized) {
			await this.finalizeTurn(existingTurn);
		}

		// Get next sequence index for this session
		const currentSeq = sessionSequence.get(sessionId) ?? -1;
		const nextSeq = currentSeq + 1;
		sessionSequence.set(sessionId, nextSeq);

		const turn: TurnState = {
			turnId: randomUUID(),
			sessionId,
			userContent,
			assistantContent: "",
			reasoningBlocks: [],
			toolCalls: [],
			filesTouched: new Map(),
			pendingReasoningIds: [],
			toolCallsCount: 0,
			contentBlockIndex: 0,
			inputTokens: 0,
			outputTokens: 0,
			sequenceIndex: nextSeq,
			createdAt: Date.now(),
			isFinalized: false,
		};

		activeTurns.set(sessionId, turn);

		// Create the Turn node in the graph
		await this.createTurnNode(turn);

		this.logger.info(
			{ turnId: turn.turnId, sessionId, sequenceIndex: nextSeq },
			"Started new turn",
		);

		return turn;
	}

	/**
	 * Create the Turn node in FalkorDB
	 */
	private async createTurnNode(turn: TurnState): Promise<void> {
		const now = Date.now();
		const userContentHash = sha256(turn.userContent);

		const query = `
			MATCH (s:Session {id: $sessionId})
			CREATE (t:Turn {
				id: $turnId,
				user_content: $userContent,
				user_content_hash: $userContentHash,
				assistant_preview: $assistantPreview,
				sequence_index: $sequenceIndex,
				files_touched: $filesTouched,
				tool_calls_count: $toolCallsCount,
				vt_start: $now
			})
			MERGE (s)-[:HAS_TURN]->(t)
			WITH t
			OPTIONAL MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(prev:Turn)
			WHERE prev.sequence_index = $prevSeqIndex
			FOREACH (p IN CASE WHEN prev IS NOT NULL THEN [prev] ELSE [] END |
				MERGE (p)-[:NEXT]->(t)
			)
			RETURN t
		`;

		await this.falkor.query(query, {
			sessionId: turn.sessionId,
			turnId: turn.turnId,
			userContent: turn.userContent.slice(0, 10000), // Limit stored content
			userContentHash,
			assistantPreview: turn.assistantContent.slice(0, 2000),
			sequenceIndex: turn.sequenceIndex,
			filesTouched: JSON.stringify([...turn.filesTouched.keys()]),
			toolCallsCount: turn.toolCallsCount,
			prevSeqIndex: turn.sequenceIndex - 1,
			now,
		});

		// Emit node created event for real-time WebSocket updates
		this.emitNodeCreated(turn.sessionId, {
			id: turn.turnId,
			type: "turn",
			label: "Turn",
			properties: {
				user_content: turn.userContent.slice(0, 500),
				sequence_index: turn.sequenceIndex,
			},
		});
	}

	/**
	 * Update the Turn node's assistant preview as content streams in
	 */
	private async updateTurnPreview(turn: TurnState): Promise<void> {
		// Only update every 500 chars to reduce writes
		if (turn.assistantContent.length % 500 !== 0) return;

		const query = `
			MATCH (t:Turn {id: $turnId})
			SET t.assistant_preview = $preview
		`;

		await this.falkor.query(query, {
			turnId: turn.turnId,
			preview: turn.assistantContent.slice(0, 2000),
		});
	}

	/**
	 * Create a Reasoning node for a thinking block
	 * Returns the reasoning ID for linking to subsequent tool calls
	 */
	private async createReasoningNode(turn: TurnState, thought: string): Promise<string> {
		const reasoningId = randomUUID();
		const now = Date.now();
		const contentHash = sha256(thought);
		const sequenceIndex = turn.contentBlockIndex;

		const query = `
			MATCH (t:Turn {id: $turnId})
			CREATE (r:Reasoning {
				id: $reasoningId,
				content_hash: $contentHash,
				preview: $preview,
				reasoning_type: 'chain_of_thought',
				sequence_index: $sequenceIndex,
				vt_start: $now
			})
			MERGE (t)-[:CONTAINS]->(r)
			RETURN r
		`;

		await this.falkor.query(query, {
			turnId: turn.turnId,
			reasoningId,
			contentHash,
			preview: thought.slice(0, 1000),
			sequenceIndex,
			now,
		});

		this.logger.debug({ reasoningId, turnId: turn.turnId }, "Created reasoning node");

		// Emit node created event for real-time WebSocket updates
		this.emitNodeCreated(turn.sessionId, {
			id: reasoningId,
			type: "reasoning",
			label: "Reasoning",
			properties: {
				preview: thought.slice(0, 500),
				sequence_index: sequenceIndex,
			},
		});

		return reasoningId;
	}

	/**
	 * Create a ToolCall node and link to pending reasoning blocks via TRIGGERS edges
	 * File operations include file_path and file_action directly on the ToolCall node
	 */
	private async createToolCallNode(
		turn: TurnState,
		toolCall: { name: string; id?: string; arguments_delta?: string },
		filePath?: string,
		fileAction?: string,
	): Promise<ToolCallState> {
		const toolCallId = randomUUID();
		const now = Date.now();
		const callId = toolCall.id || `call_${randomUUID().slice(0, 8)}`;
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
		// file_path and file_action are included for file operations
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
				vt_start: $now
			})
			MERGE (t)-[:INVOKES]->(tc)
			RETURN tc
		`;

		await this.falkor.query(createQuery, {
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
			await this.falkor.query(triggersQuery, {
				reasoningIds: triggeringReasoningIds,
				toolCallId,
			});
		}

		// Clear pending reasoning IDs - they've been linked
		turn.pendingReasoningIds = [];

		this.logger.debug(
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
		this.emitNodeCreated(turn.sessionId, {
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
	 * Update a ToolCall node with file path and action (from diff events)
	 */
	private async updateToolCallFile(
		toolCallId: string,
		filePath: string,
		fileAction: string,
		diffPreview?: string,
	): Promise<void> {
		const query = `
			MATCH (tc:ToolCall {id: $toolCallId})
			SET tc.file_path = $filePath,
				tc.file_action = $fileAction,
				tc.diff_preview = $diffPreview
		`;

		await this.falkor.query(query, {
			toolCallId,
			filePath,
			fileAction,
			diffPreview: diffPreview?.slice(0, 500) ?? null,
		});

		this.logger.debug({ toolCallId, filePath, fileAction }, "Updated tool call with file info");
	}

	/**
	 * Finalize a turn (update with final stats)
	 */
	private async finalizeTurn(turn: TurnState): Promise<void> {
		if (turn.isFinalized) return;

		const query = `
			MATCH (t:Turn {id: $turnId})
			SET t.assistant_preview = $preview,
				t.files_touched = $filesTouched,
				t.tool_calls_count = $toolCallsCount,
				t.input_tokens = $inputTokens,
				t.output_tokens = $outputTokens
		`;

		await this.falkor.query(query, {
			turnId: turn.turnId,
			preview: turn.assistantContent.slice(0, 2000),
			filesTouched: JSON.stringify([...turn.filesTouched.keys()]),
			toolCallsCount: turn.toolCallsCount,
			inputTokens: turn.inputTokens,
			outputTokens: turn.outputTokens,
		});

		turn.isFinalized = true;
		this.logger.info(
			{
				turnId: turn.turnId,
				sessionId: turn.sessionId,
				contentLength: turn.assistantContent.length,
				reasoningBlocks: turn.reasoningBlocks.length,
				filesTouched: turn.filesTouched.size,
				toolCalls: turn.toolCallsCount,
			},
			"Finalized turn",
		);
	}

	/**
	 * Extract file path from tool call arguments
	 */
	private extractFilePath(toolName: string, argsJson: string): string | null {
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
		if (lowerName.includes("glob")) {
			return "search";
		}
		if (lowerName.includes("grep")) {
			return "search";
		}
		if (lowerName.includes("ls") || lowerName === "list") {
			return "list";
		}
		if (lowerName.includes("read")) {
			return "read";
		}
		if (lowerName.includes("write") || lowerName.includes("create")) {
			return "create";
		}
		if (lowerName.includes("edit")) {
			return "edit";
		}
		if (lowerName.includes("delete") || lowerName.includes("remove")) {
			return "delete";
		}
		return "read";
	}

	/**
	 * Infer tool call type from tool name
	 * Maps tool names to ToolCallType enum values
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

	/**
	 * Clean up stale turns (runs periodically)
	 */
	async cleanupStaleTurns(maxAgeMs: number = 30 * 60 * 1000): Promise<void> {
		const now = Date.now();
		for (const [sessionId, turn] of activeTurns) {
			if (now - turn.createdAt > maxAgeMs && !turn.isFinalized) {
				await this.finalizeTurn(turn);
				activeTurns.delete(sessionId);
				this.logger.info({ turnId: turn.turnId, sessionId }, "Cleaned up stale turn");
			}
		}
	}
}
