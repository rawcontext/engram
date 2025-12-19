/**
 * Fusion weight predictor using ONNX Runtime for inference.
 *
 * Uses a trained MLP model to predict optimal dense/sparse/rerank fusion weights
 * from query features. The model is trained using grid search on LongMemEval data.
 *
 * @see scripts/train_fusion_mlp.py - Training script
 * @see packages/benchmark/src/cli/commands/train-fusion.ts - Training data generation
 *
 * References:
 * - Neural Rank Fusion: https://www.rohan-paul.com/p/neural-based-rank-fusion-for-multi
 * - End-to-End Retrieval with ONNX: https://arxiv.org/html/2311.18503
 */

import { type FusionQueryFeatures, QueryFeatureExtractor } from "./query-features.js";

/**
 * Predicted fusion weights for combining dense, sparse, and rerank scores.
 */
export interface FusionWeights {
	/** Weight for dense (semantic) retrieval scores */
	dense: number;
	/** Weight for sparse (keyword) retrieval scores */
	sparse: number;
	/** Weight for reranker scores */
	rerank: number;
}

/**
 * Configuration for the fusion weight predictor.
 */
export interface FusionWeightPredictorConfig {
	/** Path to the ONNX model file */
	modelPath?: string;
	/** Whether to cache the ONNX session */
	cacheSession?: boolean;
	/** Default weights to use when model is unavailable */
	fallbackWeights?: FusionWeights;
}

const DEFAULT_CONFIG: Required<FusionWeightPredictorConfig> = {
	modelPath: "models/fusion_mlp.onnx",
	cacheSession: true,
	fallbackWeights: { dense: 0.4, sparse: 0.3, rerank: 0.3 },
};

/**
 * Predicts optimal fusion weights from query features using a trained MLP.
 *
 * The predictor uses ONNX Runtime for fast CPU inference. If the model
 * is not available, it falls back to rule-based heuristics.
 *
 * @example
 * ```typescript
 * const predictor = new FusionWeightPredictor();
 * const weights = await predictor.predict(queryFeatures);
 * // weights = { dense: 0.45, sparse: 0.35, rerank: 0.20 }
 * ```
 */
export class FusionWeightPredictor {
	private config: Required<FusionWeightPredictorConfig>;
	private session: OrtSession | null = null;
	private sessionPromise: Promise<OrtSession | null> | null = null;
	private ort: OrtModule | null = null;

	constructor(config: FusionWeightPredictorConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Predict fusion weights from query features.
	 *
	 * @param features - Extracted query features
	 * @returns Predicted fusion weights (sum to 1)
	 */
	async predict(features: FusionQueryFeatures): Promise<FusionWeights> {
		try {
			const session = await this.getSession();
			if (!session || !this.ort) {
				return this.fallback(features);
			}

			// Convert features to normalized vector
			const extractor = new QueryFeatureExtractor();
			const normalized = extractor.toNormalizedVector(features);

			// Create input tensor
			const inputTensor = new this.ort.Tensor("float32", new Float32Array(normalized.vector), [
				1,
				normalized.vector.length,
			]);

			// Run inference
			const results = await session.run({ features: inputTensor });
			const output = results.weights.data as Float32Array;

			// Apply softmax to get weights that sum to 1
			const weights = this.softmax(Array.from(output));

			return {
				dense: weights[0],
				sparse: weights[1],
				rerank: weights[2],
			};
		} catch (error) {
			console.warn("Fusion prediction failed, using fallback:", error);
			return this.fallback(features);
		}
	}

	/**
	 * Predict weights directly from a query string.
	 *
	 * @param query - The query text
	 * @returns Predicted fusion weights
	 */
	async predictFromQuery(query: string): Promise<FusionWeights> {
		const extractor = new QueryFeatureExtractor();
		const features = extractor.extract(query);
		return this.predict(features);
	}

	/**
	 * Rule-based fallback when model is unavailable.
	 */
	private fallback(features: FusionQueryFeatures): FusionWeights {
		// Use getFusionHints from query-features module
		let dense = 0.4;
		let sparse = 0.3;
		let rerank = 0.3;

		// Factoid queries benefit from dense (semantic)
		if (features.questionType === "factoid") {
			dense = 0.5;
			sparse = 0.2;
			rerank = 0.3;
		}

		// Queries with specific terms benefit from sparse (keyword)
		if (features.hasSpecificTerms || features.hasRareTerms) {
			sparse = 0.4;
			dense = 0.3;
			rerank = 0.3;
		}

		// Complex queries benefit more from reranking
		if (features.complexity > 0.5) {
			rerank = 0.4;
			dense = 0.35;
			sparse = 0.25;
		}

		// Short keyword-like queries favor sparse
		if (features.length <= 3 && !features.hasTemporal) {
			sparse = 0.5;
			dense = 0.25;
			rerank = 0.25;
		}

		return { dense, sparse, rerank };
	}

	/**
	 * Get or create the ONNX session.
	 */
	private async getSession(): Promise<OrtSession | null> {
		// Return cached session if available
		if (this.session) {
			return this.session;
		}

		// Return existing promise if loading
		if (this.sessionPromise) {
			return this.sessionPromise;
		}

		// Load the session
		this.sessionPromise = this.loadSession();
		const session = await this.sessionPromise;

		if (this.config.cacheSession && session) {
			this.session = session;
		}

		return session;
	}

	/**
	 * Load the ONNX model and create a session.
	 */
	private async loadSession(): Promise<OrtSession | null> {
		try {
			// Dynamic import to avoid bundling ONNX Runtime in non-Node environments
			this.ort = (await import("onnxruntime-node")) as OrtModule;

			const session = await this.ort.InferenceSession.create(this.config.modelPath, {
				executionProviders: ["cpu"],
			});

			return session;
		} catch (error) {
			// Model not found or ONNX Runtime not available
			console.warn(`Fusion model not available at ${this.config.modelPath}:`, error);
			return null;
		}
	}

	/**
	 * Apply softmax to convert logits to probabilities.
	 */
	private softmax(arr: number[]): number[] {
		const max = Math.max(...arr);
		const exp = arr.map((x) => Math.exp(x - max));
		const sum = exp.reduce((a, b) => a + b, 0);
		return exp.map((x) => x / sum);
	}

	/**
	 * Check if the model is available.
	 */
	async isAvailable(): Promise<boolean> {
		try {
			const session = await this.getSession();
			return session !== null;
		} catch {
			return false;
		}
	}

	/**
	 * Release resources.
	 */
	async close(): Promise<void> {
		if (this.session) {
			// ONNX Runtime sessions don't have a close method, but we clear the reference
			this.session = null;
		}
		this.sessionPromise = null;
	}
}

// Type definitions for ONNX Runtime (to avoid direct dependency issues)
interface OrtModule {
	Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
	InferenceSession: {
		create(path: string, options?: { executionProviders: string[] }): Promise<OrtSession>;
	};
}

interface OrtSession {
	run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

interface OrtTensor {
	data: Float32Array;
}
