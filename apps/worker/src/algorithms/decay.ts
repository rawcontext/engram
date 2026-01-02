/**
 * Decay Score Calculation for Memory Retrieval
 *
 * Implements exponential decay with type-based weighting and access boost.
 * Based on the Generative Agents memory scoring framework (Park et al., 2023).
 *
 * Formula: decay_score = type_weight × recency_factor × access_factor
 *
 * @see https://arxiv.org/abs/2304.03442 - Section 5.2: Memory Retrieval
 * @see https://pmc.ncbi.nlm.nih.gov/articles/PMC12092450/
 */

import type { MemoryType } from "@engram/graph";

// =============================================================================
// Constants
// =============================================================================

/** Milliseconds per day */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Decay rate lambda.
 * ~0.995 decay per hour translates to exp(-0.005/hour) ≈ exp(-0.12/day).
 * Using 0.01 for slightly slower decay (roughly 1% per day).
 */
const LAMBDA = 0.01;

/**
 * Type weights based on memory importance.
 * Higher values = more resistant to decay.
 */
export const TYPE_WEIGHTS: Record<MemoryType, number> = {
	decision: 1.0, // Architectural decisions are most important
	preference: 0.9, // User preferences should persist
	insight: 0.8, // Learned patterns are valuable
	fact: 0.7, // Factual information
	context: 0.5, // Background context
	turn: 0.3, // Conversation turns decay fastest
};

// =============================================================================
// Types
// =============================================================================

/**
 * Input for decay score calculation.
 */
export interface DecayInput {
	/** Memory type (determines base weight) */
	type: MemoryType;

	/** Creation timestamp (vt_start) in epoch milliseconds */
	createdAt: number;

	/** Last access timestamp in epoch milliseconds (optional) */
	lastAccessed?: number;

	/** Number of times returned in recall operations */
	accessCount: number;

	/** If true, memory never decays (returns 1.0) */
	pinned: boolean;
}

/**
 * Detailed breakdown of decay calculation.
 */
export interface DecayBreakdown {
	/** Final decay score (0.0 - 1.0) */
	score: number;

	/** Type weight component */
	typeWeight: number;

	/** Recency factor component (exponential decay) */
	recencyFactor: number;

	/** Access factor component (rehearsal boost) */
	accessFactor: number;

	/** Days since creation */
	daysSinceCreation: number;

	/** Whether memory is pinned */
	pinned: boolean;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Calculate the decay score for a memory.
 *
 * The score represents how "alive" a memory is, from 0.0 (forgotten) to 1.0 (fully active).
 *
 * @param input - Memory properties for decay calculation
 * @param now - Current timestamp in epoch milliseconds (defaults to Date.now())
 * @returns Decay score between 0.0 and 1.0
 *
 * @example
 * ```typescript
 * const score = calculateDecayScore({
 *   type: 'decision',
 *   createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
 *   accessCount: 5,
 *   pinned: false,
 * });
 * console.log(score); // ~0.88 (high due to type weight and access boost)
 * ```
 */
export function calculateDecayScore(input: DecayInput, now: number = Date.now()): number {
	// Pinned memories never decay
	if (input.pinned) {
		return 1.0;
	}

	// Type weight (defaults to context weight if unknown type)
	const typeWeight = TYPE_WEIGHTS[input.type] ?? 0.5;

	// Days since creation
	const daysSinceCreation = Math.max(0, (now - input.createdAt) / MS_PER_DAY);

	// Exponential decay based on age
	const recencyFactor = Math.exp(-LAMBDA * daysSinceCreation);

	// Rehearsal boost: frequently accessed memories resist decay
	// log(1 + count) provides diminishing returns
	const accessFactor = 1 + Math.log(1 + input.accessCount) * 0.1;

	// Combine factors, capped at 1.0
	const score = typeWeight * recencyFactor * accessFactor;

	return Math.min(1.0, score);
}

/**
 * Calculate decay score with detailed breakdown.
 *
 * Useful for debugging and understanding why a memory has a particular score.
 *
 * @param input - Memory properties for decay calculation
 * @param now - Current timestamp in epoch milliseconds (defaults to Date.now())
 * @returns Breakdown of all decay components
 */
export function calculateDecayBreakdown(
	input: DecayInput,
	now: number = Date.now(),
): DecayBreakdown {
	if (input.pinned) {
		return {
			score: 1.0,
			typeWeight: TYPE_WEIGHTS[input.type] ?? 0.5,
			recencyFactor: 1.0,
			accessFactor: 1.0,
			daysSinceCreation: Math.max(0, (now - input.createdAt) / MS_PER_DAY),
			pinned: true,
		};
	}

	const typeWeight = TYPE_WEIGHTS[input.type] ?? 0.5;
	const daysSinceCreation = Math.max(0, (now - input.createdAt) / MS_PER_DAY);
	const recencyFactor = Math.exp(-LAMBDA * daysSinceCreation);
	const accessFactor = 1 + Math.log(1 + input.accessCount) * 0.1;
	const score = Math.min(1.0, typeWeight * recencyFactor * accessFactor);

	return {
		score,
		typeWeight,
		recencyFactor,
		accessFactor,
		daysSinceCreation,
		pinned: false,
	};
}

/**
 * Calculate decay scores for multiple memories efficiently.
 *
 * @param inputs - Array of memory properties
 * @param now - Current timestamp in epoch milliseconds (defaults to Date.now())
 * @returns Array of decay scores in the same order as inputs
 */
export function calculateDecayScores(inputs: DecayInput[], now: number = Date.now()): number[] {
	return inputs.map((input) => calculateDecayScore(input, now));
}

/**
 * Filter memories by minimum decay score threshold.
 *
 * @param inputs - Array of memory properties with identifiers
 * @param threshold - Minimum score to include (0.0 - 1.0)
 * @param now - Current timestamp in epoch milliseconds (defaults to Date.now())
 * @returns Inputs with score >= threshold, sorted by score descending
 */
export function filterByDecayThreshold<T extends DecayInput>(
	inputs: T[],
	threshold: number,
	now: number = Date.now(),
): Array<T & { decayScore: number }> {
	return inputs
		.map((input) => ({
			...input,
			decayScore: calculateDecayScore(input, now),
		}))
		.filter((item) => item.decayScore >= threshold)
		.sort((a, b) => b.decayScore - a.decayScore);
}
