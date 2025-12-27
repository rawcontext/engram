import type { Context, Next } from "hono";
import type { AuthContext } from "./auth";

/**
 * Scope-based access control middleware
 *
 * Validates that the authenticated token has the required scopes for the operation.
 */
export function requireScopes(...requiredScopes: string[]) {
	return async (c: Context, next: Next) => {
		const auth = c.get("auth") as AuthContext | undefined;

		if (!auth) {
			// No auth context - should be caught by auth middleware first
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Authentication required",
					},
				},
				401,
			);
		}

		// Check if token has all required scopes
		const hasAllScopes = requiredScopes.every((scope) => auth.scopes.includes(scope));

		if (!hasAllScopes) {
			const missingScopes = requiredScopes.filter((scope) => !auth.scopes.includes(scope));

			return c.json(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: requiredScopes,
							missing: missingScopes,
							granted: auth.scopes,
						},
					},
				},
				403,
			);
		}

		await next();
	};
}

/**
 * Require at least one of the specified scopes
 */
export function requireAnyScope(...requiredScopes: string[]) {
	return async (c: Context, next: Next) => {
		const auth = c.get("auth") as AuthContext | undefined;

		if (!auth) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Authentication required",
					},
				},
				401,
			);
		}

		// Check if token has at least one of the required scopes
		const hasAnyScope = requiredScopes.some((scope) => auth.scopes.includes(scope));

		if (!hasAnyScope) {
			return c.json(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: requiredScopes,
							granted: auth.scopes,
						},
					},
				},
				403,
			);
		}

		await next();
	};
}
