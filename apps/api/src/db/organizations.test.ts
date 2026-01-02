import { describe, expect, it, mock } from "bun:test";
import { OrganizationRepository } from "./organizations";

describe("OrganizationRepository", () => {
	describe("create", () => {
		it("should create a new organization", async () => {
			const now = new Date();
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "org-123",
						slug: "test-org",
						name: "Test Organization",
						created_at: now,
						updated_at: now,
					}),
				),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.create("org-123", {
				name: "Test Organization",
				slug: "test-org",
			});

			expect(result).not.toBeNull();
			expect(result.id).toBe("org-123");
			expect(result.slug).toBe("test-org");
			expect(result.name).toBe("Test Organization");
			expect(result.createdAt).toEqual(now);
		});

		it("should throw error if insert fails", async () => {
			const mockDb = {
				queryOne: mock(() => Promise.resolve(null)),
			};

			const repo = new OrganizationRepository(mockDb as any);

			await expect(
				repo.create("org-123", {
					name: "Test Organization",
					slug: "test-org",
				}),
			).rejects.toThrow("Failed to create organization");
		});
	});

	describe("getById", () => {
		it("should return organization if found", async () => {
			const now = new Date();
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "org-123",
						slug: "test-org",
						name: "Test Organization",
						created_at: now,
						updated_at: now,
					}),
				),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.getById("org-123");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("org-123");
		});

		it("should return null if not found", async () => {
			const mockDb = {
				queryOne: mock(() => Promise.resolve(null)),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.getById("non-existent");

			expect(result).toBeNull();
		});
	});

	describe("getBySlug", () => {
		it("should return organization if found", async () => {
			const now = new Date();
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "org-123",
						slug: "test-org",
						name: "Test Organization",
						created_at: now,
						updated_at: now,
					}),
				),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.getBySlug("test-org");

			expect(result).not.toBeNull();
			expect(result?.slug).toBe("test-org");
		});

		it("should return null if not found", async () => {
			const mockDb = {
				queryOne: mock(() => Promise.resolve(null)),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.getBySlug("non-existent");

			expect(result).toBeNull();
		});
	});

	describe("listForUser", () => {
		it("should return organizations for user", async () => {
			const now = new Date();
			const mockDb = {
				queryMany: mock(() =>
					Promise.resolve([
						{
							id: "org-1",
							slug: "org-one",
							name: "Organization One",
							created_at: now,
							updated_at: now,
						},
						{
							id: "org-2",
							slug: "org-two",
							name: "Organization Two",
							created_at: now,
							updated_at: now,
						},
					]),
				),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.listForUser("user-123");

			expect(result).toHaveLength(2);
			expect(result[0].slug).toBe("org-one");
			expect(result[1].slug).toBe("org-two");
		});

		it("should return empty array if user has no organizations", async () => {
			const mockDb = {
				queryMany: mock(() => Promise.resolve([])),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.listForUser("user-no-orgs");

			expect(result).toHaveLength(0);
		});
	});

	describe("update", () => {
		it("should update organization name", async () => {
			const now = new Date();
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "org-123",
						slug: "test-org",
						name: "Updated Name",
						created_at: now,
						updated_at: new Date(),
					}),
				),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.update("org-123", { name: "Updated Name" });

			expect(result).not.toBeNull();
			expect(result?.name).toBe("Updated Name");
		});

		it("should update organization slug", async () => {
			const now = new Date();
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "org-123",
						slug: "new-slug",
						name: "Test Organization",
						created_at: now,
						updated_at: new Date(),
					}),
				),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.update("org-123", { slug: "new-slug" });

			expect(result).not.toBeNull();
			expect(result?.slug).toBe("new-slug");
		});

		it("should return current organization if no updates provided", async () => {
			const now = new Date();
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "org-123",
						slug: "test-org",
						name: "Test Organization",
						created_at: now,
						updated_at: now,
					}),
				),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.update("org-123", {});

			expect(result).not.toBeNull();
			expect(mockDb.queryOne).toHaveBeenCalled();
		});

		it("should return null if organization not found", async () => {
			const mockDb = {
				queryOne: mock(() => Promise.resolve(null)),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.update("non-existent", { name: "New Name" });

			expect(result).toBeNull();
		});
	});

	describe("delete", () => {
		it("should return true if organization deleted", async () => {
			const mockDb = {
				query: mock(() => Promise.resolve({ rowCount: 1 })),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.delete("org-123");

			expect(result).toBe(true);
		});

		it("should return false if organization not found", async () => {
			const mockDb = {
				query: mock(() => Promise.resolve({ rowCount: 0 })),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.delete("non-existent");

			expect(result).toBe(false);
		});

		it("should handle null rowCount", async () => {
			const mockDb = {
				query: mock(() => Promise.resolve({ rowCount: null })),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.delete("org-123");

			expect(result).toBe(false);
		});
	});

	describe("hasAccess", () => {
		it("should return true if user has access", async () => {
			const mockDb = {
				queryOne: mock(() => Promise.resolve({ has_access: true })),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.hasAccess("user-123", "org-123");

			expect(result).toBe(true);
		});

		it("should return false if user does not have access", async () => {
			const mockDb = {
				queryOne: mock(() => Promise.resolve({ has_access: false })),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.hasAccess("user-123", "org-456");

			expect(result).toBe(false);
		});

		it("should return false if query returns null", async () => {
			const mockDb = {
				queryOne: mock(() => Promise.resolve(null)),
			};

			const repo = new OrganizationRepository(mockDb as any);
			const result = await repo.hasAccess("user-123", "org-123");

			expect(result).toBe(false);
		});
	});
});
