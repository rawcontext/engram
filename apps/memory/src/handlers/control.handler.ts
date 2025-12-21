import type { ParsedStreamEvent } from "@engram/events";
import type { EventHandler, HandlerContext, HandlerResult, TurnState } from "./handler.interface";

/**
 * ControlEventHandler processes control events like turn_start and turn_end.
 * These events signal turn boundaries and can be used for orchestration.
 */
export class ControlEventHandler implements EventHandler {
	readonly eventType = "control";

	canHandle(event: ParsedStreamEvent): boolean {
		return event.type === "control";
	}

	async handle(
		event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult> {
		const signal = event.metadata?.signal as string | undefined;

		context.logger.debug(
			{
				turnId: turn.turnId,
				sessionId: turn.sessionId,
				signal,
			},
			"Processing control event",
		);

		switch (signal) {
			case "turn_start":
				return await this.handleTurnStart(event, turn, context);
			case "turn_end":
				return await this.handleTurnEnd(event, turn, context);
			case "pause":
			case "resume":
				context.logger.debug({ signal }, "Received pause/resume signal (not yet implemented)");
				return { handled: true, action: "control_acknowledged" };
			default:
				context.logger.debug({ signal }, "Unknown control signal");
				return { handled: true, action: "control_acknowledged" };
		}
	}

	/**
	 * Handle turn_start signal.
	 * This can be used to initialize turn state or mark turn boundaries.
	 */
	private async handleTurnStart(
		event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult> {
		// Mark turn start time in graph
		const query = `
			MATCH (t:Turn {id: $turnId})
			SET t.control_start_at = $timestamp
		`;

		await context.graphClient.query(query, {
			turnId: turn.turnId,
			timestamp: event.timestamp,
		});

		context.logger.info({ turnId: turn.turnId }, "Turn started via control event");

		return {
			handled: true,
			action: "turn_started",
		};
	}

	/**
	 * Handle turn_end signal.
	 * This triggers turn finalization and cleanup.
	 */
	private async handleTurnEnd(
		event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult> {
		// Mark turn end time and finalize
		const query = `
			MATCH (t:Turn {id: $turnId})
			SET t.control_end_at = $timestamp,
				t.is_finalized = true
		`;

		await context.graphClient.query(query, {
			turnId: turn.turnId,
			timestamp: event.timestamp,
		});

		turn.isFinalized = true;

		context.logger.info({ turnId: turn.turnId }, "Turn ended via control event");

		return {
			handled: true,
			action: "turn_ended",
		};
	}
}
