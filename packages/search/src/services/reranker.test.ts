import { describe, expect, it, vi } from "vitest";
import { Reranker } from "./reranker";

const { mockPipeline } = vi.hoisted(() => {
	const mockPipeline = vi.fn(async (_task: string, _model: string) => {
		return async (input: any) => {
			// Mock scoring logic: if text_pair contains "relevant", give high score
			const doc = input.text_pair;
			if (doc.includes("relevant")) {
				return [{ label: "LABEL_1", score: 0.9 }];
			}
			return [{ label: "LABEL_0", score: 0.1 }];
		};
	});
	return { mockPipeline };
});

vi.mock("@huggingface/transformers", () => ({
	pipeline: mockPipeline,
}));

describe("Reranker", () => {
	it("should rerank documents", async () => {
		const reranker = new Reranker();
		const query = "find relevant";
		const docs = ["bad doc", "very relevant doc", "another doc"];

		const results = await reranker.rerank(query, docs, 2);

		expect(mockPipeline).toHaveBeenCalledWith(
			"text-classification",
			"Xenova/bge-reranker-base",
			expect.any(Object),
		);

		expect(results).toHaveLength(2);
		expect(results[0].document).toBe("very relevant doc");
		expect(results[0].score).toBe(0.9);
	});
});
