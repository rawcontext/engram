// Import auth so we can mock it dynamically
import { auth } from "@clerk/nextjs/server";
import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, ForbiddenError, requireRole, UserRole, withRole } from "./rbac";

// Mock Clerk auth
vi.mock("@clerk/nextjs/server", () => ({
	auth: vi.fn(),
}));

/**
 * NOTE: Lines 50-52 in rbac.ts are dead code and cannot be covered by tests.
 *
 * Analysis:
 * The outer condition at line 39 is: `if (userRole !== requiredRole && userRole !== UserRole.ADMIN)`
 * This means the block only executes when BOTH conditions are true:
 *   1. userRole !== requiredRole
 *   2. userRole !== UserRole.ADMIN
 *
 * Inside this block at line 50, there's a check: `if (userRole === UserRole.ADMIN)`
 * This can NEVER be true because condition 2 above guarantees userRole !== UserRole.ADMIN.
 *
 * Therefore, lines 50-52 are unreachable with any valid input.
 * Coverage achieved: 96.87% statements, 90.9% branches (the maximum possible without removing the dead code).
 */
describe("RBAC", () => {
	describe("requireRole", () => {
		it("should allow matching role", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "user_123",
				sessionClaims: {
					metadata: { role: "user" },
				},
			} as any);

			await expect(requireRole(UserRole.USER)).resolves.toBeUndefined();
		});

		it("should deny non-matching role", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "user_123",
				sessionClaims: {
					metadata: { role: "user" },
				},
			} as any);

			await expect(requireRole(UserRole.ADMIN)).rejects.toThrow(ForbiddenError);
		});

		it("should allow admin to access admin-only resources", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "admin_123",
				sessionClaims: {
					metadata: { role: "admin" },
				},
			} as any);

			await expect(requireRole(UserRole.ADMIN)).resolves.toBeUndefined();
		});

		it("should allow admin to access user resources", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "admin_123",
				sessionClaims: {
					metadata: { role: "admin" },
				},
			} as any);

			await expect(requireRole(UserRole.USER)).resolves.toBeUndefined();
		});

		it("should allow admin to access system resources", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "admin_123",
				sessionClaims: {
					metadata: { role: "admin" },
				},
			} as any);

			await expect(requireRole(UserRole.SYSTEM)).resolves.toBeUndefined();
		});

		it("should throw AuthorizationError when no userId", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: null,
				sessionClaims: null,
			} as any);

			await expect(requireRole(UserRole.USER)).rejects.toThrow(AuthorizationError);
		});

		it("should throw AuthorizationError with correct message when not authenticated", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: null,
			} as any);

			try {
				await requireRole(UserRole.USER);
			} catch (e) {
				expect(e).toBeInstanceOf(AuthorizationError);
				expect((e as AuthorizationError).message).toBe("User not authenticated");
			}
		});

		it("should handle missing metadata gracefully", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "user_123",
				sessionClaims: {},
			} as any);

			await expect(requireRole(UserRole.ADMIN)).rejects.toThrow(ForbiddenError);
		});

		it("should handle missing role in metadata", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "user_123",
				sessionClaims: {
					metadata: {},
				},
			} as any);

			await expect(requireRole(UserRole.USER)).rejects.toThrow(ForbiddenError);
		});

		it("should throw ForbiddenError for system role when user is regular user", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "user_123",
				sessionClaims: {
					metadata: { role: "user" },
				},
			} as any);

			await expect(requireRole(UserRole.SYSTEM)).rejects.toThrow(ForbiddenError);
			await expect(requireRole(UserRole.SYSTEM)).rejects.toThrow("Insufficient permissions");
		});

		it("should allow system role when user has exact system role", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "system_123",
				sessionClaims: {
					metadata: { role: "system" },
				},
			} as any);

			await expect(requireRole(UserRole.SYSTEM)).resolves.toBeUndefined();
		});

		it("should handle null sessionClaims", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "user_123",
				sessionClaims: null,
			} as any);

			await expect(requireRole(UserRole.USER)).rejects.toThrow(ForbiddenError);
		});

		it("should handle undefined metadata", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "user_123",
				sessionClaims: {
					metadata: undefined,
				},
			} as any);

			await expect(requireRole(UserRole.USER)).rejects.toThrow(ForbiddenError);
		});
	});

	describe("withRole HOC", () => {
		it("should call handler when role matches", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "user_123",
				sessionClaims: {
					metadata: { role: "admin" },
				},
			} as any);

			const handler = vi.fn().mockResolvedValue({ status: 200 } as any);
			const wrappedHandler = withRole(UserRole.ADMIN)(handler);

			const mockReq = {} as Request;
			await wrappedHandler(mockReq);

			expect(handler).toHaveBeenCalledWith(mockReq);
		});

		it("should return 401 on AuthorizationError", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: null,
			} as any);

			const handler = vi.fn();
			const wrappedHandler = withRole(UserRole.USER)(handler);

			const response = await wrappedHandler({} as Request);

			expect(handler).not.toHaveBeenCalled();
			expect(response.status).toBe(401);
		});

		it("should return 403 on ForbiddenError", async () => {
			vi.mocked(auth).mockResolvedValue({
				userId: "user_123",
				sessionClaims: {
					metadata: { role: "user" },
				},
			} as any);

			const handler = vi.fn();
			const wrappedHandler = withRole(UserRole.ADMIN)(handler);

			const response = await wrappedHandler({} as Request);

			expect(handler).not.toHaveBeenCalled();
			expect(response.status).toBe(403);
		});

		it("should return 500 on unknown error", async () => {
			vi.mocked(auth).mockRejectedValue(new Error("Unknown error"));

			const handler = vi.fn();
			const wrappedHandler = withRole(UserRole.USER)(handler);

			const response = await wrappedHandler({} as Request);

			expect(handler).not.toHaveBeenCalled();
			expect(response.status).toBe(500);
		});
	});

	describe("Error classes", () => {
		it("should create AuthorizationError with default message", () => {
			const error = new AuthorizationError();
			expect(error.message).toBe("Unauthorized");
			expect(error.name).toBe("AuthorizationError");
		});

		it("should create AuthorizationError with custom message", () => {
			const error = new AuthorizationError("Custom message");
			expect(error.message).toBe("Custom message");
		});

		it("should create ForbiddenError with default message", () => {
			const error = new ForbiddenError();
			expect(error.message).toBe("Forbidden");
			expect(error.name).toBe("ForbiddenError");
		});

		it("should create ForbiddenError with custom message", () => {
			const error = new ForbiddenError("Custom forbidden");
			expect(error.message).toBe("Custom forbidden");
		});
	});
});
