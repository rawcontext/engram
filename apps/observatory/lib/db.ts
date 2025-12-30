/**
 * Database utilities for Observatory
 *
 * Provides tenant context management for PostgreSQL Row-Level Security (RLS).
 * The tenant context is set via session variables that RLS policies can reference.
 *
 * @example
 * ```ts
 * import { pool, setTenantContext, clearTenantContext, withTenantContext } from "@lib/db";
 *
 * // Option 1: Manual context management
 * const client = await pool.connect();
 * try {
 *   await setTenantContext(client, "org_123");
 *   const result = await client.query("SELECT * FROM memories");
 *   // RLS automatically filters to org_123
 * } finally {
 *   await clearTenantContext(client);
 *   client.release();
 * }
 *
 * // Option 2: Automatic context management
 * const result = await withTenantContext("org_123", async (client) => {
 *   return await client.query("SELECT * FROM memories");
 * });
 * ```
 *
 * @see docs/plans/multi-tenancy.md - 'Setting Tenant Context at Runtime' section
 */

import { Pool, type PoolClient } from "pg";

/**
 * PostgreSQL connection pool for Observatory.
 * Shared across all database operations.
 */
export const pool = new Pool({
	connectionString: process.env.AUTH_DATABASE_URL,
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 10000,
});

/**
 * Session variable names for tenant context.
 * These are used by RLS policies to filter data.
 */
export const TenantSessionVars = {
	/** Current organization ID */
	ORG_ID: "app.current_org_id",
	/** Current user ID */
	USER_ID: "app.current_user_id",
} as const;

/**
 * Set the tenant context for the current database session.
 * This must be called before any RLS-protected queries.
 *
 * Uses PostgreSQL's set_config() with is_local=true, which means:
 * - The setting only applies to the current transaction
 * - It's automatically cleared when the transaction ends
 * - It's safe for connection pooling
 *
 * @param client - PostgreSQL client from pool
 * @param orgId - Organization ID to set as current tenant
 * @param userId - Optional user ID for additional context
 *
 * @example
 * ```ts
 * const client = await pool.connect();
 * await setTenantContext(client, "org_01ABC123");
 * // All subsequent queries are scoped to this org
 * ```
 *
 * @see https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET
 */
export async function setTenantContext(
	client: PoolClient,
	orgId: string,
	userId?: string,
): Promise<void> {
	// set_config(setting_name, value, is_local)
	// is_local=true means the setting applies only to the current transaction
	await client.query("SELECT set_config($1, $2, true)", [TenantSessionVars.ORG_ID, orgId]);

	if (userId) {
		await client.query("SELECT set_config($1, $2, true)", [TenantSessionVars.USER_ID, userId]);
	}
}

/**
 * Clear the tenant context for the current database session.
 * This is called automatically when using withTenantContext().
 *
 * Note: With is_local=true in set_config, context is automatically
 * cleared at transaction end. This function is provided for explicit
 * cleanup when needed.
 *
 * @param client - PostgreSQL client from pool
 */
export async function clearTenantContext(client: PoolClient): Promise<void> {
	await client.query("SELECT set_config($1, '', true)", [TenantSessionVars.ORG_ID]);
	await client.query("SELECT set_config($1, '', true)", [TenantSessionVars.USER_ID]);
}

/**
 * Get the current tenant context from the session.
 * Useful for debugging or verification.
 *
 * @param client - PostgreSQL client from pool
 * @returns Object with current orgId and userId, or null if not set
 */
export async function getTenantContextFromDb(
	client: PoolClient,
): Promise<{ orgId: string | null; userId: string | null }> {
	const result = await client.query<{ org_id: string | null; user_id: string | null }>(
		`SELECT
			current_setting($1, true) as org_id,
			current_setting($2, true) as user_id`,
		[TenantSessionVars.ORG_ID, TenantSessionVars.USER_ID],
	);

	const row = result.rows[0];
	return {
		orgId: row?.org_id || null,
		userId: row?.user_id || null,
	};
}

/**
 * Execute a function with tenant context set.
 * Automatically manages context lifecycle and connection release.
 *
 * This is the recommended way to execute tenant-scoped database operations.
 * It ensures:
 * - Context is set before operation
 * - Connection is released after operation
 * - Context is cleared on error
 *
 * @param orgId - Organization ID to set as current tenant
 * @param fn - Async function to execute with tenant context
 * @param userId - Optional user ID for additional context
 * @returns Result of the function
 *
 * @example
 * ```ts
 * const memories = await withTenantContext("org_123", async (client) => {
 *   const result = await client.query("SELECT * FROM memories WHERE type = $1", ["decision"]);
 *   return result.rows;
 * });
 * ```
 */
export async function withTenantContext<T>(
	orgId: string,
	fn: (client: PoolClient) => Promise<T>,
	userId?: string,
): Promise<T> {
	const client = await pool.connect();

	try {
		await setTenantContext(client, orgId, userId);
		return await fn(client);
	} finally {
		// Context is cleared by releasing connection back to pool
		// since we used is_local=true in set_config
		client.release();
	}
}

/**
 * Execute a function within a transaction with tenant context set.
 * Provides ACID guarantees in addition to tenant scoping.
 *
 * @param orgId - Organization ID to set as current tenant
 * @param fn - Async function to execute within transaction
 * @param userId - Optional user ID for additional context
 * @returns Result of the function
 *
 * @example
 * ```ts
 * await withTenantTransaction("org_123", async (client) => {
 *   await client.query("INSERT INTO memories (...) VALUES (...)");
 *   await client.query("INSERT INTO audit_log (...) VALUES (...)");
 *   // Both succeed or both fail
 * });
 * ```
 */
export async function withTenantTransaction<T>(
	orgId: string,
	fn: (client: PoolClient) => Promise<T>,
	userId?: string,
): Promise<T> {
	const client = await pool.connect();

	try {
		await client.query("BEGIN");
		await setTenantContext(client, orgId, userId);

		const result = await fn(client);

		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
