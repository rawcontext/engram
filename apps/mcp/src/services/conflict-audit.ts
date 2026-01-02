import type {
	ConflictAuditEntry,
	ConflictDecisionOutcome,
	ConflictDecisionSource,
	ConflictRelation,
	ConflictSuggestedAction,
} from "@engram/common/types";
import { truncateForPreview } from "@engram/common/types";
import type { Logger } from "@engram/logger";
import { ulid } from "ulid";

/**
 * Context for audit logging.
 */
export interface AuditContext {
	sessionId?: string;
	project?: string;
	orgId?: string;
}

/**
 * Parameters for logging a conflict decision.
 */
export interface LogConflictDecisionParams {
	newMemory: {
		id?: string;
		content: string;
		type: string;
	};
	conflictingMemory: {
		id: string;
		content: string;
		type: string;
	};
	relation: ConflictRelation;
	confidence: number;
	reasoning: string;
	suggestedAction: ConflictSuggestedAction;
	decisionSource: ConflictDecisionSource;
	outcome: ConflictDecisionOutcome;
	elicitationAvailable: boolean;
	success?: boolean;
	errorMessage?: string;
}

/**
 * Service for auditing memory conflict decisions.
 *
 * Provides structured logging for all conflict detection and resolution actions,
 * enabling compliance tracking, debugging, and analytics.
 *
 * Logs are emitted via the structured logger with a dedicated "audit" component
 * and can be filtered/aggregated by standard log infrastructure.
 */
export class ConflictAuditService {
	private logger: Logger;
	private context: AuditContext;

	constructor(logger: Logger, context: AuditContext = {}) {
		this.logger = logger.child({ component: "conflict-audit" });
		this.context = context;
	}

	/**
	 * Update the audit context (e.g., when session changes).
	 */
	setContext(context: Partial<AuditContext>): void {
		this.context = { ...this.context, ...context };
	}

	/**
	 * Log a conflict decision with full context.
	 *
	 * This is the main entry point for audit logging. It creates a structured
	 * audit entry and emits it via the logger.
	 */
	logConflictDecision(params: LogConflictDecisionParams): ConflictAuditEntry {
		const entry: ConflictAuditEntry = {
			id: ulid(),
			timestamp: new Date(),
			sessionId: this.context.sessionId,
			project: this.context.project,
			orgId: this.context.orgId,
			newMemoryId: params.newMemory.id,
			newMemoryPreview: truncateForPreview(params.newMemory.content),
			newMemoryType: params.newMemory.type,
			conflictingMemoryId: params.conflictingMemory.id,
			conflictingMemoryPreview: truncateForPreview(params.conflictingMemory.content),
			conflictingMemoryType: params.conflictingMemory.type,
			relation: params.relation,
			confidence: params.confidence,
			reasoning: params.reasoning,
			suggestedAction: params.suggestedAction,
			decisionSource: params.decisionSource,
			outcome: params.outcome,
			elicitationAvailable: params.elicitationAvailable,
			success: params.success ?? true,
			errorMessage: params.errorMessage,
		};

		// Emit structured audit log at info level
		this.logger.info(
			{
				auditType: "conflict_decision",
				auditId: entry.id,
				sessionId: entry.sessionId,
				project: entry.project,
				orgId: entry.orgId,
				newMemoryId: entry.newMemoryId,
				newMemoryType: entry.newMemoryType,
				conflictingMemoryId: entry.conflictingMemoryId,
				conflictingMemoryType: entry.conflictingMemoryType,
				relation: entry.relation,
				confidence: entry.confidence,
				suggestedAction: entry.suggestedAction,
				decisionSource: entry.decisionSource,
				outcome: entry.outcome,
				elicitationAvailable: entry.elicitationAvailable,
				success: entry.success,
			},
			`Conflict decision: ${entry.relation} → ${entry.outcome} (${entry.decisionSource})`,
		);

		// Log detailed reasoning at debug level
		this.logger.debug(
			{
				auditId: entry.id,
				reasoning: entry.reasoning,
				newMemoryPreview: entry.newMemoryPreview,
				conflictingMemoryPreview: entry.conflictingMemoryPreview,
			},
			"Conflict decision details",
		);

		return entry;
	}

	/**
	 * Log when user confirms a conflict resolution via elicitation.
	 */
	logUserConfirmed(
		params: Omit<LogConflictDecisionParams, "decisionSource" | "outcome">,
	): ConflictAuditEntry {
		return this.logConflictDecision({
			...params,
			decisionSource: "user_confirmed",
			outcome: "invalidate_old",
		});
	}

	/**
	 * Log when user declines a conflict resolution via elicitation.
	 */
	logUserDeclined(
		params: Omit<LogConflictDecisionParams, "decisionSource" | "outcome">,
	): ConflictAuditEntry {
		return this.logConflictDecision({
			...params,
			decisionSource: "user_declined",
			outcome: "keep_both",
		});
	}

	/**
	 * Log when conflict resolution is auto-applied (no elicitation available).
	 */
	logAutoApplied(
		params: Omit<LogConflictDecisionParams, "decisionSource" | "elicitationAvailable">,
	): ConflictAuditEntry {
		return this.logConflictDecision({
			...params,
			decisionSource: "auto_applied",
			elicitationAvailable: false,
		});
	}

	/**
	 * Log when a duplicate is detected and new memory is skipped.
	 */
	logDuplicateDetected(
		params: Omit<LogConflictDecisionParams, "decisionSource" | "outcome" | "suggestedAction">,
	): ConflictAuditEntry {
		return this.logConflictDecision({
			...params,
			suggestedAction: "skip_new",
			decisionSource: "duplicate_detected",
			outcome: "skip_new",
		});
	}

	/**
	 * Log when classification fails and default is applied.
	 */
	logClassificationFailed(
		newMemory: { id?: string; content: string; type: string },
		conflictingMemory: { id: string; content: string; type: string },
		error: string,
	): ConflictAuditEntry {
		return this.logConflictDecision({
			newMemory,
			conflictingMemory,
			relation: "independent",
			confidence: 0.5,
			reasoning: `Classification failed: ${error}`,
			suggestedAction: "keep_both",
			decisionSource: "classification_failed",
			outcome: "keep_both",
			elicitationAvailable: false,
			success: false,
			errorMessage: error,
		});
	}
}
