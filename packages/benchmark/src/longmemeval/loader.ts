import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type DatasetVariant,
	type LongMemEvalDataset,
	type LongMemEvalInstance,
	LongMemEvalDatasetSchema,
	type ParsedInstance,
	type ParsedSession,
	type ParsedTurn,
	getMemoryAbility,
} from "./types.js";

/**
 * Configuration for the dataset loader
 */
export interface LoaderConfig {
	/** Path to the dataset directory or file */
	datasetPath: string;
	/** Dataset variant to load */
	variant?: DatasetVariant;
	/** Limit number of instances to load (for testing) */
	limit?: number;
	/** Filter by question types */
	questionTypes?: string[];
}

/**
 * Result of loading a dataset
 */
export interface LoadResult {
	/** Parsed instances ready for processing */
	instances: ParsedInstance[];
	/** Raw dataset for reference */
	raw: LongMemEvalDataset;
	/** Statistics about the loaded dataset */
	stats: LoadStats;
}

/**
 * Statistics about the loaded dataset
 */
export interface LoadStats {
	totalInstances: number;
	totalSessions: number;
	totalTurns: number;
	byAbility: Record<string, number>;
	abstentionCount: number;
}

/**
 * Loads and parses a LongMemEval dataset
 */
export async function loadDataset(config: LoaderConfig): Promise<LoadResult> {
	const datasetPath = resolveDatasetPath(config);
	const rawContent = await readFile(datasetPath, "utf-8");
	const rawData = JSON.parse(rawContent);

	// Validate with Zod
	const dataset = LongMemEvalDatasetSchema.parse(rawData);

	// Apply filters
	let filteredDataset = dataset;

	if (config.questionTypes && config.questionTypes.length > 0) {
		filteredDataset = filteredDataset.filter((instance) =>
			config.questionTypes!.includes(instance.question_type),
		);
	}

	if (config.limit && config.limit > 0) {
		filteredDataset = filteredDataset.slice(0, config.limit);
	}

	// Parse instances
	const instances = filteredDataset.map(parseInstance);

	// Compute statistics
	const stats = computeStats(instances);

	return {
		instances,
		raw: filteredDataset,
		stats,
	};
}

/**
 * Resolves the dataset path based on variant
 */
function resolveDatasetPath(config: LoaderConfig): string {
	const { datasetPath, variant } = config;

	// If path ends with .json, use it directly
	if (datasetPath.endsWith(".json")) {
		return datasetPath;
	}

	// Otherwise, construct path from variant
	const filename = variant ? `longmemeval_${variant}_cleaned.json` : "longmemeval_s_cleaned.json";

	return join(datasetPath, filename);
}

/**
 * Parses a raw LongMemEval instance into a normalized format
 */
function parseInstance(raw: LongMemEvalInstance): ParsedInstance {
	const isAbstention = raw.question_id.endsWith("_abs");
	const memoryAbility = getMemoryAbility(raw.question_type, raw.question_id);

	// Parse sessions with timestamps
	const sessions: ParsedSession[] = raw.haystack_sessions.map((session, sessionIndex) => {
		const sessionId = raw.haystack_session_ids[sessionIndex];
		const timestamp = parseTimestamp(raw.haystack_dates[sessionIndex]);

		const turns: ParsedTurn[] = session.map((turn, turnIndex) => ({
			role: turn.role,
			content: turn.content,
			hasAnswer: turn.has_answer ?? false,
			sequenceIndex: turnIndex,
		}));

		return {
			sessionId,
			timestamp,
			turns,
		};
	});

	return {
		questionId: raw.question_id,
		questionType: raw.question_type,
		memoryAbility,
		question: raw.question,
		answer: raw.answer,
		questionDate: parseTimestamp(raw.question_date),
		sessions,
		answerSessionIds: raw.answer_session_ids,
		isAbstention,
	};
}

/**
 * Parses a timestamp string into a Date object
 * Handles various formats from the dataset
 */
function parseTimestamp(timestamp: string): Date {
	// Try ISO 8601 first
	const date = new Date(timestamp);

	if (!Number.isNaN(date.getTime())) {
		return date;
	}

	// Try other formats if needed
	// The dataset uses ISO format, so this should generally work
	throw new Error(`Unable to parse timestamp: ${timestamp}`);
}

/**
 * Computes statistics about the loaded instances
 */
function computeStats(instances: ParsedInstance[]): LoadStats {
	const byAbility: Record<string, number> = {
		IE: 0,
		MR: 0,
		TR: 0,
		KU: 0,
		ABS: 0,
	};

	let totalSessions = 0;
	let totalTurns = 0;
	let abstentionCount = 0;

	for (const instance of instances) {
		byAbility[instance.memoryAbility]++;

		if (instance.isAbstention) {
			abstentionCount++;
		}

		totalSessions += instance.sessions.length;

		for (const session of instance.sessions) {
			totalTurns += session.turns.length;
		}
	}

	return {
		totalInstances: instances.length,
		totalSessions,
		totalTurns,
		byAbility,
		abstentionCount,
	};
}

/**
 * Loads a single instance by question ID
 */
export async function loadInstance(
	config: LoaderConfig,
	questionId: string,
): Promise<ParsedInstance | null> {
	const { instances } = await loadDataset(config);
	return instances.find((i) => i.questionId === questionId) ?? null;
}

/**
 * Validates that a dataset file exists and is valid
 */
export async function validateDataset(
	datasetPath: string,
): Promise<{ valid: boolean; error?: string; stats?: LoadStats }> {
	try {
		const result = await loadDataset({ datasetPath });
		return { valid: true, stats: result.stats };
	} catch (error) {
		return {
			valid: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
