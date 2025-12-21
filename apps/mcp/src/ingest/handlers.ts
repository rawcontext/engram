import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
import type { Context } from "hono";
import { z } from "zod";
import type { MemoryStore } from "../services/memory-store";

// =============================================================================
// Schemas
// =============================================================================

const IngestEventSchema = z.object({
	client: z.string().describe("Client identifier (claude-code, codex, gemini, cursor, etc.)"),
	session_id: z.string().describe("Session identifier"),
	event_type: z
		.enum(["tool_call", "prompt", "response", "session_start", "session_end"])
		.describe("Type of event"),
	timestamp: z.string().describe("ISO timestamp"),
	data: z.record(z.string(), z.unknown()).describe("Event-specific data"),
	context: z
		.object({
			working_dir: z.string().optional(),
			git_remote: z.string().optional(),
		})
		.optional(),
});

const ToolEventSchema = z.object({
	client: z.string(),
	session_id: z.string(),
	timestamp: z.string(),
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()).optional(),
	tool_output: z.string().optional(),
	status: z.enum(["success", "error"]).optional(),
	duration_ms: z.number().int().optional(),
	context: z
		.object({
			working_dir: z.string().optional(),
			git_remote: z.string().optional(),
		})
		.optional(),
});

const PromptEventSchema = z.object({
	client: z.string(),
	session_id: z.string(),
	timestamp: z.string(),
	content: z.string().describe("User prompt content"),
	context: z
		.object({
			working_dir: z.string().optional(),
			git_remote: z.string().optional(),
		})
		.optional(),
});

const SessionEventSchema = z.object({
	client: z.string(),
	session_id: z.string(),
	timestamp: z.string(),
	event: z.enum(["start", "end"]),
	summary: z.string().optional().describe("Session summary (for end events)"),
	context: z
		.object({
			working_dir: z.string().optional(),
			git_remote: z.string().optional(),
		})
		.optional(),
});

export type IngestEvent = z.infer<typeof IngestEventSchema>;
export type ToolEvent = z.infer<typeof ToolEventSchema>;
export type PromptEvent = z.infer<typeof PromptEventSchema>;
export type SessionEvent = z.infer<typeof SessionEventSchema>;

// =============================================================================
// Handler Dependencies
// =============================================================================

export interface IngestHandlerDeps {
	memoryStore: MemoryStore;
	graphClient: GraphClient;
	logger: Logger;
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Generic event ingestion
 */
export async function handleIngestEvent(c: Context, deps: IngestHandlerDeps) {
	const body = await c.req.json();
	const parseResult = IngestEventSchema.safeParse(body);

	if (!parseResult.success) {
		return c.json({ error: "Invalid event format", details: parseResult.error.flatten() }, 400);
	}

	const event = parseResult.data;
	deps.logger.debug({ event }, "Received ingest event");

	try {
		// Route to specific handler based on event type
		switch (event.event_type) {
			case "tool_call":
				await processToolEvent(deps, {
					client: event.client,
					session_id: event.session_id,
					timestamp: event.timestamp,
					tool_name: typeof event.data.tool_name === "string" ? event.data.tool_name : "unknown",
					tool_input:
						event.data.tool_input != null &&
						typeof event.data.tool_input === "object" &&
						!Array.isArray(event.data.tool_input)
							? (event.data.tool_input as Record<string, unknown>)
							: undefined,
					tool_output:
						typeof event.data.tool_output === "string" ? event.data.tool_output : undefined,
					status:
						event.data.status === "success" || event.data.status === "error"
							? event.data.status
							: undefined,
					context: event.context,
				});
				break;

			case "prompt":
				await processPromptEvent(deps, {
					client: event.client,
					session_id: event.session_id,
					timestamp: event.timestamp,
					content: typeof event.data.content === "string" ? event.data.content : "",
					context: event.context,
				});
				break;

			case "session_start":
			case "session_end":
				await processSessionEvent(deps, {
					client: event.client,
					session_id: event.session_id,
					timestamp: event.timestamp,
					event: event.event_type === "session_start" ? "start" : "end",
					summary: typeof event.data.summary === "string" ? event.data.summary : undefined,
					context: event.context,
				});
				break;

			default:
				deps.logger.warn({ eventType: event.event_type }, "Unknown event type");
		}

		return c.json({ status: "accepted", session_id: event.session_id });
	} catch (error) {
		deps.logger.error({ error, event }, "Failed to process ingest event");
		return c.json({ error: "Processing failed" }, 500);
	}
}

/**
 * Tool call ingestion
 */
export async function handleToolIngest(c: Context, deps: IngestHandlerDeps) {
	const body = await c.req.json();
	const parseResult = ToolEventSchema.safeParse(body);

	if (!parseResult.success) {
		return c.json(
			{ error: "Invalid tool event format", details: parseResult.error.flatten() },
			400,
		);
	}

	try {
		await processToolEvent(deps, parseResult.data);
		return c.json({ status: "accepted" });
	} catch (error) {
		deps.logger.error({ error }, "Failed to process tool event");
		return c.json({ error: "Processing failed" }, 500);
	}
}

/**
 * User prompt ingestion
 */
export async function handlePromptIngest(c: Context, deps: IngestHandlerDeps) {
	const body = await c.req.json();
	const parseResult = PromptEventSchema.safeParse(body);

	if (!parseResult.success) {
		return c.json(
			{ error: "Invalid prompt event format", details: parseResult.error.flatten() },
			400,
		);
	}

	try {
		await processPromptEvent(deps, parseResult.data);
		return c.json({ status: "accepted" });
	} catch (error) {
		deps.logger.error({ error }, "Failed to process prompt event");
		return c.json({ error: "Processing failed" }, 500);
	}
}

/**
 * Session lifecycle ingestion
 */
export async function handleSessionIngest(c: Context, deps: IngestHandlerDeps) {
	const body = await c.req.json();
	const parseResult = SessionEventSchema.safeParse(body);

	if (!parseResult.success) {
		return c.json(
			{ error: "Invalid session event format", details: parseResult.error.flatten() },
			400,
		);
	}

	try {
		await processSessionEvent(deps, parseResult.data);
		return c.json({ status: "accepted" });
	} catch (error) {
		deps.logger.error({ error }, "Failed to process session event");
		return c.json({ error: "Processing failed" }, 500);
	}
}

// =============================================================================
// Event Processors
// =============================================================================

async function processToolEvent(deps: IngestHandlerDeps, event: ToolEvent) {
	const { graphClient, logger } = deps;

	await graphClient.connect();

	// Create ToolCall node
	const now = Date.now();
	await graphClient.query(
		`CREATE (tc:ToolCall {
			id: $id,
			call_id: $callId,
			tool_name: $toolName,
			tool_type: $toolType,
			arguments_json: $argsJson,
			status: $status,
			vt_start: $vtStart,
			vt_end: $vtEnd,
			tt_start: $ttStart,
			tt_end: $ttEnd
		})`,
		{
			id: `tc-${now}-${Math.random().toString(36).slice(2, 8)}`,
			callId: `${event.session_id}-${now}`,
			toolName: event.tool_name,
			toolType: categorizeToolType(event.tool_name),
			argsJson: JSON.stringify(event.tool_input ?? {}),
			status: event.status ?? "success",
			vtStart: new Date(event.timestamp).getTime(),
			vtEnd: Number.MAX_SAFE_INTEGER,
			ttStart: now,
			ttEnd: Number.MAX_SAFE_INTEGER,
		},
	);

	logger.debug({ toolName: event.tool_name, sessionId: event.session_id }, "Processed tool event");
}

async function processPromptEvent(deps: IngestHandlerDeps, event: PromptEvent) {
	const { memoryStore, logger } = deps;

	// Store as a turn memory for later recall
	const project = extractProject(event.context?.working_dir);

	await memoryStore.createMemory({
		content: event.content,
		type: "turn",
		source: "auto",
		project,
		sourceSessionId: event.session_id,
	});

	logger.debug({ sessionId: event.session_id, project }, "Processed prompt event");
}

async function processSessionEvent(deps: IngestHandlerDeps, event: SessionEvent) {
	const { graphClient, logger } = deps;

	await graphClient.connect();
	const now = Date.now();

	if (event.event === "start") {
		// Create Session node
		await graphClient.query(
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
				id: event.session_id,
				userId: "default", // Could be extracted from context
				startedAt: new Date(event.timestamp).getTime(),
				agentType: mapClientToAgentType(event.client),
				workingDir: event.context?.working_dir,
				gitRemote: event.context?.git_remote,
				vtStart: new Date(event.timestamp).getTime(),
				vtEnd: Number.MAX_SAFE_INTEGER,
				ttStart: now,
				ttEnd: Number.MAX_SAFE_INTEGER,
			},
		);

		logger.info({ sessionId: event.session_id, client: event.client }, "Session started");
	} else {
		// Update Session node with end time and summary
		await graphClient.query(
			`MATCH (s:Session {id: $id})
			 SET s.ended_at = $endedAt, s.summary = $summary`,
			{
				id: event.session_id,
				endedAt: new Date(event.timestamp).getTime(),
				summary: event.summary,
			},
		);

		logger.info({ sessionId: event.session_id }, "Session ended");
	}
}

// =============================================================================
// Helpers
// =============================================================================

function categorizeToolType(toolName: string): string {
	const name = toolName.toLowerCase();

	if (name.includes("read") || name.includes("cat")) return "file_read";
	if (name.includes("write") || name.includes("edit")) return "file_write";
	if (name.includes("bash") || name.includes("exec")) return "bash_exec";
	if (name.includes("grep") || name.includes("search")) return "file_grep";
	if (name.includes("glob") || name.includes("find")) return "file_glob";
	if (name.includes("web") || name.includes("fetch")) return "web_fetch";
	if (name.includes("mcp")) return "mcp";

	return "unknown";
}

function mapClientToAgentType(
	client: string,
): "claude-code" | "codex" | "gemini-cli" | "opencode" | "aider" | "cursor" | "unknown" {
	const normalized = client.toLowerCase();

	if (normalized.includes("claude")) return "claude-code";
	if (normalized.includes("codex")) return "codex";
	if (normalized.includes("gemini")) return "gemini-cli";
	if (normalized.includes("opencode")) return "opencode";
	if (normalized.includes("aider")) return "aider";
	if (normalized.includes("cursor")) return "cursor";

	return "unknown";
}

function extractProject(workingDir?: string): string | undefined {
	if (!workingDir) return undefined;
	const parts = workingDir.split("/").filter(Boolean);
	return parts[parts.length - 1];
}
