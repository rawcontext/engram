/**
 * Audit logging types for memory conflict decisions.
 *
 * Tracks all conflict detection, user elicitation, and resolution actions
 * for compliance, debugging, and analytics.
 *
 * @example
 * ```ts
 * import { ConflictAuditEntry, ConflictDecisionOutcome } from "@engram/common/types";
 *
 * const entry: ConflictAuditEntry = {
 *   newMemoryId: "mem_new_123",
 *   conflictingMemoryId: "mem_old_456",
 *   relation: "supersedes",
 *   decision: "invalidate_old",
 *   decisionSource: "user_confirmed",
 *   confidence: 0.92,
 *   reasoning: "New preference replaces outdated setting",
 * };
 * ```
 */

import type { ConflictRelation, ConflictSuggestedAction } from "./conflict";

/**
 * How the conflict decision was made.
 */
export type ConflictDecisionSource =
	| "user_confirmed" // User explicitly confirmed via elicitation
	| "user_declined" // User explicitly declined via elicitation
	| "auto_applied" // Auto-applied (no elicitation available)
	| "classification_failed" // LLM classification failed, default applied
	| "duplicate_detected"; // Duplicate detected, skipped automatically

/**
 * The outcome of a conflict resolution.
 */
export type ConflictDecisionOutcome =
	| "invalidate_old" // Old memory was invalidated (vt_end set)
	| "skip_new" // New memory was not stored (duplicate)
	| "keep_both" // Both memories kept (independent/augments)
	| "merge"; // Memories were merged (future feature);

/**
 * Audit log entry for a single conflict decision.
 */
export interface ConflictAuditEntry {
	/** Unique identifier for this audit entry */
	id?: string;

	/** Timestamp of the decision */
	timestamp: Date;

	/** Session ID where the conflict occurred */
	sessionId?: string;

	/** Project context */
	project?: string;

	/** Organization ID (for multi-tenant) */
	orgId?: string;

	/** ID of the new memory being stored */
	newMemoryId?: string;

	/** Content preview of the new memory (truncated) */
	newMemoryPreview: string;

	/** Type of the new memory */
	newMemoryType: string;

	/** ID of the conflicting existing memory */
	conflictingMemoryId: string;

	/** Content preview of the conflicting memory (truncated) */
	conflictingMemoryPreview: string;

	/** Type of the conflicting memory */
	conflictingMemoryType: string;

	/** Detected relationship type */
	relation: ConflictRelation;

	/** LLM confidence in the classification [0, 1] */
	confidence: number;

	/** LLM reasoning for the classification */
	reasoning: string;

	/** The suggested action from conflict detection */
	suggestedAction: ConflictSuggestedAction;

	/** How the decision was made */
	decisionSource: ConflictDecisionSource;

	/** The actual outcome applied */
	outcome: ConflictDecisionOutcome;

	/** Whether elicitation was available */
	elicitationAvailable: boolean;

	/** Whether the operation succeeded */
	success: boolean;

	/** Error message if operation failed */
	errorMessage?: string;
}

/**
 * Filter options for querying conflict audit logs.
 */
export interface ConflictAuditFilter {
	/** Filter by session ID */
	sessionId?: string;
	/** Filter by project */
	project?: string;
	/** Filter by organization */
	orgId?: string;
	/** Filter by relation type */
	relation?: ConflictRelation | ConflictRelation[];
	/** Filter by decision source */
	decisionSource?: ConflictDecisionSource | ConflictDecisionSource[];
	/** Filter by outcome */
	outcome?: ConflictDecisionOutcome | ConflictDecisionOutcome[];
	/** Filter by date range (start) */
	startDate?: Date;
	/** Filter by date range (end) */
	endDate?: Date;
	/** Maximum results to return */
	limit?: number;
	/** Offset for pagination */
	offset?: number;
}

/**
 * Summary statistics for conflict audit logs.
 */
export interface ConflictAuditStats {
	/** Total conflicts detected */
	totalConflicts: number;
	/** Conflicts by relation type */
	byRelation: Record<ConflictRelation, number>;
	/** Conflicts by decision source */
	byDecisionSource: Record<ConflictDecisionSource, number>;
	/** Conflicts by outcome */
	byOutcome: Record<ConflictDecisionOutcome, number>;
	/** Average LLM confidence */
	averageConfidence: number;
	/** User confirmation rate (when elicitation available) */
	userConfirmationRate: number;
}

/**
 * Truncate content for preview in audit logs.
 */
export function truncateForPreview(content: string, maxLength = 100): string {
	if (content.length <= maxLength) {
		return content;
	}
	return `${content.slice(0, maxLength - 3)}...`;
}
