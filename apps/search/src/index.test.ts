import { describe, expect, it, vi } from "vitest";

/**
 * These tests require Kafka infrastructure running.
 * The SearchService import triggers Kafka connections.
 * Set RUN_INTEGRATION_TESTS=1 to enable them.
 */
const RUN_INTEGRATION_TESTS = process.env.RUN_INTEGRATION_TESTS === "1";

// Only import if running integration tests to avoid Kafka connection errors
const SearchService = RUN_INTEGRATION_TESTS ? (await import("./index")).SearchService : null;

// Mocks
const mockSearch = vi.fn(async () => [{ id: "1", score: 0.9 }]);
const mockRetriever = { search: mockSearch };
const mockIndexer = { indexNode: vi.fn(async () => {}) };
const mockSchemaManager = { ensureCollection: vi.fn(async () => {}) };
const mockKafka = {
	createConsumer: vi.fn(async () => ({
		subscribe: vi.fn(async () => {}),
		run: vi.fn(async () => {}),
	})),
};

describe.skipIf(!RUN_INTEGRATION_TESTS)("Search Service", () => {
	it("should handle search request", async () => {
		const service = new SearchService(
			mockRetriever as any,
			mockIndexer as any,
			mockSchemaManager as any,
			mockKafka as any,
		);

		const req = new Request("http://localhost/search", {
			method: "POST",
			body: JSON.stringify({ text: "test" }),
		});

		const res = await service.handleRequest(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data).toHaveLength(1);
		expect(data[0].id).toBe("1");
		expect(mockSearch).toHaveBeenCalled();
	});

	it("should handle health check", async () => {
		const service = new SearchService({} as any, {} as any, {} as any, {} as any);
		const req = new Request("http://localhost/health");
		const res = await service.handleRequest(req);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("OK");
	});
});
