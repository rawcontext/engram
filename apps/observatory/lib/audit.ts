/**
 * Audit logging service for Observatory.
 *
 * Logs cross-tenant operations and admin actions to PostgreSQL for compliance.
 *
 * @example
 * ```ts
 * import { auditLog, logCrossTenantQuery } from "@lib/audit";
 *
 * // Log a cross-tenant query
 * await logCrossTenantQuery({
 *   userId: "user_123",
 *   userOrgId: "org_user",
 *   targetOrgId: "org_target",
 *   query: "MATCH (n) RETURN n",
 *   ipAddress: req.headers.get("x-forwarded-for"),
 *   userAgent: req.headers.get("user-agent"),
 * });
 *
 * // General audit log
 * await auditLog({
 *   userId: "user_123",
 *   action: "ORG_CREATE",
 *   resourceType: "organization",
 *   resourceId: "org_new",
 *   metadata: { name: "New Org" },
 * });
 * ```
 */

import { randomUUID } from "node:crypto";
import type { AuditAction, AuditLogEntry, AuditLogFilter } from "@engram/common";
import { pool } from "./db";

/**
 * Create the audit_logs table if it doesn't exist.
 * Called on first audit log write.
 */
async function ensureAuditTable(): Promise<void> {
	const createTableQuery = `
		CREATE TABLE IF NOT EXISTS audit_logs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id TEXT NOT NULL,
			user_org_id TEXT,
			action TEXT NOT NULL,
			target_org_id TEXT,
			resource_type TEXT,
			resource_id TEXT,
			ip_address TEXT,
			user_agent TEXT,
			metadata JSONB,
			success BOOLEAN DEFAULT true,
			error_message TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		);

		-- Index for common queries
		CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_target_org ON audit_logs(target_org_id);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_cross_tenant ON audit_logs(action)
			WHERE action LIKE 'CROSS_TENANT_%';
	`;

	await pool.query(createTableQuery);
}

// Track if table has been created
let tableCreated = false;

/**
 * Log an audit event to PostgreSQL.
 *
 * @param entry - Audit log entry
 * @returns The created entry with ID
 */
export async function auditLog(entry: AuditLogEntry): Promise<AuditLogEntry> {
	// Ensure table exists on first write
	if (!tableCreated) {
		await ensureAuditTable();
		tableCreated = true;
	}

	const id = entry.id || randomUUID();
	const timestamp = entry.timestamp || new Date();

	const insertQuery = `
		INSERT INTO audit_logs (
			id, user_id, user_org_id, action, target_org_id,
			resource_type, resource_id, ip_address, user_agent,
			metadata, success, error_message, created_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
		)
		RETURNING id, created_at
	`;

	const result = await pool.query(insertQuery, [
		id,
		entry.userId,
		entry.userOrgId || null,
		entry.action,
		entry.targetOrgId || null,
		entry.resourceType || null,
		entry.resourceId || null,
		entry.ipAddress || null,
		entry.userAgent || null,
		entry.metadata ? JSON.stringify(entry.metadata) : null,
		entry.success ?? true,
		entry.errorMessage || null,
		timestamp,
	]);

	return {
		...entry,
		id: result.rows[0].id,
		timestamp: result.rows[0].created_at,
	};
}

/**
 * Convenience function to log cross-tenant queries.
 */
export async function logCrossTenantQuery(params: {
	userId: string;
	userOrgId?: string;
	targetOrgId: string;
	query?: string;
	ipAddress?: string;
	userAgent?: string;
	success?: boolean;
	errorMessage?: string;
}): Promise<AuditLogEntry> {
	return auditLog({
		userId: params.userId,
		userOrgId: params.userOrgId,
		action: "CROSS_TENANT_QUERY",
		targetOrgId: params.targetOrgId,
		resourceType: "graph",
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
		metadata: params.query ? { query: params.query } : undefined,
		success: params.success,
		errorMessage: params.errorMessage,
	});
}

/**
 * Convenience function to log cross-tenant reads.
 */
export async function logCrossTenantRead(params: {
	userId: string;
	userOrgId?: string;
	targetOrgId: string;
	resourceType: AuditLogEntry["resourceType"];
	resourceId?: string;
	ipAddress?: string;
	userAgent?: string;
}): Promise<AuditLogEntry> {
	return auditLog({
		userId: params.userId,
		userOrgId: params.userOrgId,
		action: "CROSS_TENANT_READ",
		targetOrgId: params.targetOrgId,
		resourceType: params.resourceType,
		resourceId: params.resourceId,
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Convenience function to log organization operations.
 */
export async function logOrgOperation(params: {
	userId: string;
	userOrgId?: string;
	action: "ORG_CREATE" | "ORG_UPDATE" | "ORG_DELETE";
	targetOrgId: string;
	metadata?: Record<string, unknown>;
	ipAddress?: string;
	userAgent?: string;
}): Promise<AuditLogEntry> {
	return auditLog({
		userId: params.userId,
		userOrgId: params.userOrgId,
		action: params.action,
		targetOrgId: params.targetOrgId,
		resourceType: "organization",
		resourceId: params.targetOrgId,
		metadata: params.metadata,
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Query audit logs with filters.
 *
 * @param filter - Query filters
 * @returns Matching audit log entries
 */
export async function queryAuditLogs(filter: AuditLogFilter): Promise<AuditLogEntry[]> {
	// Ensure table exists
	if (!tableCreated) {
		await ensureAuditTable();
		tableCreated = true;
	}

	const conditions: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (filter.userId) {
		conditions.push(`user_id = $${paramIndex++}`);
		params.push(filter.userId);
	}

	if (filter.action) {
		if (Array.isArray(filter.action)) {
			conditions.push(`action = ANY($${paramIndex++})`);
			params.push(filter.action);
		} else {
			conditions.push(`action = $${paramIndex++}`);
			params.push(filter.action);
		}
	}

	if (filter.targetOrgId) {
		conditions.push(`target_org_id = $${paramIndex++}`);
		params.push(filter.targetOrgId);
	}

	if (filter.resourceType) {
		conditions.push(`resource_type = $${paramIndex++}`);
		params.push(filter.resourceType);
	}

	if (filter.startDate) {
		conditions.push(`created_at >= $${paramIndex++}`);
		params.push(filter.startDate);
	}

	if (filter.endDate) {
		conditions.push(`created_at <= $${paramIndex++}`);
		params.push(filter.endDate);
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = filter.limit || 100;
	const offset = filter.offset || 0;

	const query = `
		SELECT
			id, user_id, user_org_id, action, target_org_id,
			resource_type, resource_id, ip_address, user_agent,
			metadata, success, error_message, created_at
		FROM audit_logs
		${whereClause}
		ORDER BY created_at DESC
		LIMIT $${paramIndex++} OFFSET $${paramIndex}
	`;

	params.push(limit, offset);

	const result = await pool.query(query, params);

	return result.rows.map((row) => ({
		id: row.id,
		userId: row.user_id,
		userOrgId: row.user_org_id,
		action: row.action as AuditAction,
		targetOrgId: row.target_org_id,
		resourceType: row.resource_type,
		resourceId: row.resource_id,
		ipAddress: row.ip_address,
		userAgent: row.user_agent,
		metadata: row.metadata,
		success: row.success,
		errorMessage: row.error_message,
		timestamp: row.created_at,
	}));
}

/**
 * Get audit log statistics for dashboard display.
 */
export async function getAuditStats(
	startDate?: Date,
	endDate?: Date,
): Promise<{
	totalEvents: number;
	crossTenantEvents: number;
	eventsByAction: Record<string, number>;
	eventsByDay: Array<{ date: string; count: number }>;
}> {
	// Ensure table exists
	if (!tableCreated) {
		await ensureAuditTable();
		tableCreated = true;
	}

	const params: unknown[] = [];
	let whereClause = "";

	if (startDate || endDate) {
		const conditions: string[] = [];
		if (startDate) {
			conditions.push(`created_at >= $${params.length + 1}`);
			params.push(startDate);
		}
		if (endDate) {
			conditions.push(`created_at <= $${params.length + 1}`);
			params.push(endDate);
		}
		whereClause = `WHERE ${conditions.join(" AND ")}`;
	}

	const statsQuery = `
		SELECT
			COUNT(*)::int as total,
			COUNT(*) FILTER (WHERE action LIKE 'CROSS_TENANT_%')::int as cross_tenant,
			jsonb_object_agg(action, action_count) as by_action
		FROM (
			SELECT action, COUNT(*)::int as action_count
			FROM audit_logs
			${whereClause}
			GROUP BY action
		) action_counts,
		(SELECT COUNT(*)::int as total,
		        COUNT(*) FILTER (WHERE action LIKE 'CROSS_TENANT_%')::int as cross_tenant
		 FROM audit_logs ${whereClause}) totals
	`;

	const dailyQuery = `
		SELECT
			DATE(created_at)::text as date,
			COUNT(*)::int as count
		FROM audit_logs
		${whereClause}
		GROUP BY DATE(created_at)
		ORDER BY date DESC
		LIMIT 30
	`;

	const [statsResult, dailyResult] = await Promise.all([
		pool.query(statsQuery, params),
		pool.query(dailyQuery, params),
	]);

	const stats = statsResult.rows[0];

	return {
		totalEvents: stats?.total || 0,
		crossTenantEvents: stats?.cross_tenant || 0,
		eventsByAction: stats?.by_action || {},
		eventsByDay: dailyResult.rows,
	};
}
