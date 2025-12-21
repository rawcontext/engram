import { auth } from "@clerk/nextjs/server";
import { describe, expect, it, vi } from "vitest";
import { checkRole } from "./auth";

vi.mock("@clerk/nextjs/server", () => ({
	auth: vi.fn(),
}));

describe("auth", () => {
	describe("checkRole", () => {
		it("should allow access when role matches", async () => {
			vi.mocked(auth).mockResolvedValue({
				sessionClaims: {
					metadata: { role: "admin" },
				},
			} as any);

			await expect(checkRole("admin")).resolves.toBeUndefined();
		});

		it("should throw error when role does not match", async () => {
			vi.mocked(auth).mockResolvedValue({
				sessionClaims: {
					metadata: { role: "user" },
				},
			} as any);

			await expect(checkRole("admin")).rejects.toThrow("Forbidden");
		});

		it("should throw error when metadata is missing", async () => {
			vi.mocked(auth).mockResolvedValue({
				sessionClaims: {},
			} as any);

			await expect(checkRole("admin")).rejects.toThrow("Forbidden");
		});

		it("should throw error when sessionClaims is null", async () => {
			vi.mocked(auth).mockResolvedValue({
				sessionClaims: null,
			} as any);

			await expect(checkRole("admin")).rejects.toThrow("Forbidden");
		});

		it("should throw error when role is undefined", async () => {
			vi.mocked(auth).mockResolvedValue({
				sessionClaims: {
					metadata: { role: undefined },
				},
			} as any);

			await expect(checkRole("admin")).rejects.toThrow("Forbidden");
		});

		it("should throw error when role is null", async () => {
			vi.mocked(auth).mockResolvedValue({
				sessionClaims: {
					metadata: { role: null },
				},
			} as any);

			await expect(checkRole("admin")).rejects.toThrow("Forbidden");
		});
	});
});
