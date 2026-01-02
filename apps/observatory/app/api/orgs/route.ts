/**
 * Organization Management API
 *
 * POST /api/orgs - Create a new organization
 * GET  /api/orgs - List organizations for the authenticated user
 */

import { generateOrgSlug, isValidOrgSlug } from "@engram/common";
import { apiError, apiSuccess } from "@lib/api-response";
import { getSession, UserRole } from "@lib/rbac";
import { Pool } from "pg";
import { ulid } from "ulid";

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
 * Create a new organization.
 * Requires authentication. Associates the user with the new org.
 */
export async function POST(request: Request) {
	const session = await getSession();
	if (!session?.user) {
		return apiError("Not authenticated", "UNAUTHORIZED", 401);
	}

	let body: { name: string; slug?: string };
	try {
		body = await request.json();
	} catch {
		return apiError("Invalid JSON body", "BAD_REQUEST", 400);
	}

	const { name, slug: providedSlug } = body;

	if (!name || typeof name !== "string" || name.trim().length === 0) {
		return apiError("Name is required", "VALIDATION_ERROR", 400);
	}

	if (name.length > 100) {
		return apiError("Name must be 100 characters or less", "VALIDATION_ERROR", 400);
	}

	// Generate or validate slug
	const slug = providedSlug || generateOrgSlug(name);

	if (!isValidOrgSlug(slug)) {
		return apiError(
			"Slug must be lowercase alphanumeric with hyphens, 1-32 characters",
			"VALIDATION_ERROR",
			400,
		);
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		// Check slug uniqueness
		const existing = await client.query<{ id: string }>(
			"SELECT id FROM organizations WHERE slug = $1",
			[slug],
		);
		if (existing.rows.length > 0) {
			await client.query("ROLLBACK");
			return apiError("Organization slug already exists", "CONFLICT", 409);
		}

		// Create organization
		const orgId = ulid();
		const result = await client.query<OrganizationRow>(
			`INSERT INTO organizations (id, slug, name)
			 VALUES ($1, $2, $3)
			 RETURNING id, slug, name, created_at, updated_at`,
			[orgId, slug, name.trim()],
		);

		// Associate user with organization
		await client.query('UPDATE "user" SET org_id = $1 WHERE id = $2', [orgId, session.user.id]);

		await client.query("COMMIT");

		const org = result.rows[0];
		return apiSuccess(formatOrganization(org), 201);
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Error creating organization:", error);
		return apiError("Failed to create organization", "INTERNAL_ERROR", 500);
	} finally {
		client.release();
	}
}

/**
 * List organizations for the authenticated user.
 * Admin users can list all organizations.
 */
export async function GET(request: Request) {
	const session = await getSession();
	if (!session?.user) {
		return apiError("Not authenticated", "UNAUTHORIZED", 401);
	}

	const { searchParams } = new URL(request.url);
	const limit = Math.min(Number.parseInt(searchParams.get("limit") || "50", 10), 100);
	const offset = Number.parseInt(searchParams.get("offset") || "0", 10);
	const all = searchParams.get("all") === "true";

	try {
		let result: { rows: OrganizationRow[]; rowCount: number | null };

		// Admin can list all organizations if ?all=true
		const isAdmin = session.user.role === UserRole.ADMIN;
		if (all && isAdmin) {
			result = await pool.query<OrganizationRow>(
				`SELECT id, slug, name, created_at, updated_at
				 FROM organizations
				 ORDER BY created_at DESC
				 LIMIT $1 OFFSET $2`,
				[limit, offset],
			);
		} else {
			// Regular users see only their organization
			result = await pool.query<OrganizationRow>(
				`SELECT o.id, o.slug, o.name, o.created_at, o.updated_at
				 FROM organizations o
				 JOIN "user" u ON u.org_id = o.id
				 WHERE u.id = $1
				 ORDER BY o.created_at DESC
				 LIMIT $2 OFFSET $3`,
				[session.user.id, limit, offset],
			);
		}

		const organizations = result.rows.map(formatOrganization);

		return apiSuccess({
			organizations,
			pagination: {
				limit,
				offset,
				count: organizations.length,
			},
		});
	} catch (error) {
		console.error("Error listing organizations:", error);
		return apiError("Failed to list organizations", "INTERNAL_ERROR", 500);
	}
}
