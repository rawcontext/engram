import type { Community, CreateCommunityInput, UpdateCommunityInput } from "./types";

/**
 * CommunityRepository abstracts data access for Community entities.
 *
 * Communities are entity clusters discovered via graph community detection.
 * They group related entities for hierarchical retrieval and context assembly.
 *
 * This interface decouples business logic from the underlying graph database,
 * enabling:
 * - Unit testing with mock implementations
 * - Swapping storage backends without changing consumers
 * - Clear separation of concerns
 */
export interface CommunityRepository {
	/**
	 * Find a community by its internal ULID.
	 * @param id - The internal community ID (ULID)
	 * @returns The community or null if not found
	 */
	findById(id: string): Promise<Community | null>;

	/**
	 * Find communities by project.
	 * @param project - The project identifier
	 * @returns Array of communities for the specified project
	 */
	findByProject(project: string): Promise<Community[]>;

	/**
	 * Get member entity IDs of a community.
	 * Follows MEMBER_OF edges from Entity nodes to the Community.
	 * @param communityId - The community ID
	 * @returns Array of entity IDs that are members of the community
	 */
	getMembers(communityId: string): Promise<string[]>;

	/**
	 * Create a new community.
	 * @param input - Community creation parameters
	 * @returns The created community with generated ID and timestamps
	 */
	create(input: CreateCommunityInput): Promise<Community>;

	/**
	 * Update an existing community.
	 * Creates a new bitemporal version (old version is preserved with closed tt_end).
	 * @param id - The community ID to update
	 * @param updates - Partial community fields to update
	 * @returns The updated community
	 * @throws Error if community not found
	 */
	update(id: string, updates: UpdateCommunityInput): Promise<Community>;

	/**
	 * Find existing communities with overlapping member entities.
	 * Used for deduplication during community detection to avoid creating
	 * duplicate communities for similar entity clusters.
	 *
	 * @param memberIds - Array of entity IDs to check for overlap
	 * @param minOverlap - Minimum number of overlapping members (default: 2)
	 * @returns Array of communities with their overlap counts, sorted by overlap descending
	 */
	findExistingByMemberOverlap(
		memberIds: string[],
		minOverlap?: number,
	): Promise<Array<{ community: Community; overlapCount: number }>>;

	/**
	 * Find all active communities (not logically deleted).
	 * Active communities have tt_end = MAX_DATE.
	 * @returns Array of active communities
	 */
	findActive(): Promise<Community[]>;

	/**
	 * Soft delete a community (closes its transaction time).
	 * The community is preserved for historical queries but won't appear in findActive().
	 * @param id - The community ID to delete
	 * @throws Error if community not found
	 */
	delete(id: string): Promise<void>;
}
