import type { ParsedStreamEvent } from "@engram/events";
import type { EventHandler, HandlerContext, HandlerResult, TurnState } from "./handler.interface";

/**
 * ControlEventHandler processes control events like turn_start and turn_end.
 * These events signal turn boundaries and can be used for orchestration.
 *
 * Note: Currently, turn boundaries are primarily detected by user content
 * in the TurnAggregator. This handler exists for future extensibility
 * when providers send explicit control events.
 */
export class ControlEventHandler implements EventHandler {
	readonly eventType = "control";

	canHandle(event: ParsedStreamEvent): boolean {
		return event.type === "control";
	}

	async handle(
		_event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult> {
		// Control events are informational - log and acknowledge
		context.logger.debug(
			{
				turnId: turn.turnId,
				sessionId: turn.sessionId,
				eventType: "control",
			},
			"Received control event",
		);

		// Future: Handle specific control signals like:
		// - turn_start: Could initialize turn state
		// - turn_end: Could trigger finalization
		// - pause/resume: Could affect streaming behavior

		return {
			handled: true,
			action: "control_acknowledged",
		};
	}
}
