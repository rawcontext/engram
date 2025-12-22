import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { ParsedStreamEventSchema, type RawStreamEvent, RawStreamEventSchema } from "@engram/events";
import { createNodeLogger, type Logger } from "@engram/logger";
import {
	DiffExtractor,
	defaultRegistry,
	Redactor,
	type StreamDelta,
	ThinkingExtractor,
} from "@engram/parser";
import { createNatsClient } from "@engram/storage";
import { createRedisPublisher } from "@engram/storage/redis";

/**
 * Dependencies for IngestionProcessor construction.
 * Supports dependency injection for testability.
 */
export interface IngestionProcessorDeps {
	/** NATS client for event streaming. */
	natsClient?: ReturnType<typeof createNatsClient>;
	/** Redactor for PII removal. */
	redactor?: Redactor;
	/** Logger instance. */
	logger?: Logger;
}

// In-memory state for extractors (per session) with TTL tracking
interface ExtractorEntry<T> {
	extractor: T;
	lastAccess: number;
}
export const thinkingExtractors = new Map<string, ExtractorEntry<ThinkingExtractor>>();
export const diffExtractors = new Map<string, ExtractorEntry<DiffExtractor>>();

// Session extractor TTL: 30 minutes of inactivity
export const EXTRACTOR_TTL_MS = 30 * 60 * 1000;

// Mutex for extractor cleanup to prevent race conditions
let cleanupInProgress = false;

/**
 * Clean up stale extractors to prevent memory leaks.
 * Runs periodically to remove extractors for inactive sessions.
 * Uses a mutex to prevent concurrent cleanup operations.
 */
export function cleanupStaleExtractors(): void {
	// Prevent concurrent cleanup operations
	if (cleanupInProgress) {
		return;
	}

	cleanupInProgress = true;
	try {
		const now = Date.now();
		// Collect session IDs to delete first to avoid iterator invalidation
		const thinkingToDelete: string[] = [];
		const diffToDelete: string[] = [];

		for (const [sessionId, entry] of thinkingExtractors) {
			if (now - entry.lastAccess > EXTRACTOR_TTL_MS) {
				thinkingToDelete.push(sessionId);
			}
		}
		for (const [sessionId, entry] of diffExtractors) {
			if (now - entry.lastAccess > EXTRACTOR_TTL_MS) {
				diffToDelete.push(sessionId);
			}
		}

		// Delete after iteration completes
		for (const sessionId of thinkingToDelete) {
			thinkingExtractors.delete(sessionId);
		}
		for (const sessionId of diffToDelete) {
			diffExtractors.delete(sessionId);
		}
	} finally {
		cleanupInProgress = false;
	}
}

// Clean up stale extractors every 5 minutes
const extractorCleanupInterval = setInterval(cleanupStaleExtractors, 5 * 60 * 1000);

export class IngestionProcessor {
	private natsClient: ReturnType<typeof createNatsClient>;
	private redactor: Redactor;
	private logger: Logger;

	/**
	 * Create an IngestionProcessor with injectable dependencies.
	 * @param deps - Optional dependencies. Defaults are used when not provided.
	 */
	constructor(deps?: IngestionProcessorDeps);
	/** @deprecated Use IngestionProcessorDeps object instead */
	constructor(natsClient: ReturnType<typeof createNatsClient>);
	constructor(depsOrNats?: IngestionProcessorDeps | ReturnType<typeof createNatsClient>) {
		if (depsOrNats === undefined) {
			// No args: use defaults
			this.natsClient = createNatsClient("ingestion-service");
			this.redactor = new Redactor();
			this.logger = createNodeLogger({
				service: "ingestion-service",
				base: { component: "processor" },
			});
		} else if (
			typeof depsOrNats === "object" &&
			("natsClient" in depsOrNats || "redactor" in depsOrNats || "logger" in depsOrNats)
		) {
			// New deps object constructor
			const deps = depsOrNats as IngestionProcessorDeps;
			this.natsClient = deps.natsClient ?? createNatsClient("ingestion-service");
			this.redactor = deps.redactor ?? new Redactor();
			this.logger =
				deps.logger ??
				createNodeLogger({
					service: "ingestion-service",
					base: { component: "processor" },
				});
		} else {
			// Legacy: natsClient directly (type assertion safe - if not deps, must be NatsClient)
			this.natsClient = depsOrNats as ReturnType<typeof createNatsClient>;
			this.redactor = new Redactor();
			this.logger = createNodeLogger({
				service: "ingestion-service",
				base: { component: "processor" },
			});
		}
	}

	async processEvent(rawEvent: RawStreamEvent) {
		const provider = rawEvent.provider;
		const headers = rawEvent.headers || {};
		const sessionId = headers["x-session-id"] || rawEvent.event_id;

		// Extract project context from headers
		const workingDir = headers["x-working-dir"] || null;
		const gitRemote = headers["x-git-remote"] || null;
		const agentType = headers["x-agent-type"] || "unknown";

		// 1. Parse using registry
		if (!defaultRegistry.has(provider)) {
			this.logger.warn({ provider, available: defaultRegistry.providers() }, "Unknown provider");
			return { status: "ignored" };
		}

		const delta: StreamDelta | null = defaultRegistry.parse(provider, rawEvent.payload);
		if (!delta) {
			return { status: "ignored" };
		}

		// 2. Extract Thinking
		if (delta.content) {
			const now = Date.now();
			let entry = thinkingExtractors.get(sessionId);
			if (!entry) {
				entry = { extractor: new ThinkingExtractor(), lastAccess: now };
				thinkingExtractors.set(sessionId, entry);
			} else {
				entry.lastAccess = now;
			}
			const extracted = entry.extractor.process(delta.content);
			delta.content = extracted.content;
			delta.thought = extracted.thought;
		}

		// 3. Extract Diffs
		if (delta.content) {
			const now = Date.now();
			let entry = diffExtractors.get(sessionId);
			if (!entry) {
				entry = { extractor: new DiffExtractor(), lastAccess: now };
				diffExtractors.set(sessionId, entry);
			} else {
				entry.lastAccess = now;
			}
			const extracted = entry.extractor.process(delta.content);
			delta.content = extracted.content;
			delta.diff = extracted.diff;
		}

		// 4. Redact
		if (delta.content) {
			delta.content = this.redactor.redact(delta.content);
		}
		if (delta.thought) {
			delta.thought = this.redactor.redact(delta.thought);
		}

		// 5. Map fields to ParsedStreamEvent schema
		// StreamDelta uses camelCase, ParsedStreamEvent uses snake_case
		const tool_call = delta.toolCall
			? {
					id: delta.toolCall.id || "",
					name: delta.toolCall.name || "",
					arguments_delta: delta.toolCall.args || "",
					index: delta.toolCall.index || 0,
				}
			: undefined;

		// Determine the event type
		// Override type if thought is present (ThinkingExtractor extracts but doesn't change type)
		let eventType = delta.type;
		if (delta.thought) {
			eventType = "thought";
		} else if (!eventType) {
			if (delta.toolCall) eventType = "tool_call";
			else if (delta.usage) eventType = "usage";
			else if (delta.content) eventType = "content";
		}

		// Extract file path from tool call arguments if present (for Edit tool calls with diffs)
		let diffFile: string | undefined;
		if (delta.diff && delta.toolCall?.args) {
			try {
				const args = JSON.parse(delta.toolCall.args);
				diffFile = args.file_path || args.path || args.filename;
			} catch {
				// JSON parse failed or incomplete, ignore
			}
		}

		// Build metadata object with session context and provider-specific metadata
		const metadata: Record<string, unknown> = {
			session_id: sessionId,
			working_dir: workingDir,
			git_remote: gitRemote,
			agent_type: agentType,
		};

		// Preserve provider-specific metadata (cost, timing, model, stopReason, cache metrics)
		if (delta.cost !== undefined) {
			metadata.cost_usd = delta.cost;
		}
		if (delta.timing) {
			if (delta.timing.duration !== undefined) metadata.duration_ms = delta.timing.duration;
			if (delta.timing.start !== undefined) metadata.timing_start = delta.timing.start;
			if (delta.timing.end !== undefined) metadata.timing_end = delta.timing.end;
		}
		if (delta.model) {
			metadata.model = delta.model;
		}
		if (delta.stopReason) {
			metadata.stop_reason = delta.stopReason;
		}
		if (delta.session) {
			if (delta.session.id) metadata.provider_session_id = delta.session.id;
			if (delta.session.messageId) metadata.message_id = delta.session.messageId;
			if (delta.session.partId) metadata.part_id = delta.session.partId;
			if (delta.session.threadId) metadata.thread_id = delta.session.threadId;
		}
		if (delta.gitSnapshot) {
			metadata.git_snapshot = delta.gitSnapshot;
		}

		// Extend usage object with cache metrics
		const extendedUsage = delta.usage
			? {
					input_tokens: delta.usage.input || 0,
					output_tokens: delta.usage.output || 0,
					cache_read_tokens: delta.usage.cacheRead,
					cache_write_tokens: delta.usage.cacheWrite,
					reasoning_tokens: delta.usage.reasoning,
					total_tokens: delta.usage.total,
				}
			: undefined;

		// 6. Construct and validate ParsedStreamEvent
		const parsedEvent = {
			event_id: randomUUID(), // Generate unique event_id
			type: eventType,
			role: delta.role,
			content: delta.content,
			thought: delta.thought,
			diff: delta.diff ? { file: diffFile, hunk: delta.diff } : undefined,
			tool_call,
			usage: extendedUsage,
			original_event_id: rawEvent.event_id,
			timestamp: rawEvent.ingest_timestamp,
			metadata,
		};

		// Validate against schema before publishing
		const validatedEvent = ParsedStreamEventSchema.parse(parsedEvent);

		// 7. Publish validated event
		await this.natsClient.sendEvent("parsed_events", sessionId, validatedEvent);

		this.logger.info(
			{ eventId: validatedEvent.event_id, originalEventId: rawEvent.event_id, sessionId },
			"Processed and published event",
		);
		return { status: "processed" };
	}
}

/**
 * Factory function for creating IngestionProcessor instances.
 * Supports dependency injection for testability.
 *
 * @example
 * // Production usage (uses defaults)
 * const processor = createIngestionProcessor();
 *
 * @example
 * // Test usage (inject mocks)
 * const processor = createIngestionProcessor({
 *   natsClient: mockNats,
 *   redactor: mockRedactor,
 * });
 */
export function createIngestionProcessor(deps?: IngestionProcessorDeps): IngestionProcessor {
	return new IngestionProcessor(deps);
}

// Initialize main logger and processor
const logger = createNodeLogger({
	service: "ingestion-service",
	base: { component: "main" },
});
const nats = createNatsClient("ingestion-service");
const processor = createIngestionProcessor({ natsClient: nats, logger });
export const processEvent = processor.processEvent.bind(processor);

/**
 * Start NATS consumer for processing raw events.
 * Exported for testing purposes.
 */
/* v8 ignore start */
export async function startConsumer() {
	const consumer = await nats.getConsumer({ groupId: "ingestion-group" });
	await consumer.subscribe({ topic: "raw_events", fromBeginning: false });

	// Publish consumer ready status to Redis
	const redis = createRedisPublisher();
	await redis.publishConsumerStatus("consumer_ready", "ingestion-group", "ingestion-service");
	logger.info("Published consumer_ready status for ingestion-group");

	// Periodic heartbeat every 10 seconds
	const heartbeatInterval = setInterval(async () => {
		try {
			await redis.publishConsumerStatus(
				"consumer_heartbeat",
				"ingestion-group",
				"ingestion-service",
			);
		} catch (e) {
			logger.error({ err: e }, "Failed to publish heartbeat");
		}
	}, 10000);

	// Graceful shutdown handler
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down gracefully...");
		clearInterval(heartbeatInterval);
		clearInterval(extractorCleanupInterval); // Clear extractor cleanup timer
		try {
			await consumer.disconnect();
			logger.info("NATS consumer disconnected");
		} catch (e) {
			logger.error({ err: e }, "Error disconnecting consumer");
		}
		await redis.publishConsumerStatus(
			"consumer_disconnected",
			"ingestion-group",
			"ingestion-service",
		);
		await redis.disconnect();
		logger.info("Redis publisher disconnected");
		process.exit(0);
	};

	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGINT", () => shutdown("SIGINT"));

	await consumer.run({
		eachMessage: async ({ message }) => {
			const value = message.value?.toString();
			if (!value) return;

			let rawBody: unknown;
			try {
				rawBody = JSON.parse(value);
				const rawEvent = RawStreamEventSchema.parse(rawBody);
				await processEvent(rawEvent);
			} catch (e) {
				const errorMessage = e instanceof Error ? e.message : String(e);
				logger.error({ err: e }, "NATS Consumer Error");

				// Send to Dead Letter Queue for later analysis/retry
				try {
					const eventId =
						rawBody &&
						typeof rawBody === "object" &&
						!Array.isArray(rawBody) &&
						"event_id" in rawBody &&
						typeof rawBody.event_id === "string"
							? rawBody.event_id
							: `unknown-${Date.now()}`;

					await nats.sendEvent("ingestion.dead_letter", eventId, {
						error: errorMessage,
						payload: rawBody ?? value, // Use raw string if JSON parsing failed
						timestamp: new Date().toISOString(),
						source: "nats_consumer",
					});
					logger.warn({ eventId }, "Sent failed message to DLQ");
				} catch (dlqError) {
					logger.error({ err: dlqError }, "Failed to send to DLQ");
				}
			}
		},
	});
	logger.info("Ingestion Service NATS Consumer started");
}
/* v8 ignore stop */

/**
 * Create and configure the HTTP server.
 * Exported for testing purposes.
 */
export function createIngestionServer(port = 5001, maxBodySize = 50 * 1024 * 1024) {
	const server = createServer(async (req, res) => {
		const url = new URL(req.url || "", `http://localhost:${port}`);

		if (url.pathname === "/health") {
			res.writeHead(200);
			res.end("OK");
			return;
		}

		if (url.pathname === "/ingest" && req.method === "POST") {
			let rawBody: unknown;
			let body = "";
			let bodySize = 0;

			req.on("error", (err) => {
				logger.error({ err }, "Request stream error");
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Request stream error" }));
				}
			});

			let aborted = false;
			req.on("data", (chunk) => {
				bodySize += chunk.length;
				if (bodySize > maxBodySize && !aborted) {
					aborted = true;
					req.destroy();
					res.writeHead(413, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Request body too large" }));
					return;
				}
				if (!aborted) {
					body += chunk.toString();
				}
			});

			req.on("end", async () => {
				// Abort if body was too large (response already sent)
				if (aborted) return;
				try {
					rawBody = JSON.parse(body);
					const rawEvent = RawStreamEventSchema.parse(rawBody);

					await processEvent(rawEvent);

					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ status: "processed" }));
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : String(e);
					logger.error({ err: e }, "Ingestion Error");

					// DLQ Logic
					try {
						const dlqKey =
							rawBody &&
							typeof rawBody === "object" &&
							!Array.isArray(rawBody) &&
							"event_id" in rawBody &&
							typeof rawBody.event_id === "string"
								? rawBody.event_id
								: "unknown";

						await nats.sendEvent("ingestion.dead_letter", dlqKey, {
							error: message,
							payload: rawBody,
							timestamp: new Date().toISOString(),
						});
					} catch (dlqError) {
						logger.error({ err: dlqError }, "Failed to send to DLQ");
					}

					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: message }));
				}
			});
			return;
		}

		res.writeHead(404);
		res.end("Not Found");
	});

	return server;
}

// Only start server and consumer if running as main module (not imported for testing)
/* v8 ignore start */
const isMainModule =
	import.meta.url === `file://${process.argv[1]}` || process.env.NODE_ENV === "production";
if (isMainModule) {
	// Start Consumer
	startConsumer().catch((err) => logger.error({ err }, "Consumer startup failed"));

	// Start HTTP Server
	const PORT = 5001;
	const server = createIngestionServer(PORT);
	server.listen(PORT, () => {
		logger.info({ port: PORT }, "Ingestion Service running");
	});
}
/* v8 ignore stop */
