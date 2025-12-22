import { headers } from "next/headers";
import type { NextResponse } from "next/server";
import { apiError } from "./api-response";
import { auth, type Session } from "./auth";

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
 * Extract user role from session.
 * Currently returns USER for all authenticated users.
 * Can be extended to read from user metadata.
 */
function getUserRole(_session: Session): UserRole {
	// TODO: Read role from session.user metadata when implemented
	return UserRole.USER;
}

/**
 * Gets the current session from Better Auth.
 * Returns null if not authenticated.
 */
export async function getSession(): Promise<Session | null> {
	const session = await auth.api.getSession({
		headers: await headers(),
	});
	return session;
}

/**
 * Checks if the current user has the required role.
 * Throws AuthorizationError or ForbiddenError if not.
 */
export async function requireRole(requiredRole: UserRole) {
	const session = await getSession();

	if (!session) {
		throw new AuthorizationError("User not authenticated");
	}

	// For now, all authenticated users are treated as USER role
	// Role-based access can be extended by storing roles in user metadata
	// TODO: Implement role storage in Better Auth user metadata
	const userRole = getUserRole(session);

	// Admin role has access to everything
	if (userRole === UserRole.ADMIN) {
		return;
	}

	// Check if user has the required role
	if (userRole !== requiredRole) {
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
