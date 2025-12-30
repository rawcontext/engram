import { generateOrgSlug, isValidOrgSlug } from "@engram/common";
import type { Logger } from "@engram/logger";
import { Hono } from "hono";
import { ulid } from "ulid";
import { z } from "zod";
import type { OrganizationRepository } from "../db/organizations";
import type { OAuthAuthContext } from "../middleware/auth";
import { requireScopes } from "../middleware/scopes";

type Env = {
	Variables: {
		auth: OAuthAuthContext;
	};
};

// Request schemas
const CreateOrganizationSchema = z.object({
	name: z.string().min(1).max(100),
	slug: z
		.string()
		.min(1)
		.max(32)
		.regex(/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]{1,2}$/, {
			message: "Slug must be lowercase alphanumeric with optional hyphens, 1-32 characters",
		})
		.optional(),
});

const UpdateOrganizationSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	slug: z
		.string()
		.min(1)
		.max(32)
		.regex(/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]{1,2}$/, {
			message: "Slug must be lowercase alphanumeric with optional hyphens, 1-32 characters",
		})
		.optional(),
});

export interface OrganizationRoutesOptions {
	organizationRepo: OrganizationRepository;
	logger: Logger;
}

export function createOrganizationRoutes(options: OrganizationRoutesOptions) {
	const { organizationRepo, logger } = options;
	const app = new Hono<Env>();

	// POST /v1/organizations - Create organization
	app.post("/", requireScopes("org:write"), async (c) => {
		try {
			const auth = c.get("auth");
			const body = await c.req.json();
			const parsed = CreateOrganizationSchema.safeParse(body);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			// Generate slug from name if not provided
			const slug = parsed.data.slug ?? generateOrgSlug(parsed.data.name);

			// Validate slug
			if (!isValidOrgSlug(slug)) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid organization slug format",
						},
					},
					400,
				);
			}

			// Check if slug already exists
			const existing = await organizationRepo.getBySlug(slug);
			if (existing) {
				return c.json(
					{
						success: false,
						error: {
							code: "CONFLICT",
							message: "Organization with this slug already exists",
						},
					},
					409,
				);
			}

			// Create organization
			const id = ulid();
			const organization = await organizationRepo.create(id, {
				name: parsed.data.name,
				slug,
			});

			logger.info(
				{
					orgId: organization.id,
					orgSlug: organization.slug,
					userId: auth.userId,
				},
				"Organization created",
			);

			return c.json(
				{
					success: true,
					data: { organization },
				},
				201,
			);
		} catch (error) {
			logger.error({ error }, "Error creating organization");
			throw error;
		}
	});

	// GET /v1/organizations - List user's organizations
	app.get("/", requireScopes("org:read"), async (c) => {
		try {
			const auth = c.get("auth");

			const organizations = await organizationRepo.listForUser(auth.userId);

			return c.json({
				success: true,
				data: { organizations },
			});
		} catch (error) {
			logger.error({ error }, "Error listing organizations");
			throw error;
		}
	});

	// GET /v1/organizations/:id - Get organization by ID
	app.get("/:id", requireScopes("org:read"), async (c) => {
		try {
			const auth = c.get("auth");
			const id = c.req.param("id");

			// Check if user has access to this organization
			const hasAccess = await organizationRepo.hasAccess(auth.userId, id);
			if (!hasAccess) {
				return c.json(
					{
						success: false,
						error: {
							code: "FORBIDDEN",
							message: "Access denied to this organization",
						},
					},
					403,
				);
			}

			const organization = await organizationRepo.getById(id);

			if (!organization) {
				return c.json(
					{
						success: false,
						error: {
							code: "NOT_FOUND",
							message: "Organization not found",
						},
					},
					404,
				);
			}

			return c.json({
				success: true,
				data: { organization },
			});
		} catch (error) {
			logger.error({ error }, "Error fetching organization");
			throw error;
		}
	});

	// PUT /v1/organizations/:id - Update organization
	app.put("/:id", requireScopes("org:write"), async (c) => {
		try {
			const auth = c.get("auth");
			const id = c.req.param("id");
			const body = await c.req.json();
			const parsed = UpdateOrganizationSchema.safeParse(body);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			// Check if user has access to this organization
			const hasAccess = await organizationRepo.hasAccess(auth.userId, id);
			if (!hasAccess) {
				return c.json(
					{
						success: false,
						error: {
							code: "FORBIDDEN",
							message: "Access denied to this organization",
						},
					},
					403,
				);
			}

			// Validate slug if provided
			if (parsed.data.slug && !isValidOrgSlug(parsed.data.slug)) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid organization slug format",
						},
					},
					400,
				);
			}

			// Check if new slug already exists
			if (parsed.data.slug) {
				const existing = await organizationRepo.getBySlug(parsed.data.slug);
				if (existing && existing.id !== id) {
					return c.json(
						{
							success: false,
							error: {
								code: "CONFLICT",
								message: "Organization with this slug already exists",
							},
						},
						409,
					);
				}
			}

			const organization = await organizationRepo.update(id, parsed.data);

			if (!organization) {
				return c.json(
					{
						success: false,
						error: {
							code: "NOT_FOUND",
							message: "Organization not found",
						},
					},
					404,
				);
			}

			logger.info(
				{
					orgId: organization.id,
					orgSlug: organization.slug,
					userId: auth.userId,
					updates: parsed.data,
				},
				"Organization updated",
			);

			return c.json({
				success: true,
				data: { organization },
			});
		} catch (error) {
			logger.error({ error }, "Error updating organization");
			throw error;
		}
	});

	// DELETE /v1/organizations/:id - Delete organization
	app.delete("/:id", requireScopes("org:write"), async (c) => {
		try {
			const auth = c.get("auth");
			const id = c.req.param("id");

			// Check if user has access to this organization
			const hasAccess = await organizationRepo.hasAccess(auth.userId, id);
			if (!hasAccess) {
				return c.json(
					{
						success: false,
						error: {
							code: "FORBIDDEN",
							message: "Access denied to this organization",
						},
					},
					403,
				);
			}

			const deleted = await organizationRepo.delete(id);

			if (!deleted) {
				return c.json(
					{
						success: false,
						error: {
							code: "NOT_FOUND",
							message: "Organization not found",
						},
					},
					404,
				);
			}

			logger.info(
				{
					orgId: id,
					userId: auth.userId,
				},
				"Organization deleted",
			);

			return c.json({
				success: true,
				data: { deleted: true },
			});
		} catch (error) {
			logger.error({ error }, "Error deleting organization");
			throw error;
		}
	});

	return app;
}
