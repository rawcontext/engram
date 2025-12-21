import { describe, expect, it, vi } from "vitest";
import { IngestionProcessor } from "./index";

// Mock Kafka Client
const mockSendEvent = vi.fn(async () => {});
const mockKafkaClient = {
	sendEvent: mockSendEvent,
};

describe("Ingestion Service", () => {
	it("should process event and publish parsed event", async () => {
		const processor = new IngestionProcessor(mockKafkaClient);

		const eventId = "550e8400-e29b-41d4-a716-446655440000";
		const event = {
			event_id: eventId,
			ingest_timestamp: new Date().toISOString(),
			provider: "openai" as const,
			payload: {
				id: "evt_123",
				object: "chat.completion.chunk",
				created: 123,
				model: "gpt-4",
				choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
			},
		};

		await processor.processEvent(event as Parameters<typeof processor.processEvent>[0]);

		expect(mockSendEvent).toHaveBeenCalled();
		const call = mockSendEvent.mock.calls[0];
		expect(call[0]).toBe("parsed_events");
		const parsed = call[2] as { content: string; original_event_id: string };
		expect(parsed.content).toBe("Hello");
		expect(parsed.original_event_id).toBe(eventId);
	});
});
