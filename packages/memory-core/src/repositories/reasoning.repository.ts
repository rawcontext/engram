import type { CreateReasoningInput, Reasoning } from "./types";

/**
 * ReasoningRepository abstracts data access for Reasoning entities.
 *
 * Reasoning nodes capture thinking/reasoning blocks within a turn.
 * They are linked to Turns via CONTAINS edges and may TRIGGER ToolCalls.
 */
export interface ReasoningRepository {
	/**
	 * Find a reasoning block by its ULID.
	 * @param id - The reasoning ID
	 * @returns The reasoning or null if not found
	 */
	findById(id: string): Promise<Reasoning | null>;

	/**
	 * Find all reasoning blocks within a turn.
	 * @param turnId - The parent turn ID
	 * @returns Array of reasoning blocks, ordered by sequence index
	 */
	findByTurn(turnId: string): Promise<Reasoning[]>;

	/**
	 * Find all reasoning blocks within a session.
	 * Aggregates reasoning across all turns in the session.
	 * @param sessionId - The session ID
	 * @returns Array of reasoning blocks, ordered by turn sequence then reasoning sequence
	 */
	findBySession(sessionId: string): Promise<Reasoning[]>;

	/**
	 * Find reasoning by type within a session.
	 * @param sessionId - The session ID
	 * @param reasoningType - The type of reasoning (chain_of_thought, reflection, etc.)
	 * @returns Array of matching reasoning blocks
	 */
	findByType(sessionId: string, reasoningType: string): Promise<Reasoning[]>;

	/**
	 * Create a new reasoning block and link it to its turn.
	 * @param input - Reasoning creation parameters including turnId
	 * @returns The created reasoning block
	 */
	create(input: CreateReasoningInput): Promise<Reasoning>;

	/**
	 * Create multiple reasoning blocks in a batch.
	 * More efficient than creating one at a time.
	 * @param inputs - Array of reasoning creation parameters
	 * @returns Array of created reasoning blocks
	 */
	createBatch(inputs: CreateReasoningInput[]): Promise<Reasoning[]>;

	/**
	 * Count reasoning blocks in a turn.
	 * @param turnId - The parent turn ID
	 * @returns Number of reasoning blocks in the turn
	 */
	count(turnId: string): Promise<number>;
}
