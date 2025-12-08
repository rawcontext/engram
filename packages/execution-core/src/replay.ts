import type { FalkorClient } from "@engram/storage";
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
 * Deterministic Replay Engine
 *
 * Replays tool executions with the exact same state as the original execution.
 * Used for debugging, verification, and understanding past agent decisions.
 */
export class ReplayEngine {
	private rehydrator: Rehydrator;
	private originalDateNow: typeof Date.now;
	private originalMathRandom: typeof Math.random;

	constructor(private falkor: FalkorClient) {
		this.rehydrator = new Rehydrator(falkor);
		this.originalDateNow = Date.now;
		this.originalMathRandom = Math.random;
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

			// 3. Set up deterministic environment
			this.setupDeterministicEnv(event.vt_start);

			try {
				// 4. Parse tool arguments
				const args = JSON.parse(event.arguments || "{}");

				// 5. Execute tool with rehydrated state
				const replayOutput = await this.executeTool(event.name, args, vfs);

				// 6. Compare with original output
				const originalOutput = event.result ? JSON.parse(event.result) : null;
				const matches = this.compareOutputs(originalOutput, replayOutput);

				return {
					success: true,
					matches,
					originalOutput,
					replayOutput,
				};
			} finally {
				// Restore environment
				this.restoreEnv();
			}
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

		const results = await this.falkor.query<{
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
	 * Set up deterministic environment for replay.
	 * Mocks Date.now() and Math.random() for reproducibility.
	 */
	private setupDeterministicEnv(timestamp: number): void {
		// Mock Date.now() to return the original execution time
		Date.now = () => timestamp;

		// Create a seeded pseudo-random number generator
		// Using the timestamp as seed for reproducibility
		let seed = timestamp;
		Math.random = () => {
			// Simple LCG (Linear Congruential Generator)
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
	}

	/**
	 * Restore the original environment after replay.
	 */
	private restoreEnv(): void {
		Date.now = this.originalDateNow;
		Math.random = this.originalMathRandom;
	}

	/**
	 * Execute a tool with the given arguments and VFS state.
	 * This is a simplified implementation - in production, would use MCP or tool registry.
	 */
	private async executeTool(
		toolName: string,
		args: Record<string, unknown>,
		vfs: VirtualFileSystem,
	): Promise<unknown> {
		// Built-in tool implementations for replay
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
				// For unknown tools, return a placeholder indicating replay not supported
				return {
					error: `Tool '${toolName}' replay not implemented`,
					args,
				};
		}
	}

	/**
	 * Compare original and replay outputs for equality.
	 * Handles both primitive and object comparisons.
	 */
	private compareOutputs(original: unknown, replay: unknown): boolean {
		if (original === null && replay === null) return true;
		if (original === null || replay === null) return false;

		// Deep equality check via JSON serialization
		try {
			return JSON.stringify(original) === JSON.stringify(replay);
		} catch {
			return false;
		}
	}
}
