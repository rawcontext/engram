import { describe, expect, it, vi } from "vitest";
import { requireRole, UserRole } from "./rbac";

// Mock Clerk auth
vi.mock("@clerk/nextjs/server", () => ({
	auth: vi.fn(() =>
		Promise.resolve({
			userId: "user_123",
			sessionClaims: {
				metadata: { role: "user" },
			},
		}),
	),
}));

describe("RBAC", () => {
	it("should allow matching role", async () => {
		// Mock implementation will return 'user' role
		await expect(requireRole(UserRole.USER)).resolves.toBeUndefined();
	});

	it("should deny non-matching role", async () => {
		// Mock implementation returns 'user', we ask for 'admin'
		try {
			await requireRole(UserRole.ADMIN);
		} catch (e: any) {
			expect(e.name).toBe("ForbiddenError");
		}
	});
});
