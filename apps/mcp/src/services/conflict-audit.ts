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
import type { IEngramClient, TenantContext } from "./interfaces";

/**
 * Context for audit logging.
 */
export interface AuditContext {
	sessionId?: string;
	project?: string;
	orgId?: string;
	orgSlug?: string;
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
 *
 * Additionally, persists ConflictDecision nodes to the graph for durable audit trail.
 */
export class ConflictAuditService {
	private logger: Logger;
	private context: AuditContext;
	private cloudClient?: IEngramClient;

	constructor(logger: Logger, context: AuditContext = {}, cloudClient?: IEngramClient) {
		this.logger = logger.child({ component: "conflict-audit" });
		this.context = context;
		this.cloudClient = cloudClient;
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
	 * audit entry, emits it via the logger, and persists to the graph.
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

		// Persist to graph (async, don't block return)
		this.persistToGraph(entry, params).catch((error) => {
			this.logger.warn({ error, auditId: entry.id }, "Failed to persist audit entry to graph");
		});

		return entry;
	}

	/**
	 * Persist the audit entry to the graph as a ConflictDecision node.
	 * Creates edges to both the new and existing memory nodes.
	 */
	private async persistToGraph(
		entry: ConflictAuditEntry,
		params: LogConflictDecisionParams,
	): Promise<void> {
		if (!this.cloudClient) {
			this.logger.debug({ auditId: entry.id }, "No cloud client, skipping graph persistence");
			return;
		}

		const tenant: TenantContext | undefined =
			this.context.orgId && this.context.orgSlug
				? { orgId: this.context.orgId, orgSlug: this.context.orgSlug }
				: undefined;

		// Map decision source to model used
		const modelUsed = this.getModelUsed(params.decisionSource);

		// Map outcome to action taken
		const actionTaken = this.mapOutcomeToAction(params.outcome);

		const now = Date.now();

		// Create ConflictDecision node
		await this.cloudClient.query(
			`CREATE (cd:ConflictDecision {
				id: $id,
				newMemoryId: $newMemoryId,
				existingMemoryId: $existingMemoryId,
				relation: $relation,
				reason: $reason,
				modelUsed: $modelUsed,
				userConfirmed: $userConfirmed,
				actionTaken: $actionTaken,
				timestamp: $timestamp,
				orgId: $orgId,
				vt_start: $now,
				vt_end: 9223372036854775807,
				tt_start: $now,
				tt_end: 9223372036854775807
			})`,
			{
				id: entry.id,
				newMemoryId: params.newMemory.id ?? "",
				existingMemoryId: params.conflictingMemory.id,
				relation: params.relation,
				reason: params.reasoning,
				modelUsed,
				userConfirmed: params.decisionSource === "user_confirmed",
				actionTaken,
				timestamp: now,
				orgId: this.context.orgId ?? "",
				now,
			},
			tenant,
		);

		// Create DECIDED_ON edge from ConflictDecision to existing Memory
		if (params.conflictingMemory.id) {
			await this.cloudClient.query(
				`MATCH (cd:ConflictDecision {id: $decisionId}), (m:Memory {id: $memoryId})
				 WHERE cd.tt_end > timestamp() AND m.tt_end > timestamp()
				 CREATE (cd)-[:DECIDED_ON {role: 'existing', vt_start: $now, vt_end: 9223372036854775807, tt_start: $now, tt_end: 9223372036854775807}]->(m)`,
				{
					decisionId: entry.id,
					memoryId: params.conflictingMemory.id,
					now,
				},
				tenant,
			);
		}

		// Create DECIDED_ON edge from ConflictDecision to new Memory (if ID available)
		if (params.newMemory.id) {
			await this.cloudClient.query(
				`MATCH (cd:ConflictDecision {id: $decisionId}), (m:Memory {id: $memoryId})
				 WHERE cd.tt_end > timestamp() AND m.tt_end > timestamp()
				 CREATE (cd)-[:DECIDED_ON {role: 'new', vt_start: $now, vt_end: 9223372036854775807, tt_start: $now, tt_end: 9223372036854775807}]->(m)`,
				{
					decisionId: entry.id,
					memoryId: params.newMemory.id,
					now,
				},
				tenant,
			);
		}

		this.logger.debug({ auditId: entry.id }, "Persisted conflict decision to graph");
	}

	/**
	 * Map decision source to model identifier.
	 */
	private getModelUsed(decisionSource: ConflictDecisionSource): string {
		switch (decisionSource) {
			case "user_confirmed":
			case "user_declined":
				return "mcp-elicitation";
			case "auto_applied":
			case "duplicate_detected":
				return "gemini-3-flash-preview";
			case "classification_failed":
				return "classification-failed";
			default:
				return "unknown";
		}
	}

	/**
	 * Map outcome to action taken for graph storage.
	 */
	private mapOutcomeToAction(outcome: ConflictDecisionOutcome): string {
		switch (outcome) {
			case "invalidate_old":
				return "invalidate_old";
			case "skip_new":
				return "skip_new";
			case "keep_both":
				return "keep_both";
			default:
				return "keep_both";
		}
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
