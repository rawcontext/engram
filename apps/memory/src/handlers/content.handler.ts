import type { ParsedStreamEvent } from "@engram/events";
import type { EventHandler, HandlerContext, HandlerResult, TurnState } from "./handler.interface";

/**
 * ContentEventHandler processes assistant content delta events.
 * Accumulates content into the turn's assistantContent field and
 * periodically updates the preview in the graph.
 */
export class ContentEventHandler implements EventHandler {
	readonly eventType = "content";
	private lastUpdateLength = new Map<string, number>();
	private readonly UPDATE_THRESHOLD = 500;

	canHandle(event: ParsedStreamEvent): boolean {
		return event.type === "content" && event.role === "assistant" && event.content !== undefined;
	}

	async handle(
		event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult> {
		if (!event.content) {
			return { handled: false };
		}

		// Accumulate content
		turn.assistantContent += event.content;
		turn.contentBlockIndex++;

		// Update preview in graph when content grows by UPDATE_THRESHOLD chars since last update
		const lastUpdate = this.lastUpdateLength.get(turn.turnId) ?? 0;
		if (turn.assistantContent.length - lastUpdate >= this.UPDATE_THRESHOLD) {
			await this.updateTurnPreview(turn, context);
			this.lastUpdateLength.set(turn.turnId, turn.assistantContent.length);
		}

		return {
			handled: true,
			action: "content_accumulated",
		};
	}

	/**
	 * Update the Turn node's assistant preview in the graph
	 */
	private async updateTurnPreview(turn: TurnState, context: HandlerContext): Promise<void> {
		const query = `
			MATCH (t:Turn {id: $turnId})
			SET t.assistant_preview = $preview
		`;

		await context.graphClient.query(query, {
			turnId: turn.turnId,
			preview: turn.assistantContent.slice(0, 2000),
		});

		context.logger.debug(
			{ turnId: turn.turnId, previewLength: turn.assistantContent.length },
			"Updated turn preview",
		);
	}

	/**
	 * Clean up tracking data for a finalized turn to prevent memory leaks
	 */
	cleanupTurn(turnId: string): void {
		this.lastUpdateLength.delete(turnId);
	}
}
