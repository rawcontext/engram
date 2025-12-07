import { describe, expect, it, mock } from "bun:test";
import { Deduplicator } from "./deduplicator";

// Mock dependencies
mock.module("./text-embedder", () => {
    return {
        TextEmbedder: class {
            async embed(_text: string) { return [0.1, 0.2, 0.3]; }
        }
    };
});

mock.module("@qdrant/js-client-rest", () => {
    return {
        QdrantClient: class {
            constructor(_config: any) {}
            async search(_collection: string, params: any) {
                if (params.score_threshold && params.score_threshold > 0.9) {
                    // Simulate finding a duplicate if thresholds match logic
                    return [{ id: "existing-uuid", score: 0.96 }];
                }
                return [];
            }
        }
    };
});

describe("Deduplicator", () => {
    it("should return existing ID if duplicate found", async () => {
        const deduplicator = new Deduplicator();
        const result = await deduplicator.findDuplicate("some existing content");
        expect(result).toBe("existing-uuid");
    });
});
