/**
 * Organization Management API - Single Organization Operations
 *
 * GET    /api/orgs/[id] - Get organization details
 * PATCH  /api/orgs/[id] - Update organization
 * DELETE /api/orgs/[id] - Delete organization
 */

import { isValidOrgSlug } from "@engram/common";
import { apiError, apiSuccess } from "@lib/api-response";
import { getSession, UserRole } from "@lib/rbac";
import type { NextRequest } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
	connectionString: process.env.AUTH_DATABASE_URL,
});

interface OrganizationRow {
	id: string;
	slug: string;
	name: string;
	created_at: Date;
	updated_at: Date;
}

interface OrganizationResponse {
	id: string;
	slug: string;
	name: string;
	createdAt: string;
	updatedAt: string;
}

function formatOrganization(row: OrganizationRow): OrganizationResponse {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString(),
	};
}

/**
 * Check if user has access to organization.
 * Admin users have access to all organizations.
 */
async function hasAccess(userId: string, orgId: string, isAdmin: boolean): Promise<boolean> {
	if (isAdmin) return true;

	const result = await pool.query<{ has_access: boolean }>(
		`SELECT EXISTS (
			SELECT 1 FROM "user" WHERE id = $1 AND org_id = $2
		) AS has_access`,
		[userId, orgId],
	);

	return result.rows[0]?.has_access ?? false;
}

type RouteParams = Promise<{ id: string }>;

/**
 * Get organization details.
 */
export async function GET(_request: NextRequest, context: { params: RouteParams }) {
	const { id: orgId } = await context.params;

	const session = await getSession();
	if (!session?.user) {
		return apiError("Not authenticated", "UNAUTHORIZED", 401);
	}

	const isAdmin = session.user.role === UserRole.ADMIN;
	const canAccess = await hasAccess(session.user.id, orgId, isAdmin);

	if (!canAccess) {
		return apiError("Organization not found", "NOT_FOUND", 404);
	}

	try {
		const result = await pool.query<OrganizationRow>(
			`SELECT id, slug, name, created_at, updated_at
			 FROM organizations
			 WHERE id = $1`,
			[orgId],
		);

		if (result.rows.length === 0) {
			return apiError("Organization not found", "NOT_FOUND", 404);
		}

		const org = result.rows[0];

		// Get member count
		const memberCountResult = await pool.query<{ count: string }>(
			'SELECT COUNT(*) as count FROM "user" WHERE org_id = $1',
			[orgId],
		);
		const memberCount = Number.parseInt(memberCountResult.rows[0]?.count || "0", 10);

		return apiSuccess({
			...formatOrganization(org),
			memberCount,
		});
	} catch (error) {
		console.error("Error getting organization:", error);
		return apiError("Failed to get organization", "INTERNAL_ERROR", 500);
	}
}

/**
 * Update organization.
 * Only admin users or org owners can update.
 */
export async function PATCH(request: NextRequest, context: { params: RouteParams }) {
	const { id: orgId } = await context.params;

	const session = await getSession();
	if (!session?.user) {
		return apiError("Not authenticated", "UNAUTHORIZED", 401);
	}

	const isAdmin = session.user.role === UserRole.ADMIN;
	const canAccess = await hasAccess(session.user.id, orgId, isAdmin);

	if (!canAccess) {
		return apiError("Organization not found", "NOT_FOUND", 404);
	}

	let body: { name?: string; slug?: string };
	try {
		body = await request.json();
	} catch {
		return apiError("Invalid JSON body", "BAD_REQUEST", 400);
	}

	const { name, slug } = body;

	// Validate inputs
	if (name !== undefined) {
		if (typeof name !== "string" || name.trim().length === 0) {
			return apiError("Name cannot be empty", "VALIDATION_ERROR", 400);
		}
		if (name.length > 100) {
			return apiError("Name must be 100 characters or less", "VALIDATION_ERROR", 400);
		}
	}

	if (slug !== undefined) {
		if (!isValidOrgSlug(slug)) {
			return apiError(
				"Slug must be lowercase alphanumeric with hyphens, 1-32 characters",
				"VALIDATION_ERROR",
				400,
			);
		}
	}

	if (name === undefined && slug === undefined) {
		return apiError("No updates provided", "VALIDATION_ERROR", 400);
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		// Check slug uniqueness if changing
		if (slug) {
			const existing = await client.query<{ id: string }>(
				"SELECT id FROM organizations WHERE slug = $1 AND id != $2",
				[slug, orgId],
			);
			if (existing.rows.length > 0) {
				await client.query("ROLLBACK");
				return apiError("Organization slug already exists", "CONFLICT", 409);
			}
		}

		// Build update query
		const updates: string[] = [];
		const values: (string | number)[] = [];
		let paramIndex = 1;

		if (name !== undefined) {
			updates.push(`name = $${paramIndex++}`);
			values.push(name.trim());
		}

		if (slug !== undefined) {
			updates.push(`slug = $${paramIndex++}`);
			values.push(slug);
		}

		values.push(orgId);

		const result = await client.query<OrganizationRow>(
			`UPDATE organizations
			 SET ${updates.join(", ")}
			 WHERE id = $${paramIndex}
			 RETURNING id, slug, name, created_at, updated_at`,
			values,
		);

		if (result.rows.length === 0) {
			await client.query("ROLLBACK");
			return apiError("Organization not found", "NOT_FOUND", 404);
		}

		await client.query("COMMIT");

		return apiSuccess(formatOrganization(result.rows[0]));
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Error updating organization:", error);
		return apiError("Failed to update organization", "INTERNAL_ERROR", 500);
	} finally {
		client.release();
	}
}

/**
 * Delete organization.
 * Only admin users can delete organizations.
 */
export async function DELETE(_request: NextRequest, context: { params: RouteParams }) {
	const { id: orgId } = await context.params;

	const session = await getSession();
	if (!session?.user) {
		return apiError("Not authenticated", "UNAUTHORIZED", 401);
	}

	// Only admins can delete organizations
	const isAdmin = session.user.role === UserRole.ADMIN;
	if (!isAdmin) {
		return apiError("Only administrators can delete organizations", "FORBIDDEN", 403);
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		// Unassign all users from the organization first
		await client.query('UPDATE "user" SET org_id = NULL WHERE org_id = $1', [orgId]);

		// Delete the organization
		const result = await client.query("DELETE FROM organizations WHERE id = $1", [orgId]);

		if ((result.rowCount ?? 0) === 0) {
			await client.query("ROLLBACK");
			return apiError("Organization not found", "NOT_FOUND", 404);
		}

		await client.query("COMMIT");

		return apiSuccess({ deleted: true });
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Error deleting organization:", error);
		return apiError("Failed to delete organization", "INTERNAL_ERROR", 500);
	} finally {
		client.release();
	}
}
