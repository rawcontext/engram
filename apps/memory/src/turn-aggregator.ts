import { createHash, randomUUID } from "node:crypto";
import type { ParsedStreamEvent } from "@engram/events";
import type { Logger } from "@engram/logger";
import type { FalkorClient } from "@engram/storage";

/**
 * TurnAggregator handles the aggregation of streaming events into Turn nodes.
 *
 * A Turn represents a single conversation turn (user prompt + assistant response).
 * Events arrive one at a time via Kafka, so we need to:
 * 1. Detect turn boundaries (new user message = new turn)
 * 2. Accumulate assistant content into the current turn
 * 3. Create child nodes (Reasoning, FileTouch) as events arrive
 * 4. Finalize the turn when usage event arrives (signals end of response)
 */

interface TurnState {
	turnId: string;
	sessionId: string;
	userContent: string;
	assistantContent: string;
	reasoningBlocks: string[];
	filesTouched: Map<string, { action: string; count: number }>;
	toolCallsCount: number;
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

export class TurnAggregator {
	constructor(
		private falkor: FalkorClient,
		private logger: Logger,
	) {}

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
					await this.updateTurnPreview(turn);
				}
				break;

			case "thought":
				if (thought) {
					turn.reasoningBlocks.push(thought);
					await this.createReasoningNode(turn, thought);
				}
				break;

			case "tool_call":
				if (tool_call) {
					turn.toolCallsCount++;
					// Extract file path from tool call if it's a file operation
					const filePath = this.extractFilePath(tool_call.name, tool_call.arguments_delta);
					if (filePath) {
						const action = this.inferFileAction(tool_call.name);
						const existing = turn.filesTouched.get(filePath);
						if (existing) {
							existing.count++;
						} else {
							turn.filesTouched.set(filePath, { action, count: 1 });
						}
						await this.createFileTouchNode(turn, filePath, action);
					}
				}
				break;

			case "diff":
				if (diff?.file) {
					const action = "edit";
					const existing = turn.filesTouched.get(diff.file);
					if (existing) {
						existing.count++;
					} else {
						turn.filesTouched.set(diff.file, { action, count: 1 });
					}
					await this.createFileTouchNode(turn, diff.file, action, diff.hunk);
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
			filesTouched: new Map(),
			toolCallsCount: 0,
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
	 */
	private async createReasoningNode(turn: TurnState, thought: string): Promise<void> {
		const reasoningId = randomUUID();
		const now = Date.now();
		const contentHash = sha256(thought);
		const sequenceIndex = turn.reasoningBlocks.length - 1;

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
	}

	/**
	 * Create a FileTouch node for a file operation
	 */
	private async createFileTouchNode(
		turn: TurnState,
		filePath: string,
		action: string,
		diffPreview?: string,
	): Promise<void> {
		const fileTouchId = randomUUID();
		const now = Date.now();

		const query = `
			MATCH (t:Turn {id: $turnId})
			MERGE (f:FileTouch {file_path: $filePath, turn_id: $turnId})
			ON CREATE SET
				f.id = $fileTouchId,
				f.action = $action,
				f.diff_preview = $diffPreview,
				f.vt_start = $now
			ON MATCH SET
				f.action = CASE WHEN f.action = 'read' AND $action <> 'read' THEN $action ELSE f.action END
			MERGE (t)-[:TOUCHES]->(f)
			RETURN f
		`;

		await this.falkor.query(query, {
			turnId: turn.turnId,
			fileTouchId,
			filePath,
			action,
			diffPreview: diffPreview?.slice(0, 500) ?? null,
			now,
		});

		this.logger.debug({ filePath, action, turnId: turn.turnId }, "Created/updated file touch node");
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
		if (lowerName.includes("read") || lowerName.includes("glob") || lowerName.includes("grep")) {
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
