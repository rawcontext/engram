import { auth } from "@clerk/nextjs/server";
import type { NextResponse } from "next/server";
import { apiError } from "./api-response";

export enum UserRole {
	ADMIN = "admin",
	USER = "user",
	SYSTEM = "system",
}

export class AuthorizationError extends Error {
	constructor(message = "Unauthorized") {
		super(message);
		this.name = "AuthorizationError";
	}
}

export class ForbiddenError extends Error {
	constructor(message = "Forbidden") {
		super(message);
		this.name = "ForbiddenError";
	}
}

/**
 * Checks if the current user has the required role.
 * Throws AuthorizationError or ForbiddenError if not.
 */
export async function requireRole(requiredRole: UserRole) {
	const { userId, sessionClaims } = await auth();

	if (!userId) {
		throw new AuthorizationError("User not authenticated");
	}

	const metadata = sessionClaims?.metadata as { role?: string } | undefined;
	const userRole = metadata?.role;

	if (userRole !== requiredRole && userRole !== UserRole.ADMIN) {
		// User is not admin and doesn't have required role
		if (requiredRole === UserRole.ADMIN) {
			throw new ForbiddenError(
				`User role '${userRole}' does not match required role '${requiredRole}'`,
			);
		}

		throw new ForbiddenError("Insufficient permissions");
	}
}

/**
 * Higher-order function to protect API routes with RBAC.
 * Can be composed with validate().
 */
export const withRole =
	(role: UserRole) =>
	(handler: (req: Request) => Promise<NextResponse>) =>
	async (req: Request) => {
		try {
			await requireRole(role);
			return handler(req);
		} catch (e) {
			if (e instanceof AuthorizationError) {
				return apiError(e.message, "UNAUTHORIZED", 401);
			}
			if (e instanceof ForbiddenError) {
				return apiError(e.message, "FORBIDDEN", 403);
			}
			return apiError("Internal Authorization Error", "AUTH_ERROR", 500);
		}
	};
