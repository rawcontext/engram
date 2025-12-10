import type { CreateTurnInput, Turn, UpdateTurnInput } from "./types";

/**
 * TurnRepository abstracts data access for Turn entities.
 *
 * A Turn represents a single conversation exchange: user prompt + assistant response.
 * Turns are linked to Sessions via HAS_TURN edges and to each other via NEXT edges.
 */
export interface TurnRepository {
	/**
	 * Find a turn by its ULID.
	 * @param id - The turn ID
	 * @returns The turn or null if not found
	 */
	findById(id: string): Promise<Turn | null>;

	/**
	 * Find all turns belonging to a session.
	 * @param sessionId - The parent session ID
	 * @returns Array of turns, ordered by sequence index
	 */
	findBySession(sessionId: string): Promise<Turn[]>;

	/**
	 * Find turns within a time range (by valid time).
	 * Useful for filtering conversation history by time window.
	 * @param sessionId - The parent session ID
	 * @param start - Start of time range (inclusive)
	 * @param end - End of time range (exclusive)
	 * @returns Array of turns within the time range
	 */
	findByTimeRange(sessionId: string, start: Date, end: Date): Promise<Turn[]>;

	/**
	 * Find the most recent turns in a session.
	 * Useful for building conversation context windows.
	 * @param sessionId - The parent session ID
	 * @param limit - Maximum number of turns to return (default: 10)
	 * @returns Array of recent turns, ordered by sequence index descending
	 */
	findLatest(sessionId: string, limit?: number): Promise<Turn[]>;

	/**
	 * Find turns that touched specific files.
	 * @param sessionId - The parent session ID
	 * @param filePath - The file path to search for (exact match)
	 * @returns Array of turns that touched the file
	 */
	findByFilePath(sessionId: string, filePath: string): Promise<Turn[]>;

	/**
	 * Create a new turn and link it to its session.
	 * Also creates NEXT edge to the previous turn if one exists.
	 * @param input - Turn creation parameters including sessionId
	 * @returns The created turn
	 */
	create(input: CreateTurnInput): Promise<Turn>;

	/**
	 * Update an existing turn.
	 * Creates a new bitemporal version.
	 * @param id - The turn ID to update
	 * @param updates - Partial turn fields to update
	 * @returns The updated turn
	 * @throws Error if turn not found
	 */
	update(id: string, updates: UpdateTurnInput): Promise<Turn>;

	/**
	 * Count total turns in a session.
	 * @param sessionId - The parent session ID
	 * @returns Number of turns in the session
	 */
	count(sessionId: string): Promise<number>;
}
