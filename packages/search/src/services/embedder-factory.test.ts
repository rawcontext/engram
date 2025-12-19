import { describe, expect, it } from "vitest";
import {
	ConfigurableTextEmbedder,
	createEmbedder,
	getModelConfig,
	listModels,
	MODEL_CONFIGS,
} from "./embedder-factory";

describe("EmbedderFactory", () => {
	describe("MODEL_CONFIGS", () => {
		it("should have configurations for all supported models", () => {
			const models = [
				"e5-small",
				"e5-base",
				"e5-large",
				"gte-base",
				"gte-large",
				"bge-small",
				"bge-base",
				"bge-large",
			];

			for (const model of models) {
				expect(MODEL_CONFIGS[model as keyof typeof MODEL_CONFIGS]).toBeDefined();
			}
		});

		it("should have correct dimensions for each model family", () => {
			// E5 family
			expect(MODEL_CONFIGS["e5-small"].dimensions).toBe(384);
			expect(MODEL_CONFIGS["e5-base"].dimensions).toBe(768);
			expect(MODEL_CONFIGS["e5-large"].dimensions).toBe(1024);

			// GTE family
			expect(MODEL_CONFIGS["gte-base"].dimensions).toBe(768);
			expect(MODEL_CONFIGS["gte-large"].dimensions).toBe(1024);

			// BGE family
			expect(MODEL_CONFIGS["bge-small"].dimensions).toBe(384);
			expect(MODEL_CONFIGS["bge-base"].dimensions).toBe(768);
			expect(MODEL_CONFIGS["bge-large"].dimensions).toBe(1024);
		});

		it("should have query/passage prefixes for E5 models", () => {
			expect(MODEL_CONFIGS["e5-small"].queryPrefix).toBe("query:");
			expect(MODEL_CONFIGS["e5-small"].passagePrefix).toBe("passage:");
		});

		it("should have empty prefixes for GTE models", () => {
			expect(MODEL_CONFIGS["gte-large"].queryPrefix).toBe("");
			expect(MODEL_CONFIGS["gte-large"].passagePrefix).toBe("");
		});

		it("should have instruction prefix for BGE models", () => {
			expect(MODEL_CONFIGS["bge-large"].queryPrefix).toContain("Represent this sentence");
		});
	});

	describe("getModelConfig", () => {
		it("should return config for valid model", () => {
			const config = getModelConfig("gte-large");

			expect(config.dimensions).toBe(1024);
			expect(config.hfModel).toBe("Xenova/gte-large");
		});

		it("should throw for unknown model", () => {
			expect(() => getModelConfig("unknown-model" as any)).toThrow("Unknown model");
		});
	});

	describe("listModels", () => {
		it("should return all supported models", () => {
			const models = listModels();

			expect(models).toContain("e5-small");
			expect(models).toContain("gte-large");
			expect(models).toContain("bge-base");
			expect(models.length).toBe(8);
		});
	});

	describe("createEmbedder", () => {
		it("should create embedder with correct dimensions", () => {
			const embedder = createEmbedder({ model: "gte-large" });

			expect(embedder.dimensions).toBe(1024);
		});

		it("should create embedder without sparse by default", () => {
			const embedder = createEmbedder({ model: "e5-small" });

			expect(embedder.hasSparse()).toBe(false);
		});

		it("should create embedder with sparse when requested", () => {
			const embedder = createEmbedder({ model: "e5-small", sparse: true });

			expect(embedder.hasSparse()).toBe(true);
		});

		it("should throw for unknown model", () => {
			expect(() => createEmbedder({ model: "unknown" as any })).toThrow("Unknown model");
		});
	});

	describe("ConfigurableTextEmbedder", () => {
		it("should expose model name", () => {
			const embedder = new ConfigurableTextEmbedder({ model: "gte-large" });

			expect(embedder.modelName).toBe("Xenova/gte-large");
		});

		it("should throw when accessing sparse without enabling", async () => {
			const embedder = new ConfigurableTextEmbedder({ model: "e5-small" });

			await expect(embedder.embedSparse("test")).rejects.toThrow("Sparse embeddings not enabled");
		});

		// Note: Actual embedding tests would require mocking the transformers pipeline
		// These tests focus on configuration and factory logic
	});
});
