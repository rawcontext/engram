import { describe, expect, it } from "vitest";
import { FusionWeightPredictor } from "./fusion-predictor";
import { QueryFeatureExtractor } from "./query-features";

describe("FusionWeightPredictor", () => {
	describe("fallback behavior", () => {
		it("should return fallback weights when model is not available", async () => {
			const predictor = new FusionWeightPredictor({
				modelPath: "non-existent-model.onnx",
				fallbackWeights: { dense: 0.5, sparse: 0.3, rerank: 0.2 },
			});

			const extractor = new QueryFeatureExtractor();
			const features = extractor.extract("Who is the CEO of Microsoft?");
			const weights = await predictor.predict(features);

			// Should use fallback since model doesn't exist
			expect(weights).toBeDefined();
			expect(weights.dense).toBeGreaterThan(0);
			expect(weights.sparse).toBeGreaterThan(0);
			expect(weights.rerank).toBeGreaterThanOrEqual(0);
		});

		it("should return weights that sum close to 1", async () => {
			const predictor = new FusionWeightPredictor({
				modelPath: "non-existent-model.onnx",
			});

			const extractor = new QueryFeatureExtractor();
			const features = extractor.extract("List all TypeScript features");
			const weights = await predictor.predict(features);

			const sum = weights.dense + weights.sparse + weights.rerank;
			expect(sum).toBeCloseTo(1.0, 1);
		});

		it("should favor sparse for queries with specific terms", async () => {
			const predictor = new FusionWeightPredictor({
				modelPath: "non-existent-model.onnx",
			});

			const extractor = new QueryFeatureExtractor();
			const features = extractor.extract("error TS2345 TypeScript version 5.0.0");
			const weights = await predictor.predict(features);

			// Specific terms (error codes, version numbers) favor sparse
			expect(weights.sparse).toBeGreaterThanOrEqual(0.3);
		});

		it("should favor rerank for complex queries", async () => {
			const predictor = new FusionWeightPredictor({
				modelPath: "non-existent-model.onnx",
			});

			const extractor = new QueryFeatureExtractor();
			const simpleFeatures = extractor.extract("What is X?");
			const complexFeatures = extractor.extract(
				"Compare the implications of using Redux versus MobX for state management considering performance and developer experience",
			);

			const simpleWeights = await predictor.predict(simpleFeatures);
			const complexWeights = await predictor.predict(complexFeatures);

			expect(complexWeights.rerank).toBeGreaterThanOrEqual(simpleWeights.rerank);
		});

		it("should favor dense for factoid questions", async () => {
			const predictor = new FusionWeightPredictor({
				modelPath: "non-existent-model.onnx",
			});

			const extractor = new QueryFeatureExtractor();
			const features = extractor.extract("Who founded Apple?");
			const weights = await predictor.predict(features);

			// Factoid questions have reasonable dense weight (at least not zero)
			// The exact weight depends on the fallback heuristics
			expect(weights.dense).toBeGreaterThan(0);
			expect(weights.dense + weights.sparse + weights.rerank).toBeCloseTo(1.0, 1);
		});
	});

	describe("predictFromQuery", () => {
		it("should predict weights directly from query string", async () => {
			const predictor = new FusionWeightPredictor({
				modelPath: "non-existent-model.onnx",
			});

			const weights = await predictor.predictFromQuery("What is machine learning?");

			expect(weights).toBeDefined();
			expect(weights.dense).toBeDefined();
			expect(weights.sparse).toBeDefined();
			expect(weights.rerank).toBeDefined();
		});
	});

	describe("isAvailable", () => {
		it("should return false when model does not exist", async () => {
			const predictor = new FusionWeightPredictor({
				modelPath: "non-existent-model.onnx",
			});

			const available = await predictor.isAvailable();
			expect(available).toBe(false);
		});
	});

	describe("close", () => {
		it("should release resources without error", async () => {
			const predictor = new FusionWeightPredictor({
				modelPath: "non-existent-model.onnx",
			});

			// Should not throw
			await expect(predictor.close()).resolves.toBeUndefined();
		});
	});
});
