import type { CreateSessionInput, Session, UpdateSessionInput } from "./types";

/**
 * SessionRepository abstracts data access for Session entities.
 *
 * This interface decouples business logic from the underlying graph database,
 * enabling:
 * - Unit testing with mock implementations
 * - Swapping storage backends without changing consumers
 * - Clear separation of concerns
 */
export interface SessionRepository {
	/**
	 * Find a session by its internal ULID.
	 * @param id - The internal session ID (ULID)
	 * @returns The session or null if not found
	 */
	findById(id: string): Promise<Session | null>;

	/**
	 * Find a session by its external provider ID.
	 * @param externalId - The external ID from the agent provider (e.g., Claude session ID)
	 * @returns The session or null if not found
	 */
	findByExternalId(externalId: string): Promise<Session | null>;

	/**
	 * Find all active sessions (not logically deleted).
	 * Active sessions have tt_end = MAX_DATE.
	 * @returns Array of active sessions, ordered by start time descending
	 */
	findActive(): Promise<Session[]>;

	/**
	 * Find all sessions from a specific agent provider.
	 * @param provider - The agent provider name (e.g., "claude-code", "opencode")
	 * @returns Array of sessions for the provider
	 */
	findByProvider(provider: string): Promise<Session[]>;

	/**
	 * Find all sessions for a specific user.
	 * @param userId - The user ID
	 * @returns Array of sessions for the user
	 */
	findByUser(userId: string): Promise<Session[]>;

	/**
	 * Find sessions by working directory (project context).
	 * @param workingDir - The working directory path
	 * @returns Array of sessions for the working directory
	 */
	findByWorkingDir(workingDir: string): Promise<Session[]>;

	/**
	 * Create a new session.
	 * @param input - Session creation parameters
	 * @returns The created session with generated ID and timestamps
	 */
	create(input: CreateSessionInput): Promise<Session>;

	/**
	 * Update an existing session.
	 * Creates a new bitemporal version (old version is preserved with closed tt_end).
	 * @param id - The session ID to update
	 * @param updates - Partial session fields to update
	 * @returns The updated session
	 * @throws Error if session not found
	 */
	update(id: string, updates: UpdateSessionInput): Promise<Session>;

	/**
	 * Soft delete a session (closes its transaction time).
	 * The session is preserved for historical queries but won't appear in findActive().
	 * @param id - The session ID to delete
	 * @throws Error if session not found
	 */
	delete(id: string): Promise<void>;
}
