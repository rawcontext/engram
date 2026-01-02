/**
 * Audit logging client for API service.
 *
 * Logs cross-tenant operations to PostgreSQL for compliance.
 * Uses a dedicated connection pool for audit logs.
 */

import { randomUUID } from "node:crypto";
import type { AuditLogEntry } from "@engram/common";
import type { Logger } from "@engram/logger";
import pg from "pg";

const { Pool } = pg;

/**
 * Audit logging client for cross-tenant operations.
 */
export class AuditClient {
	private pool: pg.Pool | null = null;
	private logger: Logger;
	private tableCreated = false;
	private enabled: boolean;

	constructor(options: { logger: Logger; databaseUrl?: string }) {
		this.logger = options.logger;
		this.enabled = !!options.databaseUrl;

		if (options.databaseUrl) {
			this.pool = new Pool({
				connectionString: options.databaseUrl,
				max: 5, // Small pool just for audit logging
				idleTimeoutMillis: 30000,
				connectionTimeoutMillis: 5000,
			});
		} else {
			this.logger.warn("Audit logging disabled: AUTH_DATABASE_URL not configured");
		}
	}

	/**
	 * Create the audit_logs table if it doesn't exist.
	 */
	private async ensureTable(): Promise<void> {
		if (!this.pool || this.tableCreated) return;

		try {
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

				CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
				CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
				CREATE INDEX IF NOT EXISTS idx_audit_logs_target_org ON audit_logs(target_org_id);
				CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
			`;

			await this.pool.query(createTableQuery);
			this.tableCreated = true;
		} catch (error) {
			this.logger.error({ error }, "Failed to create audit_logs table");
		}
	}

	/**
	 * Log an audit event.
	 */
	async log(entry: AuditLogEntry): Promise<void> {
		if (!this.pool || !this.enabled) {
			// Log to console as fallback
			this.logger.info({ audit: entry }, "Audit event (DB not configured)");
			return;
		}

		try {
			await this.ensureTable();

			const id = entry.id || randomUUID();
			const timestamp = entry.timestamp || new Date();

			await this.pool.query(
				`INSERT INTO audit_logs (
					id, user_id, user_org_id, action, target_org_id,
					resource_type, resource_id, ip_address, user_agent,
					metadata, success, error_message, created_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
				[
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
				],
			);

			this.logger.debug({ auditId: id, action: entry.action }, "Audit log recorded");
		} catch (error) {
			// Don't fail the request if audit logging fails
			this.logger.error({ error, entry }, "Failed to record audit log");
		}
	}

	/**
	 * Log a cross-tenant query operation.
	 */
	async logCrossTenantQuery(params: {
		userId: string;
		userOrgId?: string;
		targetOrgId: string;
		query?: string;
		ipAddress?: string;
		userAgent?: string;
	}): Promise<void> {
		await this.log({
			userId: params.userId,
			userOrgId: params.userOrgId,
			action: "CROSS_TENANT_QUERY",
			targetOrgId: params.targetOrgId,
			resourceType: "graph",
			ipAddress: params.ipAddress,
			userAgent: params.userAgent,
			metadata: params.query ? { query: params.query } : undefined,
		});
	}

	/**
	 * Log a cross-tenant read operation.
	 */
	async logCrossTenantRead(params: {
		userId: string;
		userOrgId?: string;
		targetOrgId: string;
		resourceType: AuditLogEntry["resourceType"];
		resourceId?: string;
		ipAddress?: string;
		userAgent?: string;
	}): Promise<void> {
		await this.log({
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
	 * Close the database connection pool.
	 */
	async close(): Promise<void> {
		if (this.pool) {
			await this.pool.end();
			this.pool = null;
		}
	}
}
