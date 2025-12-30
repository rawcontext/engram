import type { ParsedStreamEvent } from "@engram/events";
import type { EventHandler, HandlerContext, HandlerResult, TurnState } from "./handler.interface";

/**
 * UsageEventHandler processes token usage events.
 * Updates turn token counts and finalizes the turn in the graph,
 * as usage events typically signal the end of an assistant response.
 */
export class UsageEventHandler implements EventHandler {
	readonly eventType = "usage";

	canHandle(event: ParsedStreamEvent): boolean {
		return event.type === "usage" && event.usage !== undefined;
	}

	async handle(
		event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult> {
		if (!event.usage) {
			return { handled: false };
		}

		// Update token counts
		turn.inputTokens = event.usage.input_tokens;
		turn.outputTokens = event.usage.output_tokens;

		// Usage event typically signals end of response - finalize the turn
		await this.finalizeTurn(turn, context);

		return {
			handled: true,
			action: "turn_finalized",
			nodeId: turn.turnId,
		};
	}

	/**
	 * Finalize a turn with final stats
	 */
	private async finalizeTurn(turn: TurnState, context: HandlerContext): Promise<void> {
		if (turn.isFinalized) return;

		const query = `
			MATCH (t:Turn {id: $turnId})
			SET t.assistant_preview = $preview,
				t.files_touched = $filesTouched,
				t.tool_calls_count = $toolCallsCount,
				t.input_tokens = $inputTokens,
				t.output_tokens = $outputTokens,
				t.vt_end = $now,
				t.tt_end = $now
		`;

		await context.graphClient.query(query, {
			turnId: turn.turnId,
			preview: turn.assistantContent.slice(0, 2000),
			filesTouched: JSON.stringify([...turn.filesTouched.keys()]),
			toolCallsCount: turn.toolCallsCount,
			inputTokens: turn.inputTokens,
			outputTokens: turn.outputTokens,
			now: Date.now(),
		});

		turn.isFinalized = true;

		// Publish turn_finalized event for search service indexing
		if (context.publishTurnFinalized) {
			try {
				await context.publishTurnFinalized({
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
				context.logger.error(
					{ err: e, turnId: turn.turnId },
					"Failed to publish turn_finalized event",
				);
			}
		}

		context.logger.info(
			{
				turnId: turn.turnId,
				sessionId: turn.sessionId,
				contentLength: turn.assistantContent.length,
				reasoningBlocks: turn.reasoningBlocks.length,
				filesTouched: turn.filesTouched.size,
				toolCalls: turn.toolCallsCount,
				inputTokens: turn.inputTokens,
				outputTokens: turn.outputTokens,
			},
			"Finalized turn",
		);
	}
}
