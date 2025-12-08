import { describe, expect, it, mock } from "bun:test";
import { SearchService } from "./index";

// Mocks
const mockSearch = mock(async () => [{ id: "1", score: 0.9 }]);
const mockRetriever = { search: mockSearch };
const mockIndexer = { indexNode: mock(async () => {}) };
const mockSchemaManager = { ensureCollection: mock(async () => {}) };
const mockKafka = {
	createConsumer: mock(async () => ({
		subscribe: mock(async () => {}),
		run: mock(async () => {}),
	})),
};

describe("Search Service", () => {
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
