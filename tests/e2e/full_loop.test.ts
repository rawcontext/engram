import { describe, expect, it } from "bun:test";
import { RawStreamEventSchema } from "@engram/events";
import { createNatsClient } from "@engram/storage";

// Skip E2E tests when infrastructure isn't running
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === "true" || process.env.CI === "true";

const nats = SKIP_INTEGRATION ? null : createNatsClient("e2e-test");

describe.skipIf(SKIP_INTEGRATION)("E2E Full Loop", () => {
	it("should ingest and process event end-to-end", async () => {
		const sessionId = crypto.randomUUID();
		const eventId = crypto.randomUUID();

		console.log(`\n--- Starting E2E Loop Test ---`);
		console.log(`Session ID: ${sessionId}`);
		console.log(`Event ID: ${eventId}`);

		const producer = await nats.getProducer();

		// Simulate an OpenAI chunk event
		const event = {
			event_id: eventId,
			ingest_timestamp: new Date().toISOString(),
			provider: "openai",
			payload: {
				id: "evt_123",
				object: "chat.completion.chunk",
				created: Math.floor(Date.now() / 1000),
				model: "gpt-4",
				choices: [
					{
						index: 0,
						delta: { content: "Hello E2E World" },
						finish_reason: null,
					},
				],
			},
			headers: {
				"x-session-id": sessionId,
			},
		};

		// Validate
		const parsed = RawStreamEventSchema.parse(event);

		// 1. Send to NATS
		console.log("1. Sending event to 'raw_events'...");
		await producer.send({
			topic: "raw_events",
			messages: [{ key: eventId, value: JSON.stringify(parsed) }],
		});
		console.log("   Sent.");

		// 2. Poll API
		console.log("2. Polling /api/replay...");
		const maxRetries = 20;
		let found = false;

		for (let i = 0; i < maxRetries; i++) {
			try {
				// Assuming interface runs on port 5000
				const res = await fetch(`http://localhost:5000/api/replay/${sessionId}`);
				if (res.ok) {
					const json = await res.json();
					if (json.data?.timeline?.length > 0) {
						console.log("\n   SUCCESS! Found timeline entries.");
						found = true;
						break;
					}
				}
			} catch (_e) {
				// ignore fetch errors (service might be starting or network glitch)
			}
			await new Promise((r) => setTimeout(r, 1000));
			process.stdout.write(".");
		}

		if (!found) {
			console.error("\nFAILED: Timeout waiting for event to appear in graph.");
		}

		expect(found).toBe(true);
	}, 30000);
});
