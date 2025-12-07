import { createKafkaClient } from "@the-soul/storage";
import {
  detectProtocol,
  Redactor,
  AnthropicParser,
  OpenAIParser,
  StreamDelta,
} from "@the-soul/ingestion-core";
import { RawStreamEventSchema } from "@the-soul/events";
import { z } from "zod";

const kafka = createKafkaClient("ingestion-service");
const redactor = new Redactor();
const anthropicParser = new AnthropicParser();
const openaiParser = new OpenAIParser();

// Simple Bun Server
const server = Bun.serve({
  port: 8080,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") return new Response("OK");

    if (url.pathname === "/ingest" && req.method === "POST") {
      try {
        const body = await req.json();
        // Validate Raw Event
        const rawEvent = RawStreamEventSchema.parse(body);

        // 1. Protocol Detection (if not provided in rawEvent, but schema requires it.
        // We assume the 'provider' field is set by the gateway or we detect from payload if generic)
        // If provider is set, we use it.
        const provider = rawEvent.provider;

        // 2. Parse
        let delta: StreamDelta | null = null;
        if (provider === "anthropic") {
          delta = anthropicParser.parse(rawEvent.payload);
        } else if (provider === "openai") {
          delta = openaiParser.parse(rawEvent.payload);
        }

        if (!delta) {
          return new Response("Ignored event (no delta)", { status: 200 });
        }

        // 3. Redact
        if (delta.content) {
          delta.content = redactor.redact(delta.content);
        }
        // Also redact tool args if necessary

        // 4. Publish to Redpanda
        // Topic: parsed_events
        // Key: session_id (need to extract from metadata or payload? RawEvent doesn't enforce session_id in root)
        // We assume session_id is in metadata or trace_id.
        // For now, use event_id as key if session unknown (random partition).
        const sessionId =
          (rawEvent.headers && rawEvent.headers["x-session-id"]) || rawEvent.event_id;

        await kafka.sendEvent("parsed_events", sessionId, {
          ...delta,
          original_event_id: rawEvent.event_id,
          timestamp: rawEvent.ingest_timestamp,
        });

        return new Response(JSON.stringify({ status: "processed" }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e: any) {
        console.error(e);
        return new Response(JSON.stringify({ error: e.message }), { status: 400 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Ingestion Service running on port ${server.port}`);
