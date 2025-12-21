import type { GraphClient } from "@engram/storage";
import type { VirtualFileSystem } from "@engram/vfs";
import { Rehydrator } from "./rehydrator";

interface ToolCallEvent {
	id: string;
	name: string;
	arguments: string; // JSON string
	result?: string; // Original observation/result
	vt_start: number;
	session_id: string;
}

interface ReplayResult {
	success: boolean;
	matches: boolean;
	originalOutput: unknown;
	replayOutput: unknown;
	error?: string;
}

/**
 * Replay Engine
 *
 * Replays tool executions by rehydrating VFS state and re-executing.
 * Used for debugging and verification of past agent decisions.
 */
export class ReplayEngine {
	private rehydrator: Rehydrator;

	constructor(private graphClient: GraphClient) {
		this.rehydrator = new Rehydrator({ graphClient });
	}

	/**
	 * Replay a specific tool call event and compare outputs.
	 *
	 * @param sessionId - The session containing the event
	 * @param eventId - The ToolCall event ID to replay
	 * @returns ReplayResult with comparison details
	 */
	async replay(sessionId: string, eventId: string): Promise<ReplayResult> {
		try {
			// 1. Fetch the original ToolCall event
			const event = await this.fetchToolCallEvent(sessionId, eventId);
			if (!event) {
				return {
					success: false,
					matches: false,
					originalOutput: null,
					replayOutput: null,
					error: `ToolCall event ${eventId} not found in session ${sessionId}`,
				};
			}

			// 2. Rehydrate VFS to the state just before this event
			const vfs = await this.rehydrator.rehydrate(sessionId, event.vt_start - 1);

			// 3. Parse tool arguments
			const args = JSON.parse(event.arguments || "{}");

			// 4. Execute tool with rehydrated state
			const replayOutput = await this.executeTool(event.name, args, vfs);

			// 5. Compare with original output
			const originalOutput = event.result ? JSON.parse(event.result) : null;
			const matches = this.compareOutputs(originalOutput, replayOutput);

			return {
				success: true,
				matches,
				originalOutput,
				replayOutput,
			};
		} catch (error) {
			return {
				success: false,
				matches: false,
				originalOutput: null,
				replayOutput: null,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Fetch a ToolCall event from the graph.
	 */
	private async fetchToolCallEvent(
		sessionId: string,
		eventId: string,
	): Promise<ToolCallEvent | null> {
		const query = `
			MATCH (sess:Session {id: $sessionId})-[:TRIGGERS]->(t:Thought)-[:NEXT*0..]->(linked:Thought)
			MATCH (linked)-[:YIELDS]->(tc:ToolCall {id: $eventId})
			RETURN tc.id as id, tc.name as name, tc.arguments as arguments,
			       tc.result as result, tc.vt_start as vt_start
		`;

		const results = await this.graphClient.query<{
			id: string;
			name: string;
			arguments: string;
			result: string;
			vt_start: number;
		}>(query, { sessionId, eventId });

		if (!results || results.length === 0) {
			return null;
		}

		const row = results[0];
		return {
			id: row.id,
			name: row.name,
			arguments: row.arguments,
			result: row.result,
			vt_start: row.vt_start,
			session_id: sessionId,
		};
	}

	/**
	 * Execute a tool with the given arguments and VFS state.
	 */
	private async executeTool(
		toolName: string,
		args: Record<string, unknown>,
		vfs: VirtualFileSystem,
	): Promise<unknown> {
		switch (toolName) {
			case "read_file": {
				const path = args.path as string;
				return { content: vfs.readFile(path) };
			}
			case "write_file": {
				const path = args.path as string;
				const content = args.content as string;
				vfs.writeFile(path, content);
				return { success: true };
			}
			case "list_directory": {
				const path = args.path as string;
				return { entries: vfs.readDir(path) };
			}
			default:
				return {
					error: `Tool '${toolName}' replay not implemented`,
					args,
				};
		}
	}

	/**
	 * Compare original and replay outputs for equality.
	 */
	private compareOutputs(original: unknown, replay: unknown): boolean {
		if (original === null && replay === null) return true;
		if (original === null || replay === null) return false;

		try {
			return JSON.stringify(original) === JSON.stringify(replay);
		} catch {
			return false;
		}
	}
}
