import { randomUUID } from "node:crypto";
import type { ParsedStreamEvent } from "@engram/events";
import type { EventHandler, HandlerContext, HandlerResult, TurnState } from "./handler.interface";

/**
 * DiffEventHandler processes file diff events.
 * Updates the most recent tool call with file path and diff information,
 * creates DiffHunk nodes for VFS rehydration, and tracks files touched at the turn level.
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

		// Create DiffHunk node for VFS rehydration if we have hunk data
		if (event.diff.hunk && recentToolCall) {
			await this.createDiffHunkNode(
				recentToolCall.id,
				filePath,
				event.diff.hunk,
				0, // line start - parse from hunk if needed
				0, // line end - parse from hunk if needed
				context,
			);
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

	/**
	 * Create a DiffHunk node linked to the ToolCall for VFS rehydration.
	 * These nodes are used by the Rehydrator to reconstruct file states at any point in time.
	 */
	private async createDiffHunkNode(
		toolCallId: string,
		filePath: string,
		patchContent: string,
		originalLineStart: number,
		originalLineEnd: number,
		context: HandlerContext,
	): Promise<void> {
		const diffHunkId = randomUUID();
		const now = Date.now();

		const query = `
			MATCH (tc:ToolCall {id: $toolCallId})
			CREATE (dh:DiffHunk {
				id: $diffHunkId,
				file_path: $filePath,
				original_line_start: $originalLineStart,
				original_line_end: $originalLineEnd,
				patch_content: $patchContent,
				vt_start: $now,
				tt_start: $now
			})
			MERGE (tc)-[:YIELDS]->(dh)
			RETURN dh
		`;

		await context.graphClient.query(query, {
			toolCallId,
			diffHunkId,
			filePath,
			originalLineStart,
			originalLineEnd,
			patchContent,
			now,
		});

		context.logger.debug(
			{ diffHunkId, toolCallId, filePath, lineRange: [originalLineStart, originalLineEnd] },
			"Created DiffHunk node for VFS rehydration",
		);

		// Note: DiffHunk nodes are not emitted via NodeCreatedCallback
		// because they are supporting nodes for VFS rehydration, not top-level entities
		// like Turn, Reasoning, or ToolCall nodes
	}
}
