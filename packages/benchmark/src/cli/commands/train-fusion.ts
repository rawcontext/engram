import { writeFile } from "node:fs/promises";
import { type FusionQueryFeatures, QueryFeatureExtractor } from "@engram/search-core";
import { loadDataset, type LoaderConfig } from "../../longmemeval/loader.js";
import { type EngramDocument, mapInstance, type MappedInstance } from "../../longmemeval/mapper.js";
import { computeRetrievalMetrics, type RetrievalResult } from "../../longmemeval/retriever.js";
import type { DatasetVariant, ParsedInstance } from "../../longmemeval/types.js";

/**
 * Training sample for fusion weight MLP.
 */
interface FusionTrainingSample {
	/** Unique identifier for this sample */
	instanceId: string;
	/** The question text */
	question: string;
	/** Normalized feature vector for model input */
	features: number[];
	/** Feature names for debugging */
	featureNames: string[];
	/** Optimal fusion weights found via grid search */
	optimalWeights: {
		dense: number;
		sparse: number;
		rerank: number;
	};
	/** Best recall achieved with optimal weights */
	bestRecall: number;
	/** Grid search results for analysis */
	gridSearchResults: Array<{
		weights: { dense: number; sparse: number; rerank: number };
		recall: number;
	}>;
}

/**
 * Configuration for training data generation.
 */
interface TrainFusionOptions {
	dataset: string;
	variant: string;
	output: string;
	limit?: number;
	verbose: boolean;
	qdrantUrl: string;
	// Grid search parameters
	denseSteps: number[];
	sparseSteps: number[];
}

const DEFAULT_DENSE_STEPS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
const DEFAULT_SPARSE_STEPS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];

/**
 * Generate training data for fusion weight MLP via grid search.
 *
 * For each LongMemEval instance:
 * 1. Extract query features
 * 2. Run retrieval with each weight combination
 * 3. Find weights that maximize recall
 * 4. Save (features, optimal_weights) pairs
 */
export async function trainFusionCommand(options: TrainFusionOptions): Promise<void> {
	console.log("🔬 Generating Fusion Training Data");
	console.log("");
	console.log("Configuration:");
	console.log(`  Dataset: ${options.dataset}`);
	console.log(`  Variant: ${options.variant}`);
	console.log(`  Output: ${options.output}`);
	console.log(`  Dense steps: ${options.denseSteps.join(", ")}`);
	console.log(`  Sparse steps: ${options.sparseSteps.join(", ")}`);
	if (options.limit) {
		console.log(`  Limit: ${options.limit} instances`);
	}
	console.log("");

	// Initialize components
	const featureExtractor = new QueryFeatureExtractor();
	const weightedRetriever = await createWeightedRetriever(options.qdrantUrl);

	// Load dataset
	console.log("📂 Loading dataset...");
	const loaderConfig: LoaderConfig = {
		datasetPath: options.dataset,
		variant: options.variant as DatasetVariant,
		limit: options.limit,
	};
	const loadResult = await loadDataset(loaderConfig);
	console.log(`   Loaded ${loadResult.instances.length} instances`);

	// Generate training samples
	const samples: FusionTrainingSample[] = [];
	const totalGridSize = options.denseSteps.length * options.sparseSteps.length;
	console.log(`   Grid size: ${totalGridSize} combinations per instance`);
	console.log("");

	for (let i = 0; i < loadResult.instances.length; i++) {
		const instance = loadResult.instances[i];
		const progress = `[${i + 1}/${loadResult.instances.length}]`;

		if (options.verbose) {
			console.log(`${progress} Processing: ${instance.question.substring(0, 50)}...`);
		} else {
			process.stdout.write(`\r${progress} Generating training data...`);
		}

		try {
			const sample = await generateTrainingSample(
				instance,
				featureExtractor,
				weightedRetriever,
				options.denseSteps,
				options.sparseSteps,
			);
			samples.push(sample);

			if (options.verbose) {
				console.log(
					`   → Best weights: d=${sample.optimalWeights.dense.toFixed(2)}, ` +
						`s=${sample.optimalWeights.sparse.toFixed(2)}, ` +
						`r=${sample.optimalWeights.rerank.toFixed(2)} ` +
						`(recall=${sample.bestRecall.toFixed(3)})`,
				);
			}
		} catch (error) {
			console.warn(`\n⚠️ Failed to process instance ${instance.questionId}:`, error);
		}
	}

	console.log("\n");
	console.log(`✅ Generated ${samples.length} training samples`);

	// Analyze weight distribution
	analyzeWeightDistribution(samples);

	// Save to JSONL
	const jsonlContent = samples.map((s) => JSON.stringify(s)).join("\n");
	await writeFile(options.output, jsonlContent, "utf-8");
	console.log(`\n📁 Saved training data to: ${options.output}`);

	// Cleanup
	await weightedRetriever.cleanup();
}

/**
 * Generate a training sample for a single instance.
 */
async function generateTrainingSample(
	instance: ParsedInstance,
	featureExtractor: QueryFeatureExtractor,
	retriever: WeightedRetriever,
	denseSteps: number[],
	sparseSteps: number[],
): Promise<FusionTrainingSample> {
	// Map instance to documents
	const mapped = mapInstance(instance);

	// Index documents
	await retriever.index(mapped.documents);

	// Extract query features
	const features = featureExtractor.extract(instance.question);
	const normalized = featureExtractor.toNormalizedVector(features);

	// Get evidence document IDs for recall calculation
	const evidenceDocIds = mapped.evidenceDocIds;

	// Grid search for optimal weights
	const gridResults: Array<{
		weights: { dense: number; sparse: number; rerank: number };
		recall: number;
	}> = [];

	let bestRecall = 0;
	let bestWeights = { dense: 0.4, sparse: 0.3, rerank: 0.3 };

	for (const dense of denseSteps) {
		for (const sparse of sparseSteps) {
			const rerank = Math.max(0, 1 - dense - sparse);
			if (rerank < 0 || dense + sparse > 1) continue;

			const weights = { dense, sparse, rerank };

			// Retrieve with weighted fusion
			const result = await retriever.search(instance.question, weights, 10);

			// Calculate recall
			const metrics = computeRetrievalMetrics(result, evidenceDocIds);
			const recall = metrics.recall;

			gridResults.push({ weights, recall });

			if (recall > bestRecall) {
				bestRecall = recall;
				bestWeights = weights;
			}
		}
	}

	// Clear index for next instance
	retriever.clear();

	return {
		instanceId: instance.questionId,
		question: instance.question,
		features: normalized.vector,
		featureNames: normalized.names,
		optimalWeights: bestWeights,
		bestRecall,
		gridSearchResults: gridResults,
	};
}

/**
 * Analyze and report weight distribution in training data.
 */
function analyzeWeightDistribution(samples: FusionTrainingSample[]): void {
	console.log("\n📊 Weight Distribution Analysis:");

	// Aggregate optimal weights
	const denseWeights = samples.map((s) => s.optimalWeights.dense);
	const sparseWeights = samples.map((s) => s.optimalWeights.sparse);
	const rerankWeights = samples.map((s) => s.optimalWeights.rerank);

	const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
	const std = (arr: number[]) => {
		const m = mean(arr);
		return Math.sqrt(arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length);
	};

	console.log(
		`  Dense:  mean=${mean(denseWeights).toFixed(3)}, std=${std(denseWeights).toFixed(3)}`,
	);
	console.log(
		`  Sparse: mean=${mean(sparseWeights).toFixed(3)}, std=${std(sparseWeights).toFixed(3)}`,
	);
	console.log(
		`  Rerank: mean=${mean(rerankWeights).toFixed(3)}, std=${std(rerankWeights).toFixed(3)}`,
	);

	// Show question type breakdown
	console.log("\n  By Question Type:");
	const byType = new Map<string, FusionTrainingSample[]>();
	for (const sample of samples) {
		// Parse question type from features (index 3 in normalized vector)
		const typeValue = sample.features[3];
		let type = "other";
		if (typeValue < 0.1) type = "factoid";
		else if (typeValue < 0.2) type = "list";
		else if (typeValue < 0.4) type = "comparison";
		else if (typeValue < 0.5) type = "causal";
		else if (typeValue < 0.7) type = "temporal";
		else if (typeValue < 0.8) type = "opinion";

		if (!byType.has(type)) byType.set(type, []);
		byType.get(type)!.push(sample);
	}

	for (const [type, typeSamples] of byType) {
		const avgDense = mean(typeSamples.map((s) => s.optimalWeights.dense));
		const avgSparse = mean(typeSamples.map((s) => s.optimalWeights.sparse));
		const avgRerank = mean(typeSamples.map((s) => s.optimalWeights.rerank));
		console.log(
			`    ${type.padEnd(12)}: d=${avgDense.toFixed(2)}, s=${avgSparse.toFixed(2)}, r=${avgRerank.toFixed(2)} (n=${typeSamples.length})`,
		);
	}
}

/**
 * Weighted retriever that allows configurable fusion weights.
 */
interface WeightedRetriever {
	index(documents: EngramDocument[]): Promise<void>;
	search(
		query: string,
		weights: { dense: number; sparse: number; rerank: number },
		topK: number,
	): Promise<RetrievalResult>;
	clear(): void;
	cleanup(): Promise<void>;
}

/**
 * Create a weighted retriever for grid search.
 * This uses the Engram pipeline with configurable fusion weights.
 */
async function createWeightedRetriever(qdrantUrl: string): Promise<WeightedRetriever> {
	// Dynamic import to avoid circular dependencies
	const searchCore = await import("@engram/search-core");
	const { QdrantClient } = await import("@qdrant/js-client-rest");

	const collectionName = "fusion_training";
	const client = new QdrantClient({ url: qdrantUrl });
	const textEmbedder = new searchCore.TextEmbedder();
	const spladeEmbedder = new searchCore.SpladeEmbedder();
	const reranker = searchCore.BatchedReranker.forTier("fast");

	let indexed = false;
	let documents: EngramDocument[] = [];

	return {
		async index(docs: EngramDocument[]): Promise<void> {
			documents = docs;

			// Ensure collection exists
			try {
				await client.deleteCollection(collectionName);
			} catch {
				// Ignore if doesn't exist
			}

			await client.createCollection(collectionName, {
				vectors: {
					dense: { size: 384, distance: "Cosine" },
				},
				sparse_vectors: {
					sparse: { index: { on_disk: false } },
				},
			});

			// Generate embeddings
			const texts = docs.map((d) => d.content);
			const denseEmbeddings = await Promise.all(texts.map((t) => textEmbedder.embed(t)));
			const sparseEmbeddings = await Promise.all(texts.map((t) => spladeEmbedder.embed(t)));

			// Index points
			const points = docs.map((doc, i) => ({
				id: hashId(doc.id),
				vector: {
					dense: Array.from(denseEmbeddings[i]),
					sparse: sparseEmbeddings[i],
				},
				payload: {
					doc_id: doc.id,
					content: doc.content,
					valid_time: doc.validTime.toISOString(),
					has_answer: doc.metadata.hasAnswer,
				},
			}));

			await client.upsert(collectionName, { wait: true, points });
			indexed = true;
		},

		async search(
			query: string,
			weights: { dense: number; sparse: number; rerank: number },
			topK: number,
		): Promise<RetrievalResult> {
			if (!indexed) {
				return { documents: [], scores: [], retrievedIds: [] };
			}

			// Get dense and sparse query embeddings
			const denseQuery = await textEmbedder.embedQuery(query);
			const sparseQuery = await spladeEmbedder.embedQuery(query);

			// Fetch candidates for each method
			const fetchLimit = 30;

			// Dense search
			const denseResults = await client.search(collectionName, {
				vector: { name: "dense", vector: Array.from(denseQuery) },
				limit: fetchLimit,
				with_payload: true,
			});

			// Sparse search using query API
			const sparseResults = await client.query(collectionName, {
				query: {
					indices: sparseQuery.indices,
					values: sparseQuery.values,
				},
				using: "sparse",
				limit: fetchLimit,
				with_payload: true,
			});

			// Build score map for weighted fusion
			const scoreMap = new Map<
				string,
				{
					docId: string;
					content: string;
					denseScore: number;
					sparseScore: number;
					rerankScore: number;
				}
			>();

			// Normalize dense scores to 0-1 range
			const maxDense = Math.max(...denseResults.map((r) => r.score), 0.001);
			for (const r of denseResults) {
				const payload = r.payload as Record<string, unknown>;
				const docId = payload.doc_id as string;
				scoreMap.set(docId, {
					docId,
					content: payload.content as string,
					denseScore: r.score / maxDense,
					sparseScore: 0,
					rerankScore: 0,
				});
			}

			// Add sparse scores
			const sparsePoints = sparseResults.points || [];
			const maxSparse = Math.max(...sparsePoints.map((r) => r.score), 0.001);
			for (const r of sparsePoints) {
				const payload = r.payload as Record<string, unknown>;
				const docId = payload.doc_id as string;
				const existing = scoreMap.get(docId);
				if (existing) {
					existing.sparseScore = r.score / maxSparse;
				} else {
					scoreMap.set(docId, {
						docId,
						content: payload.content as string,
						denseScore: 0,
						sparseScore: r.score / maxSparse,
						rerankScore: 0,
					});
				}
			}

			// Get rerank scores for top candidates
			const candidates = Array.from(scoreMap.values()).map((s) => ({
				id: s.docId,
				content: s.content,
				score: s.denseScore * weights.dense + s.sparseScore * weights.sparse,
			}));

			if (weights.rerank > 0 && candidates.length > 0) {
				const reranked = await reranker.rerank(query, candidates, candidates.length);
				const maxRerank = Math.max(...reranked.map((r) => r.score), 0.001);
				for (const r of reranked) {
					const existing = scoreMap.get(String(r.id));
					if (existing) {
						existing.rerankScore = r.score / maxRerank;
					}
				}
			}

			// Calculate final weighted scores
			const results = Array.from(scoreMap.values())
				.map((s) => ({
					docId: s.docId,
					content: s.content,
					score:
						s.denseScore * weights.dense +
						s.sparseScore * weights.sparse +
						s.rerankScore * weights.rerank,
				}))
				.sort((a, b) => b.score - a.score)
				.slice(0, topK);

			// Convert to RetrievalResult
			const resultDocs = results
				.map((r) => documents.find((d) => d.id === r.docId))
				.filter((d): d is EngramDocument => d !== undefined);

			return {
				documents: resultDocs,
				scores: results.map((r) => r.score),
				retrievedIds: results.map((r) => r.docId),
			};
		},

		clear(): void {
			indexed = false;
			documents = [];
		},

		async cleanup(): Promise<void> {
			try {
				await client.deleteCollection(collectionName);
			} catch {
				// Ignore
			}
		},
	};
}

/**
 * Generate numeric hash for Qdrant point ID.
 */
function hashId(id: string): number {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = (hash << 5) - hash + id.charCodeAt(i);
		hash = hash >>> 0;
	}
	return hash;
}

export { DEFAULT_DENSE_STEPS, DEFAULT_SPARSE_STEPS };
export type { TrainFusionOptions, FusionTrainingSample };
