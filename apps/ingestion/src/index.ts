import { createServer } from "node:http";
import { type RawStreamEvent, RawStreamEventSchema } from "@engram/events";
import { createNodeLogger, type Logger } from "@engram/logger";
import {
	DiffExtractor,
	defaultRegistry,
	Redactor,
	type StreamDelta,
	ThinkingExtractor,
} from "@engram/parser";
import { createKafkaClient } from "@engram/storage";
import { createRedisPublisher } from "@engram/storage/redis";

/**
 * Dependencies for IngestionProcessor construction.
 * Supports dependency injection for testability.
 */
export interface IngestionProcessorDeps {
	/** Kafka client for event streaming. */
	kafkaClient?: ReturnType<typeof createKafkaClient>;
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
const thinkingExtractors = new Map<string, ExtractorEntry<ThinkingExtractor>>();
const diffExtractors = new Map<string, ExtractorEntry<DiffExtractor>>();

// Session extractor TTL: 30 minutes of inactivity
const EXTRACTOR_TTL_MS = 30 * 60 * 1000;

/**
 * Clean up stale extractors to prevent memory leaks.
 * Runs periodically to remove extractors for inactive sessions.
 */
function cleanupStaleExtractors(): void {
	const now = Date.now();
	for (const [sessionId, entry] of thinkingExtractors) {
		if (now - entry.lastAccess > EXTRACTOR_TTL_MS) {
			thinkingExtractors.delete(sessionId);
		}
	}
	for (const [sessionId, entry] of diffExtractors) {
		if (now - entry.lastAccess > EXTRACTOR_TTL_MS) {
			diffExtractors.delete(sessionId);
		}
	}
}

// Clean up stale extractors every 5 minutes
const extractorCleanupInterval = setInterval(cleanupStaleExtractors, 5 * 60 * 1000);

export class IngestionProcessor {
	private kafkaClient: ReturnType<typeof createKafkaClient>;
	private redactor: Redactor;
	private logger: Logger;

	/**
	 * Create an IngestionProcessor with injectable dependencies.
	 * @param deps - Optional dependencies. Defaults are used when not provided.
	 */
	constructor(deps?: IngestionProcessorDeps);
	/** @deprecated Use IngestionProcessorDeps object instead */
	constructor(kafkaClient: ReturnType<typeof createKafkaClient>);
	constructor(depsOrKafka?: IngestionProcessorDeps | ReturnType<typeof createKafkaClient>) {
		if (depsOrKafka === undefined) {
			// No args: use defaults
			this.kafkaClient = createKafkaClient("ingestion-service");
			this.redactor = new Redactor();
			this.logger = createNodeLogger({
				service: "ingestion-service",
				base: { component: "processor" },
			});
		} else if (
			typeof depsOrKafka === "object" &&
			("kafkaClient" in depsOrKafka || "redactor" in depsOrKafka || "logger" in depsOrKafka)
		) {
			// New deps object constructor
			const deps = depsOrKafka as IngestionProcessorDeps;
			this.kafkaClient = deps.kafkaClient ?? createKafkaClient("ingestion-service");
			this.redactor = deps.redactor ?? new Redactor();
			this.logger =
				deps.logger ??
				createNodeLogger({
					service: "ingestion-service",
					base: { component: "processor" },
				});
		} else {
			// Legacy: kafkaClient directly (type assertion safe - if not deps, must be KafkaClient)
			this.kafkaClient = depsOrKafka as ReturnType<typeof createKafkaClient>;
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

		const usage = delta.usage
			? {
					input_tokens: delta.usage.input || 0,
					output_tokens: delta.usage.output || 0,
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

		// 6. Publish
		await this.kafkaClient.sendEvent("parsed_events", sessionId, {
			type: eventType,
			role: delta.role,
			content: delta.content,
			thought: delta.thought,
			diff: delta.diff ? { file: undefined, hunk: delta.diff } : undefined,
			tool_call,
			usage,
			original_event_id: rawEvent.event_id,
			timestamp: rawEvent.ingest_timestamp,
			metadata: {
				session_id: sessionId,
				working_dir: workingDir,
				git_remote: gitRemote,
				agent_type: agentType,
			},
		});

		this.logger.info({ eventId: rawEvent.event_id, sessionId }, "Processed event");
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
 *   kafkaClient: mockKafka,
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
const kafka = createKafkaClient("ingestion-service");
const processor = createIngestionProcessor({ kafkaClient: kafka, logger });
export const processEvent = processor.processEvent.bind(processor);

// Kafka Consumer
async function startConsumer() {
	const consumer = await kafka.createConsumer("ingestion-group");
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
			logger.info("Kafka consumer disconnected");
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
				logger.error({ err: e }, "Kafka Consumer Error");

				// Send to Dead Letter Queue for later analysis/retry
				try {
					const eventId =
						rawBody && typeof rawBody === "object" && "event_id" in rawBody
							? String((rawBody as Record<string, unknown>).event_id)
							: `unknown-${Date.now()}`;

					await kafka.sendEvent("ingestion.dead_letter", eventId, {
						error: errorMessage,
						payload: rawBody ?? value, // Use raw string if JSON parsing failed
						timestamp: new Date().toISOString(),
						source: "kafka_consumer",
					});
					logger.warn({ eventId }, "Sent failed message to DLQ");
				} catch (dlqError) {
					logger.error({ err: dlqError }, "Failed to send to DLQ");
				}
			}
		},
	});
	logger.info("Ingestion Service Kafka Consumer started");
}

// Start Consumer
startConsumer().catch((err) => logger.error({ err }, "Consumer startup failed"));

// Simple HTTP Server (Node.js compatible)
const PORT = 5001;
// 50MB limit: LLM context windows are 200k+ tokens (~800KB text), plus JSON overhead
// and full conversation histories can be several megabytes
const MAX_BODY_SIZE = 50 * 1024 * 1024;

const server = createServer(async (req, res) => {
	const url = new URL(req.url || "", `http://localhost:${PORT}`);

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

		req.on("data", (chunk) => {
			bodySize += chunk.length;
			if (bodySize > MAX_BODY_SIZE) {
				req.destroy();
				res.writeHead(413, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Request body too large" }));
				return;
			}
			body += chunk.toString();
		});

		req.on("end", async () => {
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
					const bodyObj = rawBody as Record<string, unknown>;
					const dlqKey = (bodyObj?.event_id as string) || "unknown";

					await kafka.sendEvent("ingestion.dead_letter", dlqKey, {
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

server.listen(PORT, () => {
	logger.info({ port: PORT }, "Ingestion Service running");
});
