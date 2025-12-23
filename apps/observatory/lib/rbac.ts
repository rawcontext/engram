import { headers } from "next/headers";
import type { NextResponse } from "next/server";
import { Pool } from "pg";
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
 * Reads the role from the user's metadata field in Better Auth.
 * Defaults to USER role if not set or invalid.
 */
function getUserRole(session: Session): UserRole {
	const roleValue = session.user.role;

	// Validate and return the role
	if (roleValue && Object.values(UserRole).includes(roleValue as UserRole)) {
		return roleValue as UserRole;
	}

	// Default to USER role if not set or invalid
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
 * Higher-order function to protect API routes with authentication.
 * Just checks that a session exists, no role requirements.
 */
export const withAuth =
	(handler: (req: Request) => Promise<NextResponse>) => async (req: Request) => {
		const session = await getSession();
		if (!session) {
			return apiError("User not authenticated", "UNAUTHORIZED", 401);
		}
		return handler(req);
	};

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

/**
 * Sets the role for a user in the database.
 * This should only be called by administrators or system processes.
 * Requires direct database access.
 *
 * @param userId - The user ID to update
 * @param role - The role to assign
 */
export async function setUserRole(userId: string, role: UserRole): Promise<void> {
	const pool = new Pool({
		connectionString: process.env.AUTH_DATABASE_URL,
	});

	try {
		await pool.query("UPDATE user SET role = $1 WHERE id = $2", [role, userId]);
	} finally {
		await pool.end();
	}
}
