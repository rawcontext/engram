import type { Context, Next } from "hono";
import type { ApiKeyContext } from "./auth";

/**
 * Scope-based access control middleware
 *
 * Validates that the authenticated API key has the required scopes for the operation.
 */
export function requireScopes(...requiredScopes: string[]) {
	return async (c: Context, next: Next) => {
		const apiKey = c.get("apiKey") as ApiKeyContext | undefined;

		if (!apiKey) {
			// No API key context - should be caught by auth middleware first
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

		// Check if API key has all required scopes
		const hasAllScopes = requiredScopes.every((scope) => apiKey.scopes.includes(scope));

		if (!hasAllScopes) {
			const missingScopes = requiredScopes.filter((scope) => !apiKey.scopes.includes(scope));

			return c.json(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: requiredScopes,
							missing: missingScopes,
							granted: apiKey.scopes,
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
		const apiKey = c.get("apiKey") as ApiKeyContext | undefined;

		if (!apiKey) {
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

		// Check if API key has at least one of the required scopes
		const hasAnyScope = requiredScopes.some((scope) => apiKey.scopes.includes(scope));

		if (!hasAnyScope) {
			return c.json(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: requiredScopes,
							granted: apiKey.scopes,
						},
					},
				},
				403,
			);
		}

		await next();
	};
}
