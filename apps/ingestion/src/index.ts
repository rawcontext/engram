import { createServer } from "node:http";
import { type RawStreamEvent, RawStreamEventSchema } from "@engram/events";
import {
	AnthropicParser,
	ClaudeCodeParser,
	CodexParser,
	DiffExtractor,
	GeminiParser,
	OpenAIParser,
	OpenCodeParser,
	Redactor,
	type StreamDelta,
	ThinkingExtractor,
	XAIParser,
} from "@engram/ingestion-core";
import { createKafkaClient } from "@engram/storage";

const kafka = createKafkaClient("ingestion-service");
const redactor = new Redactor();
const anthropicParser = new AnthropicParser();
const openaiParser = new OpenAIParser();
const xaiParser = new XAIParser();
const claudeCodeParser = new ClaudeCodeParser();
const codexParser = new CodexParser();
const geminiParser = new GeminiParser();
const opencodeParser = new OpenCodeParser();

// In-memory state for extractors (per session)
const thinkingExtractors = new Map<string, ThinkingExtractor>();
const diffExtractors = new Map<string, DiffExtractor>();

export class IngestionProcessor {
	constructor(private kafkaClient: any = kafka) {}

	async processEvent(rawEvent: RawStreamEvent) {
		const provider = rawEvent.provider;
		const headers = rawEvent.headers || {};
		const sessionId = headers["x-session-id"] || rawEvent.event_id;

		// Extract project context from headers
		const workingDir = headers["x-working-dir"] || null;
		const gitRemote = headers["x-git-remote"] || null;
		const agentType = headers["x-agent-type"] || "unknown";

		// 1. Parse
		let delta: StreamDelta | null = null;
		if (provider === "anthropic") {
			delta = anthropicParser.parse(rawEvent.payload);
		} else if (provider === "openai") {
			delta = openaiParser.parse(rawEvent.payload);
		} else if (provider === "xai") {
			delta = xaiParser.parse(rawEvent.payload);
		} else if (provider === "claude_code") {
			delta = claudeCodeParser.parse(rawEvent.payload);
		} else if (provider === "codex") {
			delta = codexParser.parse(rawEvent.payload);
		} else if (provider === "gemini") {
			delta = geminiParser.parse(rawEvent.payload);
		} else if (provider === "opencode") {
			delta = opencodeParser.parse(rawEvent.payload);
		}

		if (!delta) {
			return { status: "ignored" };
		}

		// 2. Extract Thinking
		if (delta.content) {
			let extractor = thinkingExtractors.get(sessionId);
			if (!extractor) {
				extractor = new ThinkingExtractor();
				thinkingExtractors.set(sessionId, extractor);
			}
			const extracted = extractor.process(delta.content);
			delta.content = extracted.content;
			delta.thought = extracted.thought;
		}

		// 3. Extract Diffs
		if (delta.content) {
			let diffExtractor = diffExtractors.get(sessionId);
			if (!diffExtractor) {
				diffExtractor = new DiffExtractor();
				diffExtractors.set(sessionId, diffExtractor);
			}
			const extracted = diffExtractor.process(delta.content);
			delta.content = extracted.content;
			delta.diff = extracted.diff;
		}

		// 4. Redact
		if (delta.content) {
			delta.content = redactor.redact(delta.content);
		}
		if (delta.thought) {
			delta.thought = redactor.redact(delta.thought);
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

		console.log(`[Ingest] Processed event ${rawEvent.event_id} for session ${sessionId}`);
		return { status: "processed" };
	}
}

const processor = new IngestionProcessor();
export const processEvent = processor.processEvent.bind(processor);

// Kafka Consumer
async function startConsumer() {
	const consumer = await kafka.createConsumer("ingestion-group");
	await consumer.subscribe({ topic: "raw_events", fromBeginning: false });

	await consumer.run({
		eachMessage: async ({ message }) => {
			const value = message.value?.toString();
			if (!value) return;

			try {
				const rawBody = JSON.parse(value);
				const rawEvent = RawStreamEventSchema.parse(rawBody);
				await processEvent(rawEvent);
			} catch (e) {
				console.error("Kafka Consumer Error:", e);
				// DLQ logic is tricky here without rawBody access sometimes,
				// but we can try best effort if JSON.parse worked.
			}
		},
	});
	console.log("Ingestion Service Kafka Consumer started");
}

// Start Consumer
startConsumer().catch(console.error);

// Simple HTTP Server (Node.js compatible)
const PORT = 5001;

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

		req.on("data", (chunk) => {
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
				console.error("Ingestion Error:", message);

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
					console.error("Failed to send to DLQ:", dlqError);
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
	console.log(`Ingestion Service running on port ${PORT}`);
});
