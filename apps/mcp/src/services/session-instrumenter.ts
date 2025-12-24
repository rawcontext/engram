import { createBitemporal, MAX_DATE } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
import { ulid } from "ulid";

export interface SessionInstrumenterOptions {
	graphClient: GraphClient;
	logger: Logger;
	agentType?: string;
	userId?: string;
}

export interface ToolCallRecord {
	toolName: string;
	argumentsJson: string;
	status: "pending" | "success" | "error";
	errorMessage?: string;
}

/**
 * SessionInstrumenter tracks MCP tool calls as graph nodes.
 *
 * When the MCP server is used (e.g., by Claude Code), this service:
 * 1. Creates a Session node on first tool call
 * 2. Records each tool call as a ToolCall node linked via SELF_INVOKES
 * 3. Updates tool call status after execution
 * 4. Closes the session on shutdown
 */
export class SessionInstrumenter {
	private graphClient: GraphClient;
	private logger: Logger;
	private agentType: string;
	private userId: string;

	private sessionId: string | null = null;
	private sequenceIndex = 0;
	private initialized = false;

	constructor(options: SessionInstrumenterOptions) {
		this.graphClient = options.graphClient;
		this.logger = options.logger;
		this.agentType = options.agentType ?? "claude-code";
		this.userId = options.userId ?? "mcp-self";
	}

	/**
	 * Get the current session ID, creating a session if needed
	 */
	async getSessionId(workingDir?: string, gitRemote?: string): Promise<string> {
		if (!this.sessionId) {
			await this.createSession(workingDir, gitRemote);
		}
		// After createSession, sessionId is guaranteed to be set
		if (!this.sessionId) {
			throw new Error("Failed to create session");
		}
		return this.sessionId;
	}

	/**
	 * Create the session node in FalkorDB
	 */
	private async createSession(workingDir?: string, gitRemote?: string): Promise<void> {
		if (this.initialized) return;

		const id = ulid();
		const temporal = createBitemporal();

		await this.graphClient.query(
			`CREATE (s:Session {
				id: $id,
				user_id: $userId,
				started_at: $startedAt,
				agent_type: $agentType,
				working_dir: $workingDir,
				git_remote: $gitRemote,
				vt_start: $vtStart,
				vt_end: $vtEnd,
				tt_start: $ttStart,
				tt_end: $ttEnd
			})`,
			{
				id,
				userId: this.userId,
				startedAt: temporal.vt_start,
				agentType: this.agentType,
				workingDir: workingDir ?? null,
				gitRemote: gitRemote ?? null,
				vtStart: temporal.vt_start,
				vtEnd: temporal.vt_end,
				ttStart: temporal.tt_start,
				ttEnd: temporal.tt_end,
			},
		);

		this.sessionId = id;
		this.initialized = true;
		this.logger.info(
			{ sessionId: id, workingDir, agentType: this.agentType },
			"Created MCP session",
		);
	}

	/**
	 * Record a tool call and link it to the session
	 */
	async recordToolCall(record: ToolCallRecord): Promise<string> {
		const sessionId = await this.getSessionId();
		const id = ulid();
		const callId = ulid();
		const temporal = createBitemporal();
		const seqIndex = this.sequenceIndex++;

		await this.graphClient.query(
			`MATCH (s:Session {id: $sessionId})
			 WHERE s.tt_end = $maxDate
			 CREATE (tc:ToolCall {
				 id: $id,
				 call_id: $callId,
				 tool_name: $toolName,
				 tool_type: $toolType,
				 arguments_json: $argumentsJson,
				 arguments_preview: $argumentsPreview,
				 status: $status,
				 error_message: $errorMessage,
				 sequence_index: $sequenceIndex,
				 vt_start: $vtStart,
				 vt_end: $vtEnd,
				 tt_start: $ttStart,
				 tt_end: $ttEnd
			 })
			 CREATE (s)-[:SELF_INVOKES {
				 vt_start: $vtStart,
				 vt_end: $vtEnd,
				 tt_start: $ttStart,
				 tt_end: $ttEnd
			 }]->(tc)`,
			{
				sessionId,
				maxDate: MAX_DATE,
				id,
				callId,
				toolName: record.toolName,
				toolType: "mcp",
				argumentsJson: record.argumentsJson,
				argumentsPreview: record.argumentsJson.substring(0, 500),
				status: record.status,
				errorMessage: record.errorMessage ?? null,
				sequenceIndex: seqIndex,
				vtStart: temporal.vt_start,
				vtEnd: temporal.vt_end,
				ttStart: temporal.tt_start,
				ttEnd: temporal.tt_end,
			},
		);

		this.logger.debug(
			{ toolCallId: id, toolName: record.toolName, sequenceIndex: seqIndex },
			"Recorded tool call",
		);

		return id;
	}

	/**
	 * Update tool call status after execution
	 */
	async updateToolCallStatus(
		id: string,
		status: "success" | "error",
		errorMessage?: string,
	): Promise<void> {
		await this.graphClient.query(
			`MATCH (tc:ToolCall {id: $id})
			 WHERE tc.tt_end = $maxDate
			 SET tc.status = $status, tc.error_message = $errorMessage`,
			{ id, maxDate: MAX_DATE, status, errorMessage: errorMessage ?? null },
		);
	}

	/**
	 * End the session by setting vt_end to now
	 */
	async endSession(): Promise<void> {
		if (!this.sessionId) return;

		const now = Date.now();
		await this.graphClient.query(
			`MATCH (s:Session {id: $sessionId})
			 WHERE s.tt_end = $maxDate
			 SET s.vt_end = $now`,
			{ sessionId: this.sessionId, maxDate: MAX_DATE, now },
		);

		this.logger.info(
			{ sessionId: this.sessionId, toolCallCount: this.sequenceIndex },
			"Ended MCP session",
		);
	}

	/**
	 * Check if instrumentation is enabled
	 */
	get isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Get the current session ID without creating
	 */
	get currentSessionId(): string | null {
		return this.sessionId;
	}
}
