import type { ParsedStreamEvent } from "@engram/events";
import type { EventHandler, HandlerContext, HandlerResult, TurnState } from "./handler.interface";

/**
 * DiffEventHandler processes file diff events.
 * Updates the most recent tool call with file path and diff information,
 * and tracks files touched at the turn level.
 */
export class DiffEventHandler implements EventHandler {
	readonly eventType = "diff";

	canHandle(event: ParsedStreamEvent): boolean {
		return event.type === "diff" && event.diff?.file !== undefined;
	}

	async handle(
		event: ParsedStreamEvent,
		turn: TurnState,
		context: HandlerContext,
	): Promise<HandlerResult> {
		if (!event.diff?.file) {
			return { handled: false };
		}

		const action = "edit";
		const filePath = event.diff.file;

		// Find the most recent tool call and update its file_path if not already set
		const recentToolCall =
			turn.toolCalls.length > 0 ? turn.toolCalls[turn.toolCalls.length - 1] : undefined;

		if (recentToolCall && !recentToolCall.filePath) {
			// Update the tool call with file info from the diff
			recentToolCall.filePath = filePath;
			recentToolCall.fileAction = action;
			await this.updateToolCallFile(recentToolCall.id, filePath, action, event.diff.hunk, context);
		}

		// Track files touched at turn level for aggregation
		const existing = turn.filesTouched.get(filePath);
		if (existing) {
			existing.count++;
		} else {
			turn.filesTouched.set(filePath, {
				action,
				count: 1,
				toolCallId: recentToolCall?.id,
			});
		}

		return {
			handled: true,
			action: "diff_processed",
			nodeId: recentToolCall?.id,
		};
	}

	/**
	 * Update a ToolCall node with file path and action from diff events
	 */
	private async updateToolCallFile(
		toolCallId: string,
		filePath: string,
		fileAction: string,
		diffPreview: string | undefined,
		context: HandlerContext,
	): Promise<void> {
		const query = `
			MATCH (tc:ToolCall {id: $toolCallId})
			SET tc.file_path = $filePath,
				tc.file_action = $fileAction,
				tc.diff_preview = $diffPreview
		`;

		await context.graphClient.query(query, {
			toolCallId,
			filePath,
			fileAction,
			diffPreview: diffPreview?.slice(0, 500) ?? null,
		});

		context.logger.debug({ toolCallId, filePath, fileAction }, "Updated tool call with file info");
	}
}
