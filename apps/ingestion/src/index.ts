import { RawStreamEventSchema } from "@the-soul/events";
import {
  AnthropicParser,
  DiffExtractor,
  OpenAIParser,
  Redactor,
  type StreamDelta,
  ThinkingExtractor,
} from "@the-soul/ingestion-core";
import { createKafkaClient } from "@the-soul/storage";

const kafka = createKafkaClient("ingestion-service");
const redactor = new Redactor();
const anthropicParser = new AnthropicParser();
const openaiParser = new OpenAIParser();

// In-memory state for extractors (per session)
const thinkingExtractors = new Map<string, ThinkingExtractor>();
const diffExtractors = new Map<string, DiffExtractor>();

// Simple Bun Server
const server = Bun.serve({
  port: 8080,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") return new Response("OK");

    if (url.pathname === "/ingest" && req.method === "POST") {
      // Use unknown first to satisfy Biome
      let rawBody: unknown;
      try {
        rawBody = await req.json();
        const rawEvent = RawStreamEventSchema.parse(rawBody);
        const provider = rawEvent.provider;
        const sessionId = rawEvent.headers?.["x-session-id"] || rawEvent.event_id;

        // 1. Parse
        let delta: StreamDelta | null = null;
        if (provider === "anthropic") {
          delta = anthropicParser.parse(rawEvent.payload);
        } else if (provider === "openai") {
          delta = openaiParser.parse(rawEvent.payload);
        }

        if (!delta) {
          return new Response("Ignored event (no delta)", { status: 200 });
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

        // 5. Publish
        await kafka.sendEvent("parsed_events", sessionId, {
          ...delta,
          original_event_id: rawEvent.event_id,
          timestamp: rawEvent.ingest_timestamp,
        });

        return new Response(JSON.stringify({ status: "processed" }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e: unknown) {
        console.error("Ingestion Error:", e);
        const message = e instanceof Error ? e.message : String(e);

        // DLQ Logic
        try {
          // Check if rawBody has event_id safely
          const body = rawBody as Record<string, unknown>;
          const dlqKey = (body?.event_id as string) || "unknown";

          await kafka.sendEvent("ingestion.dead_letter", dlqKey, {
            error: message,
            payload: rawBody,
            timestamp: new Date().toISOString(),
          });
        } catch (dlqError) {
          console.error("Failed to send to DLQ:", dlqError);
        }

        return new Response(JSON.stringify({ error: message }), { status: 400 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Ingestion Service running on port ${server.port}`);
