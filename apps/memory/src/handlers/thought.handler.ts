import { createHash, randomUUID } from "node:crypto";
import type { ParsedStreamEvent } from "@engram/events";
import type {
	EventHandler,
	HandlerContext,
	HandlerResult,
	ReasoningState,
	TurnState,
} from "./handler.interface";

/**
 * ThoughtEventHandler processes thinking/reasoning block events.
 * Creates Reasoning nodes linked to the current turn and tracks
 * pending reasoning IDs for subsequent tool call linkage.
 */
export class ThoughtEventHandler implements EventHandler {
	readonly eventType = "thought";

	canHandle(event: ParsedStreamEvent): boolean {
		return event.type === "thought" && event.thought !== undefined;
	}

	async handle(
		event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult> {
		if (!event.thought) {
			return { handled: false };
		}

		const reasoningId = await this.createReasoningNode(turn, event.thought, context);

		const reasoningState: ReasoningState = {
			id: reasoningId,
			sequenceIndex: turn.contentBlockIndex,
			content: event.thought,
		};

		turn.reasoningBlocks.push(reasoningState);
		// Add to pending reasoning IDs - will be linked to next tool call
		turn.pendingReasoningIds.push(reasoningId);
		turn.contentBlockIndex++;

		return {
			handled: true,
			action: "reasoning_created",
			nodeId: reasoningId,
		};
	}

	/**
	 * Create a Reasoning node in the graph and link it to the current Turn
	 */
	private async createReasoningNode(
		turn: TurnState,
		thought: string,
		context: HandlerContext,
	): Promise<string> {
		const reasoningId = randomUUID();
		const now = Date.now();
		const contentHash = createHash("sha256").update(thought).digest("hex");
		const sequenceIndex = turn.contentBlockIndex;

		const query = `
			MATCH (t:Turn {id: $turnId})
			CREATE (r:Reasoning {
				id: $reasoningId,
				content_hash: $contentHash,
				preview: $preview,
				reasoning_type: 'chain_of_thought',
				sequence_index: $sequenceIndex,
				vt_start: $now,
				tt_start: $now
			})
			MERGE (t)-[:CONTAINS]->(r)
			RETURN r
		`;

		await context.graphClient.query(query, {
			turnId: turn.turnId,
			reasoningId,
			contentHash,
			preview: thought.slice(0, 1000),
			sequenceIndex,
			now,
		});

		context.logger.debug({ reasoningId, turnId: turn.turnId }, "Created reasoning node");

		// Emit node created event for real-time WebSocket updates
		if (context.emitNodeCreated) {
			try {
				context.emitNodeCreated({
					id: reasoningId,
					type: "reasoning",
					label: "Reasoning",
					properties: {
						preview: thought.slice(0, 500),
						sequence_index: sequenceIndex,
					},
				});
			} catch (error) {
				context.logger.error({ err: error, reasoningId }, "Failed to emit node created event");
			}
		}

		return reasoningId;
	}
}
