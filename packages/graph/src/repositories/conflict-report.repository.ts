import type {
	ConflictReport,
	CreateConflictReportInput,
	ResolveConflictReportInput,
} from "./types";

/**
 * ConflictReportRepository abstracts data access for ConflictReport entities.
 *
 * ConflictReports are background-detected memory conflicts pending review.
 * They are created by the weekly conflict scanner and require user resolution.
 *
 * This interface decouples business logic from the underlying graph database,
 * enabling:
 * - Unit testing with mock implementations
 * - Swapping storage backends without changing consumers
 * - Clear separation of concerns
 */
export interface ConflictReportRepository {
	/**
	 * Find a conflict report by its internal ULID.
	 * @param id - The internal conflict report ID (ULID)
	 * @returns The conflict report or null if not found
	 */
	findById(id: string): Promise<ConflictReport | null>;

	/**
	 * Find conflict reports by project.
	 * @param project - The project identifier
	 * @returns Array of conflict reports for the specified project
	 */
	findByProject(project: string): Promise<ConflictReport[]>;

	/**
	 * Find pending conflict reports (status = 'pending_review').
	 * @param orgId - Organization ID to filter by
	 * @param project - Optional project filter
	 * @returns Array of pending conflict reports, sorted by scannedAt descending
	 */
	findPending(orgId: string, project?: string): Promise<ConflictReport[]>;

	/**
	 * Find conflict reports involving a specific memory.
	 * @param memoryId - Memory ID to search for (matches either memoryIdA or memoryIdB)
	 * @returns Array of conflict reports involving the memory
	 */
	findByMemoryId(memoryId: string): Promise<ConflictReport[]>;

	/**
	 * Create a new conflict report.
	 * @param input - Conflict report creation parameters
	 * @returns The created conflict report with generated ID and timestamps
	 */
	create(input: CreateConflictReportInput): Promise<ConflictReport>;

	/**
	 * Create multiple conflict reports in a single transaction.
	 * Used by the conflict scanner for batch creation.
	 * @param inputs - Array of conflict report creation parameters
	 * @returns Array of created conflict reports
	 */
	createMany(inputs: CreateConflictReportInput[]): Promise<ConflictReport[]>;

	/**
	 * Resolve a conflict report (confirm, dismiss, or auto-resolve).
	 * @param id - The conflict report ID to resolve
	 * @param input - Resolution parameters
	 * @returns The resolved conflict report
	 * @throws Error if conflict report not found
	 */
	resolve(id: string, input: ResolveConflictReportInput): Promise<ConflictReport>;

	/**
	 * Dismiss a conflict report (convenience method).
	 * Equivalent to resolve(id, { status: 'dismissed', reviewedBy })
	 * @param id - The conflict report ID to dismiss
	 * @param reviewedBy - User ID who dismissed
	 * @returns The dismissed conflict report
	 * @throws Error if conflict report not found
	 */
	dismiss(id: string, reviewedBy: string): Promise<ConflictReport>;

	/**
	 * Find all active conflict reports (not logically deleted).
	 * Active reports have tt_end = MAX_DATE.
	 * @param orgId - Organization ID to filter by
	 * @returns Array of active conflict reports
	 */
	findActive(orgId: string): Promise<ConflictReport[]>;

	/**
	 * Get statistics about conflict reports for an organization.
	 * @param orgId - Organization ID
	 * @returns Statistics object with counts by status
	 */
	getStats(orgId: string): Promise<{
		pending: number;
		confirmed: number;
		dismissed: number;
		autoResolved: number;
	}>;

	/**
	 * Soft delete a conflict report (closes its transaction time).
	 * The report is preserved for historical queries but won't appear in findActive().
	 * @param id - The conflict report ID to delete
	 * @throws Error if conflict report not found
	 */
	delete(id: string): Promise<void>;
}
