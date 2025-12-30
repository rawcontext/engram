import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { Organization, OrganizationRepository } from "../db/organizations";
import type { OAuthAuthContext } from "../middleware/auth";
import { createOrganizationRoutes } from "./organizations";

describe("Organization Routes", () => {
	let app: Hono;
	let mockRepo: OrganizationRepository;
	let mockLogger: any;
	let mockAuth: OAuthAuthContext;

	beforeEach(() => {
		mockLogger = {
			info: mock(() => {}),
			error: mock(() => {}),
		};

		mockRepo = {
			create: mock(async () => ({}) as Organization),
			getById: mock(async () => null),
			getBySlug: mock(async () => null),
			listForUser: mock(async () => []),
			update: mock(async () => null),
			delete: mock(async () => false),
			hasAccess: mock(async () => false),
		} as any;

		mockAuth = {
			id: "token-123",
			prefix: "egm_oauth_abc",
			method: "oauth",
			type: "oauth",
			userId: "user-123",
			scopes: ["org:read", "org:write"],
			rateLimit: 60,
			grantType: "device_code",
			clientId: "mcp",
			orgId: "org-123",
			orgSlug: "test-org",
		};

		app = new Hono();

		// Mock auth middleware
		app.use("*", async (c, next) => {
			c.set("auth", mockAuth);
			await next();
		});

		// Mock scope middleware (simplified)
		const routes = createOrganizationRoutes({
			organizationRepo: mockRepo,
			logger: mockLogger,
		});

		// Replace requireScopes with a passthrough for testing
		app.route("/", routes);
	});

	describe("POST /", () => {
		test("should create organization with auto-generated slug", async () => {
			const org: Organization = {
				id: "org-456",
				slug: "test-company",
				name: "Test Company",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockRepo.getBySlug = mock(async () => null);
			mockRepo.create = mock(async () => org);

			const res = await app.request("/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Test Company" }),
			});

			expect(res.status).toBe(201);
			const data = await res.json();
			expect(data.success).toBe(true);
			expect(data.data.organization).toBeDefined();
		});

		test("should create organization with custom slug", async () => {
			const org: Organization = {
				id: "org-456",
				slug: "custom-slug",
				name: "Test Company",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockRepo.getBySlug = mock(async () => null);
			mockRepo.create = mock(async () => org);

			const res = await app.request("/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Test Company", slug: "custom-slug" }),
			});

			expect(res.status).toBe(201);
			const data = await res.json();
			expect(data.success).toBe(true);
		});

		test("should reject invalid slug format", async () => {
			const res = await app.request("/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Test Company", slug: "INVALID_SLUG" }),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.success).toBe(false);
			expect(data.error.code).toBe("VALIDATION_ERROR");
		});

		test("should reject duplicate slug", async () => {
			const existingOrg: Organization = {
				id: "org-existing",
				slug: "test-company",
				name: "Existing Company",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockRepo.getBySlug = mock(async () => existingOrg);

			const res = await app.request("/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Test Company", slug: "test-company" }),
			});

			expect(res.status).toBe(409);
			const data = await res.json();
			expect(data.success).toBe(false);
			expect(data.error.code).toBe("CONFLICT");
		});
	});

	describe("GET /", () => {
		test("should list user's organizations", async () => {
			const orgs: Organization[] = [
				{
					id: "org-1",
					slug: "org-one",
					name: "Organization One",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: "org-2",
					slug: "org-two",
					name: "Organization Two",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			];

			mockRepo.listForUser = mock(async () => orgs);

			const res = await app.request("/", {
				method: "GET",
			});

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.success).toBe(true);
			expect(data.data.organizations).toHaveLength(2);
		});
	});

	describe("GET /:id", () => {
		test("should get organization by ID", async () => {
			const org: Organization = {
				id: "org-123",
				slug: "test-org",
				name: "Test Organization",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockRepo.hasAccess = mock(async () => true);
			mockRepo.getById = mock(async () => org);

			const res = await app.request("/org-123", {
				method: "GET",
			});

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.success).toBe(true);
			expect(data.data.organization.id).toBe("org-123");
		});

		test("should deny access to organization user doesn't belong to", async () => {
			mockRepo.hasAccess = mock(async () => false);

			const res = await app.request("/org-456", {
				method: "GET",
			});

			expect(res.status).toBe(403);
			const data = await res.json();
			expect(data.success).toBe(false);
			expect(data.error.code).toBe("FORBIDDEN");
		});

		test("should return 404 for non-existent organization", async () => {
			mockRepo.hasAccess = mock(async () => true);
			mockRepo.getById = mock(async () => null);

			const res = await app.request("/org-999", {
				method: "GET",
			});

			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.success).toBe(false);
			expect(data.error.code).toBe("NOT_FOUND");
		});
	});

	describe("PUT /:id", () => {
		test("should update organization name", async () => {
			const updatedOrg: Organization = {
				id: "org-123",
				slug: "test-org",
				name: "Updated Name",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockRepo.hasAccess = mock(async () => true);
			mockRepo.update = mock(async () => updatedOrg);

			const res = await app.request("/org-123", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated Name" }),
			});

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.success).toBe(true);
			expect(data.data.organization.name).toBe("Updated Name");
		});

		test("should update organization slug", async () => {
			const updatedOrg: Organization = {
				id: "org-123",
				slug: "new-slug",
				name: "Test Organization",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockRepo.hasAccess = mock(async () => true);
			mockRepo.getBySlug = mock(async () => null);
			mockRepo.update = mock(async () => updatedOrg);

			const res = await app.request("/org-123", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slug: "new-slug" }),
			});

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.success).toBe(true);
		});

		test("should reject duplicate slug in update", async () => {
			const existingOrg: Organization = {
				id: "org-other",
				slug: "existing-slug",
				name: "Other Organization",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockRepo.hasAccess = mock(async () => true);
			mockRepo.getBySlug = mock(async () => existingOrg);

			const res = await app.request("/org-123", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slug: "existing-slug" }),
			});

			expect(res.status).toBe(409);
			const data = await res.json();
			expect(data.success).toBe(false);
			expect(data.error.code).toBe("CONFLICT");
		});

		test("should deny update for organization user doesn't belong to", async () => {
			mockRepo.hasAccess = mock(async () => false);

			const res = await app.request("/org-456", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "New Name" }),
			});

			expect(res.status).toBe(403);
			const data = await res.json();
			expect(data.success).toBe(false);
			expect(data.error.code).toBe("FORBIDDEN");
		});
	});

	describe("DELETE /:id", () => {
		test("should delete organization", async () => {
			mockRepo.hasAccess = mock(async () => true);
			mockRepo.delete = mock(async () => true);

			const res = await app.request("/org-123", {
				method: "DELETE",
			});

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.success).toBe(true);
			expect(data.data.deleted).toBe(true);
		});

		test("should return 404 when deleting non-existent organization", async () => {
			mockRepo.hasAccess = mock(async () => true);
			mockRepo.delete = mock(async () => false);

			const res = await app.request("/org-999", {
				method: "DELETE",
			});

			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.success).toBe(false);
			expect(data.error.code).toBe("NOT_FOUND");
		});

		test("should deny delete for organization user doesn't belong to", async () => {
			mockRepo.hasAccess = mock(async () => false);

			const res = await app.request("/org-456", {
				method: "DELETE",
			});

			expect(res.status).toBe(403);
			const data = await res.json();
			expect(data.success).toBe(false);
			expect(data.error.code).toBe("FORBIDDEN");
		});
	});
});
