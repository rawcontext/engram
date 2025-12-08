import { describe, expect, it, mock } from "bun:test";
import { IngestionProcessor } from "./index";

// Mock Kafka Client
const mockSendEvent = mock(async () => {});
const mockKafkaClient = {
	sendEvent: mockSendEvent,
};

describe("Ingestion Service", () => {
	it("should process event and publish parsed event", async () => {
		const processor = new IngestionProcessor(mockKafkaClient);

		const event = {
			event_id: "123",
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

		await processor.processEvent(event as any);

		expect(mockSendEvent).toHaveBeenCalled();
		const call = mockSendEvent.mock.calls[0];
		expect(call[0]).toBe("parsed_events");
		const parsed = call[2] as any;
		expect(parsed.content).toBe("Hello");
		expect(parsed.original_event_id).toBe("123");
	});
});
