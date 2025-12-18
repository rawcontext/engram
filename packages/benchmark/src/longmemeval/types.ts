import { z } from "zod";

/**
 * LongMemEval Dataset Schema
 *
 * Based on the LongMemEval benchmark (ICLR 2025)
 * @see https://github.com/xiaowu0162/LongMemEval
 * @see https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
 */

/**
 * Question types representing the 5 core memory abilities:
 * - IE (Information Extraction): single-session-*
 * - MR (Multi-Session Reasoning): multi-session
 * - TR (Temporal Reasoning): temporal-reasoning
 * - KU (Knowledge Update): knowledge-update
 * - ABS (Abstention): indicated by _abs suffix on question_id
 */
export const QuestionTypeSchema = z.enum([
	"single-session-user",
	"single-session-assistant",
	"single-session-preference",
	"multi-session",
	"temporal-reasoning",
	"knowledge-update",
]);

export type QuestionType = z.infer<typeof QuestionTypeSchema>;

/**
 * A single turn in a conversation (user or assistant message)
 */
export const TurnSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string(),
	has_answer: z.boolean().optional(),
});

export type Turn = z.infer<typeof TurnSchema>;

/**
 * A session is an array of turns representing a conversation
 */
export const SessionSchema = z.array(TurnSchema);

export type Session = z.infer<typeof SessionSchema>;

/**
 * A single evaluation instance from LongMemEval
 * Note: answer field uses coerce because some answers are numeric in the dataset
 */
export const LongMemEvalInstanceSchema = z.object({
	question_id: z.string(),
	question_type: QuestionTypeSchema,
	question: z.string(),
	answer: z.coerce.string(), // Coerce numbers to strings
	question_date: z.string(),
	haystack_session_ids: z.array(z.string()),
	haystack_dates: z.array(z.string()),
	haystack_sessions: z.array(SessionSchema),
	answer_session_ids: z.array(z.string()),
});

export type LongMemEvalInstance = z.infer<typeof LongMemEvalInstanceSchema>;

/**
 * The full dataset is an array of instances
 */
export const LongMemEvalDatasetSchema = z.array(LongMemEvalInstanceSchema);

export type LongMemEvalDataset = z.infer<typeof LongMemEvalDatasetSchema>;

/**
 * Dataset variants available
 */
export type DatasetVariant = "s" | "m" | "oracle";

/**
 * Memory ability category derived from question type
 */
export type MemoryAbility = "IE" | "MR" | "TR" | "KU" | "ABS";

/**
 * Maps question type to memory ability
 */
export function getMemoryAbility(questionType: QuestionType, questionId: string): MemoryAbility {
	// Abstention is indicated by _abs suffix
	if (questionId.endsWith("_abs")) {
		return "ABS";
	}

	switch (questionType) {
		case "single-session-user":
		case "single-session-assistant":
		case "single-session-preference":
			return "IE";
		case "multi-session":
			return "MR";
		case "temporal-reasoning":
			return "TR";
		case "knowledge-update":
			return "KU";
	}
}

/**
 * Parsed instance with normalized data types
 */
export interface ParsedInstance {
	questionId: string;
	questionType: QuestionType;
	memoryAbility: MemoryAbility;
	question: string;
	answer: string;
	questionDate: Date;
	sessions: ParsedSession[];
	answerSessionIds: string[];
	isAbstention: boolean;
}

/**
 * Parsed session with normalized data
 */
export interface ParsedSession {
	sessionId: string;
	timestamp: Date;
	turns: ParsedTurn[];
}

/**
 * Parsed turn with sequence index
 */
export interface ParsedTurn {
	role: "user" | "assistant";
	content: string;
	hasAnswer: boolean;
	sequenceIndex: number;
}

/**
 * Output format for benchmark results
 */
export interface BenchmarkResult {
	questionId: string;
	hypothesis: string;
}

/**
 * Evaluation output with judgment
 */
export interface EvaluatedResult extends BenchmarkResult {
	answer: string;
	questionType: QuestionType;
	memoryAbility: MemoryAbility;
	correct: boolean;
	reasoning?: string;
}

/**
 * Aggregate metrics per memory ability
 */
export interface AbilityMetrics {
	total: number;
	correct: number;
	accuracy: number;
}

/**
 * Full evaluation metrics
 */
export interface EvaluationMetrics {
	overall: {
		total: number;
		correct: number;
		accuracy: number;
	};
	byAbility: Record<MemoryAbility, AbilityMetrics>;
	retrieval?: {
		turnRecall: number;
		sessionRecall: number;
		recallAtK: Record<number, number>;
	};
}
