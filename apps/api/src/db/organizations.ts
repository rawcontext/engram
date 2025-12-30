import type { PostgresClient } from "@engram/storage";

export interface Organization {
	id: string;
	slug: string;
	name: string;
	createdAt: Date;
	updatedAt: Date;
}

interface DbOrganization {
	id: string;
	slug: string;
	name: string;
	created_at: Date;
	updated_at: Date;
}

export interface CreateOrganizationInput {
	name: string;
	slug: string;
}

export interface UpdateOrganizationInput {
	name?: string;
	slug?: string;
}

/**
 * Repository for organization CRUD operations
 */
export class OrganizationRepository {
	constructor(private readonly db: PostgresClient) {}

	/**
	 * Create a new organization
	 */
	async create(id: string, input: CreateOrganizationInput): Promise<Organization> {
		const row = await this.db.queryOne<DbOrganization>(
			`
			INSERT INTO organizations (id, name, slug)
			VALUES ($1, $2, $3)
			RETURNING id, slug, name, created_at, updated_at
			`,
			[id, input.name, input.slug],
		);

		if (!row) {
			throw new Error("Failed to create organization");
		}

		return this.mapFromDb(row);
	}

	/**
	 * Get organization by ID
	 */
	async getById(id: string): Promise<Organization | null> {
		const row = await this.db.queryOne<DbOrganization>(
			`
			SELECT id, slug, name, created_at, updated_at
			FROM organizations
			WHERE id = $1
			`,
			[id],
		);

		return row ? this.mapFromDb(row) : null;
	}

	/**
	 * Get organization by slug
	 */
	async getBySlug(slug: string): Promise<Organization | null> {
		const row = await this.db.queryOne<DbOrganization>(
			`
			SELECT id, slug, name, created_at, updated_at
			FROM organizations
			WHERE slug = $1
			`,
			[slug],
		);

		return row ? this.mapFromDb(row) : null;
	}

	/**
	 * List all organizations for a user (owner or member)
	 */
	async listForUser(userId: string): Promise<Organization[]> {
		const rows = await this.db.queryMany<DbOrganization>(
			`
			SELECT DISTINCT o.id, o.slug, o.name, o.created_at, o.updated_at
			FROM organizations o
			WHERE o.id IN (
				SELECT org_id FROM "user" WHERE id = $1 AND org_id IS NOT NULL
			)
			ORDER BY o.created_at DESC
			`,
			[userId],
		);

		return rows.map((row) => this.mapFromDb(row));
	}

	/**
	 * Update an organization
	 */
	async update(id: string, input: UpdateOrganizationInput): Promise<Organization | null> {
		const updates: string[] = [];
		const values: (string | number)[] = [];
		let paramIndex = 1;

		if (input.name !== undefined) {
			updates.push(`name = $${paramIndex++}`);
			values.push(input.name);
		}

		if (input.slug !== undefined) {
			updates.push(`slug = $${paramIndex++}`);
			values.push(input.slug);
		}

		if (updates.length === 0) {
			return this.getById(id);
		}

		values.push(id);

		const row = await this.db.queryOne<DbOrganization>(
			`
			UPDATE organizations
			SET ${updates.join(", ")}
			WHERE id = $${paramIndex}
			RETURNING id, slug, name, created_at, updated_at
			`,
			values,
		);

		return row ? this.mapFromDb(row) : null;
	}

	/**
	 * Delete an organization
	 */
	async delete(id: string): Promise<boolean> {
		const result = await this.db.query(
			`
			DELETE FROM organizations
			WHERE id = $1
			`,
			[id],
		);

		return (result.rowCount ?? 0) > 0;
	}

	/**
	 * Check if a user has access to an organization (owner or member)
	 */
	async hasAccess(userId: string, orgId: string): Promise<boolean> {
		const row = await this.db.queryOne<{ has_access: boolean }>(
			`
			SELECT EXISTS (
				SELECT 1 FROM "user"
				WHERE id = $1 AND org_id = $2
			) AS has_access
			`,
			[userId, orgId],
		);

		return row?.has_access ?? false;
	}

	/**
	 * Map database row to Organization
	 */
	private mapFromDb(row: DbOrganization): Organization {
		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
