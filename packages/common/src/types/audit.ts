/**
 * Audit logging types and utilities for cross-tenant access tracking.
 *
 * Used to log all admin/cross-tenant operations for compliance and security.
 *
 * @example
 * ```ts
 * import { AuditLogEntry, AuditAction } from "@engram/common/types";
 *
 * const entry: AuditLogEntry = {
 *   userId: "user_123",
 *   action: "CROSS_TENANT_QUERY",
 *   targetOrgId: "org_456",
 *   resourceType: "memory",
 *   resourceId: "mem_789",
 *   ipAddress: "192.168.1.1",
 *   userAgent: "Mozilla/5.0...",
 *   metadata: { query: "MATCH (n) RETURN n" },
 * };
 * ```
 *
 * @see docs/plans/multi-tenancy.md - 'Audit Logging' section
 */

/**
 * Audit action types for cross-tenant operations.
 */
export type AuditAction =
	| "CROSS_TENANT_QUERY" // Admin querying another org's data
	| "CROSS_TENANT_READ" // Admin reading another org's resource
	| "CROSS_TENANT_WRITE" // Admin modifying another org's resource
	| "CROSS_TENANT_DELETE" // Admin deleting another org's resource
	| "ORG_CREATE" // Organization created
	| "ORG_UPDATE" // Organization updated
	| "ORG_DELETE" // Organization deleted
	| "ORG_MEMBER_ADD" // Member added to organization
	| "ORG_MEMBER_REMOVE" // Member removed from organization
	| "ORG_ROLE_CHANGE" // Member role changed
	| "TOKEN_ISSUED" // OAuth token issued
	| "TOKEN_REVOKED" // OAuth token revoked
	| "ADMIN_IMPERSONATION"; // Admin acting as another user

/**
 * Resource types for audit logging.
 */
export type AuditResourceType =
	| "memory"
	| "session"
	| "turn"
	| "organization"
	| "user"
	| "token"
	| "graph";

/**
 * Audit log entry for cross-tenant operations.
 * Stored in PostgreSQL for compliance and security analysis.
 */
export interface AuditLogEntry {
	/** Unique identifier for this log entry */
	id?: string;
	/** User who performed the action */
	userId: string;
	/** User's organization ID (their own org) */
	userOrgId?: string;
	/** Action type being logged */
	action: AuditAction;
	/** Target organization ID (for cross-tenant operations) */
	targetOrgId?: string;
	/** Type of resource being accessed */
	resourceType?: AuditResourceType;
	/** ID of the specific resource */
	resourceId?: string;
	/** Client IP address */
	ipAddress?: string;
	/** Client user agent string */
	userAgent?: string;
	/** Additional context/metadata */
	metadata?: Record<string, unknown>;
	/** Timestamp of the action (defaults to now) */
	timestamp?: Date;
	/** Whether the action succeeded */
	success?: boolean;
	/** Error message if action failed */
	errorMessage?: string;
}

/**
 * Audit log filter options for querying logs.
 */
export interface AuditLogFilter {
	/** Filter by user ID */
	userId?: string;
	/** Filter by action type */
	action?: AuditAction | AuditAction[];
	/** Filter by target organization */
	targetOrgId?: string;
	/** Filter by resource type */
	resourceType?: AuditResourceType;
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
 * Create an audit log entry with defaults.
 *
 * @param entry - Partial entry with required fields
 * @returns Complete audit log entry
 */
export function createAuditEntry(entry: AuditLogEntry): AuditLogEntry {
	return {
		timestamp: new Date(),
		success: true,
		...entry,
	};
}

/**
 * Determine if an action is a cross-tenant operation.
 *
 * @param action - The audit action
 * @returns True if this is a cross-tenant action
 */
export function isCrossTenantAction(action: AuditAction): boolean {
	return action.startsWith("CROSS_TENANT_");
}

/**
 * Get severity level for an audit action.
 * Used for log filtering and alerting.
 *
 * @param action - The audit action
 * @returns Severity level (critical, high, medium, low)
 */
export function getActionSeverity(action: AuditAction): "critical" | "high" | "medium" | "low" {
	switch (action) {
		case "CROSS_TENANT_DELETE":
		case "ORG_DELETE":
		case "ADMIN_IMPERSONATION":
			return "critical";
		case "CROSS_TENANT_WRITE":
		case "ORG_MEMBER_REMOVE":
		case "TOKEN_REVOKED":
			return "high";
		case "CROSS_TENANT_QUERY":
		case "CROSS_TENANT_READ":
		case "ORG_CREATE":
		case "ORG_UPDATE":
		case "ORG_MEMBER_ADD":
		case "ORG_ROLE_CHANGE":
			return "medium";
		case "TOKEN_ISSUED":
		default:
			return "low";
	}
}
