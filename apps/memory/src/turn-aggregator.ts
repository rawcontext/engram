import { createHash, randomUUID } from "node:crypto";
import type { TenantContext } from "@engram/common/types";
import type { ParsedStreamEvent } from "@engram/events";
import type { Logger } from "@engram/logger";
import type { GraphClient, QueryParams, TenantAwareFalkorClient } from "@engram/storage";
import {
	createDefaultHandlerRegistry,
	type EventHandlerRegistry,
	type HandlerContext,
	type TurnFinalizedPayload,
	type TurnState,
} from "./handlers";

/**
 * Input type for stream events from NATS.
 * This is a looser type than ParsedStreamEvent to handle partial/incomplete data
 * from the message queue. Fields are normalized before processing.
 */
export interface StreamEventInput {
	event_id?: string;
	original_event_id?: string;
	timestamp?: string;
	type?: string;
	role?: string; // Accepts any string, normalized to enum values
	content?: string;
	thought?: string;
	tool_call?: {
		id?: string;
		name?: string;
		arguments_delta?: string;
		index?: number;
	};
	diff?: {
		file?: string;
		hunk?: string;
	};
	usage?: {
		input_tokens: number;
		output_tokens: number;
	};
	metadata?: Record<string, unknown>;
}

/**
 * TurnAggregator handles the aggregation of streaming events into Turn nodes.
 *
 * A Turn represents a single conversation turn (user prompt + assistant response).
 * Events arrive one at a time via NATS, so we need to:
 * 1. Detect turn boundaries (new user message = new turn)
 * 2. Delegate event processing to specialized handlers via Strategy pattern
 * 3. Create child nodes (Reasoning, ToolCall) as events arrive
 * 4. Create lineage edges: Reasoning -[TRIGGERS]-> ToolCall
 * 5. File operations are stored as properties on ToolCall nodes (file_path, file_action)
 * 6. Finalize the turn when usage event arrives (signals end of response)
 */

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

// Callback type for node creation events (for real-time WebSocket updates)
export type NodeCreatedCallback = (
	sessionId: string,
	node: {
		id: string;
		type: "turn" | "reasoning" | "toolcall" | "diffhunk";
		label: string;
		properties: Record<string, unknown>;
	},
) => void;

// Callback type for turn finalized events (for NATS indexing)
export type TurnFinalizedCallback = (payload: TurnFinalizedPayload) => Promise<void>;

/**
 * Dependencies for TurnAggregator construction.
 * Supports dependency injection for testability.
 */
export interface TurnAggregatorDeps {
	graphClient: GraphClient;
	logger: Logger;
	onNodeCreated?: NodeCreatedCallback;
	onTurnFinalized?: TurnFinalizedCallback;
	handlerRegistry?: EventHandlerRegistry;
	/** Optional tenant-aware client for multi-tenant graph isolation */
	tenantClient?: TenantAwareFalkorClient;
}

export class TurnAggregator {
	private graphClient: GraphClient;
	private tenantClient?: TenantAwareFalkorClient;
	private logger: Logger;
	private onNodeCreated?: NodeCreatedCallback;
	private onTurnFinalized?: TurnFinalizedCallback;
	private handlerRegistry: EventHandlerRegistry;

	// Instance-level state (moved from module level to prevent cross-instance contamination)
	private activeTurns = new Map<string, TurnState>();
	private sessionSequence = new Map<string, number>();

	constructor(deps: TurnAggregatorDeps) {
		this.graphClient = deps.graphClient;
		this.tenantClient = deps.tenantClient;
		this.logger = deps.logger;
		this.onNodeCreated = deps.onNodeCreated;
		this.onTurnFinalized = deps.onTurnFinalized;
		this.handlerRegistry = deps.handlerRegistry ?? createDefaultHandlerRegistry();
	}

	/**
	 * Execute a query on the tenant-specific graph.
	 * Falls back to the default graph if no tenant context is available.
	 *
	 * @param cypher - Cypher query to execute
	 * @param params - Query parameters
	 * @param turn - Turn state containing tenant context
	 */
	private async tenantQuery<T>(
		cypher: string,
		params: Record<string, unknown>,
		turn?: Pick<TurnState, "orgId" | "orgSlug">,
	): Promise<T[]> {
		// Use tenant-specific graph when both orgId and orgSlug are available
		if (this.tenantClient && turn?.orgId && turn?.orgSlug) {
			const tenantContext: TenantContext = {
				orgId: turn.orgId,
				orgSlug: turn.orgSlug,
				userId: "system", // Memory service operates as system user
				isAdmin: false,
			};
			const graph = await this.tenantClient.ensureTenantGraph(tenantContext);
			const result = await graph.query(cypher, { params: params as QueryParams });
			return result.data as T[];
		}

		// Fall back to default graph
		return this.graphClient.query<T>(cypher, params);
	}

	/**
	 * Emit node created event for real-time updates.
	 * Handles async callbacks with proper error catching.
	 */
	private emitNodeCreated(
		sessionId: string,
		node: {
			id: string;
			type: "turn" | "reasoning" | "toolcall" | "diffhunk";
			label: string;
			properties: Record<string, unknown>;
		},
	) {
		if (this.onNodeCreated) {
			// Handle both sync and async callbacks with proper error catching
			Promise.resolve()
				.then(() => this.onNodeCreated?.(sessionId, node))
				.catch((e) => {
					this.logger.error({ err: e }, "Failed to emit node created event");
				});
		}
	}

	/**
	 * Create handler context for event processing
	 */
	private createHandlerContext(sessionId: string, turnId: string): HandlerContext {
		return {
			sessionId,
			turnId,
			graphClient: this.graphClient,
			logger: this.logger,
			emitNodeCreated: (node) => this.emitNodeCreated(sessionId, node),
			publishTurnFinalized: this.onTurnFinalized,
		};
	}

	/**
	 * Normalize a role string to the expected enum values.
	 */
	private normalizeRole(role?: string): "user" | "assistant" | "system" | undefined {
		if (!role) return undefined;
		const normalized = role.toLowerCase();
		if (normalized === "user" || normalized === "assistant" || normalized === "system") {
			return normalized;
		}
		return undefined;
	}

	/**
	 * Normalize a StreamEventInput to a ParsedStreamEvent for handler processing.
	 * Provides default values for required fields.
	 */
	private normalizeEvent(input: StreamEventInput | ParsedStreamEvent): ParsedStreamEvent {
		const eventId = input.event_id || randomUUID();
		const originalEventId = input.original_event_id || eventId;
		const timestamp = input.timestamp || new Date().toISOString();
		const eventType = (input.type || "content") as ParsedStreamEvent["type"];

		return {
			event_id: eventId,
			original_event_id: originalEventId,
			timestamp,
			type: eventType,
			role: this.normalizeRole(input.role),
			content: input.content,
			thought: input.thought,
			tool_call: input.tool_call
				? {
						id: input.tool_call.id || `call_${randomUUID().slice(0, 8)}`,
						name: input.tool_call.name || "unknown_tool",
						arguments_delta: input.tool_call.arguments_delta || "{}",
						index: input.tool_call.index ?? 0,
					}
				: undefined,
			diff: input.diff
				? {
						file: input.diff.file,
						hunk: input.diff.hunk || "",
					}
				: undefined,
			usage: input.usage,
			metadata: input.metadata,
			org_id: (input as any).org_id, // Extract org_id if present
			org_slug: (input as any).org_slug, // Extract org_slug if present
		} as ParsedStreamEvent;
	}

	/**
	 * Process a stream event and aggregate into Turn/Reasoning/FileTouch nodes.
	 * Accepts both loose StreamEventInput (from NATS) and strict ParsedStreamEvent.
	 */
	async processEvent(
		event: StreamEventInput | ParsedStreamEvent,
		sessionId: string,
	): Promise<void> {
		// Normalize input to ParsedStreamEvent
		const normalizedEvent = this.normalizeEvent(event);
		const { role, content } = normalizedEvent;

		// User content starts a new turn
		if (role === "user" && content) {
			await this.startNewTurn(
				sessionId,
				content,
				normalizedEvent.vt_start,
				normalizedEvent.org_id,
				normalizedEvent.org_slug,
			);
			return;
		}

		// Get or create current turn for this session
		let turn = this.activeTurns.get(sessionId);

		// If no active turn and we get assistant content, create a turn without user content
		// (This handles cases where we miss the user message)
		if (
			!turn &&
			(normalizedEvent.content || normalizedEvent.thought || normalizedEvent.tool_call)
		) {
			turn = await this.startNewTurn(
				sessionId,
				"[No user message captured]",
				normalizedEvent.vt_start,
				normalizedEvent.org_id,
				normalizedEvent.org_slug,
			);
		}

		if (!turn) {
			this.logger.debug(
				{ sessionId, type: normalizedEvent.type },
				"No active turn, skipping event",
			);
			return;
		}

		// Delegate to handler registry using Strategy pattern
		const handlers = this.handlerRegistry.getHandlers(normalizedEvent);

		if (handlers.length === 0) {
			this.logger.debug(
				{ sessionId, eventType: normalizedEvent.type },
				"No handler found for event type",
			);
			return;
		}

		const context = this.createHandlerContext(sessionId, turn.turnId);

		for (const handler of handlers) {
			try {
				const result = await handler.handle(normalizedEvent, turn, context);
				if (result.handled) {
					this.logger.debug(
						{
							sessionId,
							turnId: turn.turnId,
							handler: handler.eventType,
							action: result.action,
							nodeId: result.nodeId,
						},
						"Handler processed event",
					);
				}
			} catch (error) {
				this.logger.error(
					{
						err: error,
						sessionId,
						turnId: turn.turnId,
						handler: handler.eventType,
					},
					"Handler failed to process event",
				);
			}
		}
	}

	/**
	 * Start a new turn for a session
	 * @param vtStart - Optional vt_start from event (for benchmark data with historical dates)
	 * @param orgId - Optional org_id from event for tenant isolation
	 * @param orgSlug - Optional org_slug from event for tenant graph naming
	 */
	private async startNewTurn(
		sessionId: string,
		userContent: string,
		vtStart?: number,
		orgId?: string,
		orgSlug?: string,
	): Promise<TurnState> {
		// Finalize any existing turn for this session
		const existingTurn = this.activeTurns.get(sessionId);
		if (existingTurn && !existingTurn.isFinalized) {
			await this.finalizeTurn(existingTurn);
		}

		// Get next sequence index for this session
		const currentSeq = this.sessionSequence.get(sessionId) ?? -1;
		const nextSeq = currentSeq + 1;
		this.sessionSequence.set(sessionId, nextSeq);

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
			createdAt: vtStart ?? Date.now(),
			isFinalized: false,
			orgId, // Tenant organization ID for graph isolation
			orgSlug, // Tenant organization slug for graph naming
		};

		this.activeTurns.set(sessionId, turn);

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
		const ttNow = Date.now();
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
				vt_start: $vtStart,
				tt_start: $ttStart
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

		// Use tenant-specific graph when org context is available
		await this.tenantQuery(
			query,
			{
				sessionId: turn.sessionId,
				turnId: turn.turnId,
				userContent: turn.userContent.slice(0, 10000), // Limit stored content
				userContentHash,
				assistantPreview: turn.assistantContent.slice(0, 2000),
				sequenceIndex: turn.sequenceIndex,
				filesTouched: JSON.stringify([...turn.filesTouched.keys()]),
				toolCallsCount: turn.toolCallsCount,
				prevSeqIndex: turn.sequenceIndex - 1,
				vtStart: turn.createdAt,
				ttStart: ttNow,
			},
			turn,
		);

		// Emit node created event for real-time WebSocket updates
		try {
			this.emitNodeCreated(turn.sessionId, {
				id: turn.turnId,
				type: "turn",
				label: "Turn",
				properties: {
					user_content: turn.userContent.slice(0, 500),
					sequence_index: turn.sequenceIndex,
				},
			});
		} catch (error) {
			this.logger.error(
				{ err: error, turnId: turn.turnId },
				"Failed to emit turn node created event",
			);
		}
	}

	/**
	 * Finalize a turn (update with final stats)
	 */
	private async finalizeTurn(turn: TurnState): Promise<void> {
		// Guard against double finalization race condition
		if (turn.isFinalized) return;

		// Set finalized flag BEFORE async operation to prevent race condition
		turn.isFinalized = true;

		const query = `
			MATCH (t:Turn {id: $turnId})
			SET t.assistant_preview = $preview,
				t.files_touched = $filesTouched,
				t.tool_calls_count = $toolCallsCount,
				t.input_tokens = $inputTokens,
				t.output_tokens = $outputTokens
		`;

		try {
			// Use tenant-specific graph when org context is available
			await this.tenantQuery(
				query,
				{
					turnId: turn.turnId,
					preview: turn.assistantContent.slice(0, 2000),
					filesTouched: JSON.stringify([...turn.filesTouched.keys()]),
					toolCallsCount: turn.toolCallsCount,
					inputTokens: turn.inputTokens,
					outputTokens: turn.outputTokens,
				},
				turn,
			);

			// Publish turn_finalized event for search service indexing
			if (this.onTurnFinalized) {
				try {
					await this.onTurnFinalized({
						id: turn.turnId,
						session_id: turn.sessionId,
						sequence_index: turn.sequenceIndex,
						user_content: turn.userContent,
						assistant_content: turn.assistantContent,
						reasoning_preview: turn.reasoningBlocks
							.map((r) => r.content)
							.join("\n")
							.slice(0, 500),
						tool_calls: turn.toolCalls.map((tc) => tc.toolName),
						files_touched: [...turn.filesTouched.keys()],
						input_tokens: turn.inputTokens,
						output_tokens: turn.outputTokens,
						timestamp: Date.now(),
						vt_start: turn.createdAt,
						org_id: turn.orgId, // Propagate org_id for tenant isolation
					});
				} catch (e) {
					this.logger.error(
						{ err: e, turnId: turn.turnId },
						"Failed to publish turn_finalized event",
					);
				}
			}

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
		} catch (error) {
			// If finalization fails, reset the flag so it can be retried
			turn.isFinalized = false;
			this.logger.error({ err: error, turnId: turn.turnId }, "Failed to finalize turn");
			throw error;
		}
	}

	/**
	 * Clean up stale turns (runs periodically)
	 */
	async cleanupStaleTurns(maxAgeMs: number = 30 * 60 * 1000): Promise<void> {
		const now = Date.now();
		for (const [sessionId, turn] of this.activeTurns) {
			if (now - turn.createdAt > maxAgeMs && !turn.isFinalized) {
				await this.finalizeTurn(turn);
				this.activeTurns.delete(sessionId);
				this.logger.info({ turnId: turn.turnId, sessionId }, "Cleaned up stale turn");
			}
		}
	}

	/**
	 * Clear session state - useful for cleanup when sessions end
	 */
	clearSession(sessionId: string): void {
		this.activeTurns.delete(sessionId);
		this.sessionSequence.delete(sessionId);
	}

	/**
	 * Get the handler registry (for testing or custom handler registration)
	 */
	getHandlerRegistry(): EventHandlerRegistry {
		return this.handlerRegistry;
	}
}
