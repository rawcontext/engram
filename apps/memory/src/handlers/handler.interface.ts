import type { ParsedStreamEvent } from "@engram/events";
import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";

/**
 * Context provided to event handlers for processing stream events.
 * Contains all dependencies needed to handle events and update the graph.
 */
export interface HandlerContext {
	/** The session ID for the current stream */
	sessionId: string;
	/** The current turn ID being processed */
	turnId: string;
	/** Graph database client for persisting nodes and edges */
	graphClient: GraphClient;
	/** Logger instance for debugging and error reporting */
	logger: Logger;
	/** Callback for emitting real-time node creation events (turn, reasoning, toolcall only) */
	emitNodeCreated?: (node: {
		id: string;
		type: "turn" | "reasoning" | "toolcall";
		label: string;
		properties: Record<string, unknown>;
	}) => void;
}

/**
 * Turn state passed to handlers for reading and updating turn data.
 * Handlers can modify this state to track content accumulation.
 */
export interface TurnState {
	turnId: string;
	sessionId: string;
	userContent: string;
	assistantContent: string;
	reasoningBlocks: ReasoningState[];
	toolCalls: ToolCallState[];
	filesTouched: Map<string, { action: string; count: number; toolCallId?: string }>;
	pendingReasoningIds: string[];
	toolCallsCount: number;
	contentBlockIndex: number;
	inputTokens: number;
	outputTokens: number;
	sequenceIndex: number;
	createdAt: number;
	isFinalized: boolean;
}

export interface ReasoningState {
	id: string;
	sequenceIndex: number;
	content: string;
}

export interface ToolCallState {
	id: string;
	callId: string;
	toolName: string;
	toolType: string;
	argumentsJson: string;
	sequenceIndex: number;
	triggeringReasoningIds: string[];
	filePath?: string;
	fileAction?: string;
}

/**
 * Handler result indicating what actions were taken.
 * Used for logging and metrics.
 */
export interface HandlerResult {
	/** Whether the handler successfully processed the event */
	handled: boolean;
	/** Optional description of what was done */
	action?: string;
	/** ID of any node created */
	nodeId?: string;
}

/**
 * EventHandler interface for the Strategy pattern.
 * Each handler is responsible for processing a specific event type.
 */
export interface EventHandler {
	/** The event type this handler processes (e.g., 'content', 'thought', 'tool_call') */
	readonly eventType: string;

	/**
	 * Determine if this handler can process the given event.
	 * Handlers may use multiple criteria beyond just the event type.
	 *
	 * @param event - The parsed stream event to evaluate
	 * @returns True if this handler should process the event
	 */
	canHandle(event: ParsedStreamEvent): boolean;

	/**
	 * Process the event and update the turn state and/or graph.
	 *
	 * @param event - The parsed stream event to process
	 * @param turn - The current turn state (mutable)
	 * @param context - Handler context with dependencies
	 * @returns Result indicating what actions were taken
	 */
	handle(
		event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult>;
}
