import type { CreateMemoryInput, Memory, UpdateMemoryInput } from "./types";

/**
 * MemoryRepository abstracts data access for Memory entities.
 *
 * This interface decouples business logic from the underlying graph database,
 * enabling:
 * - Unit testing with mock implementations
 * - Swapping storage backends without changing consumers
 * - Clear separation of concerns
 */
export interface MemoryRepository {
	/**
	 * Find a memory by its internal ULID.
	 * @param id - The internal memory ID (ULID)
	 * @returns The memory or null if not found
	 */
	findById(id: string): Promise<Memory | null>;

	/**
	 * Find memories by type.
	 * @param type - The memory type (decision, context, insight, preference, fact, turn)
	 * @returns Array of memories of the specified type
	 */
	findByType(type: string): Promise<Memory[]>;

	/**
	 * Find memories by tag.
	 * @param tag - The tag to search for
	 * @returns Array of memories with the specified tag
	 */
	findByTag(tag: string): Promise<Memory[]>;

	/**
	 * Find memories by project.
	 * @param project - The project identifier
	 * @returns Array of memories for the specified project
	 */
	findByProject(project: string): Promise<Memory[]>;

	/**
	 * Find memories by working directory.
	 * @param workingDir - The working directory path
	 * @returns Array of memories for the specified working directory
	 */
	findByWorkingDir(workingDir: string): Promise<Memory[]>;

	/**
	 * Find memories by source session.
	 * @param sessionId - The session ID
	 * @returns Array of memories created in the specified session
	 */
	findBySession(sessionId: string): Promise<Memory[]>;

	/**
	 * Find all active memories (not logically deleted).
	 * Active memories have tt_end = MAX_DATE.
	 * @returns Array of active memories
	 */
	findActive(): Promise<Memory[]>;

	/**
	 * Create a new memory.
	 * @param input - Memory creation parameters
	 * @returns The created memory with generated ID and timestamps
	 */
	create(input: CreateMemoryInput): Promise<Memory>;

	/**
	 * Update an existing memory.
	 * Creates a new bitemporal version (old version is preserved with closed tt_end).
	 * @param id - The memory ID to update
	 * @param updates - Partial memory fields to update
	 * @returns The updated memory
	 * @throws Error if memory not found
	 */
	update(id: string, updates: UpdateMemoryInput): Promise<Memory>;

	/**
	 * Soft delete a memory (closes its transaction time).
	 * The memory is preserved for historical queries but won't appear in findActive().
	 * @param id - The memory ID to delete
	 * @throws Error if memory not found
	 */
	delete(id: string): Promise<void>;
}
