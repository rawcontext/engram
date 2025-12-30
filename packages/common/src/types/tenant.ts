/**
 * Multi-Tenancy Types
 *
 * Types and utilities for tenant isolation in Engram.
 * Each organization gets its own FalkorDB graph and Qdrant vector space.
 *
 * @module @engram/common/types/tenant
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthContext } from "./auth";
import { ADMIN_READ_SCOPE } from "./auth";

// =============================================================================
// Tenant Context
// =============================================================================

/**
 * Context for tenant-scoped operations.
 * Extracted from OAuth tokens and passed through all service calls.
 */
export interface TenantContext {
	/** Organization ULID from OAuth token */
	orgId: string;
	/** URL-safe organization slug for graph naming (max 32 chars) */
	orgSlug: string;
	/** Authenticated user ID */
	userId: string;
	/** Has admin:read scope for cross-tenant access */
	isAdmin: boolean;
}

// =============================================================================
// Graph Naming
// =============================================================================

/**
 * Generate the FalkorDB graph name for a tenant.
 * Format: engram_{orgSlug}_{orgId}
 *
 * @example
 * ```ts
 * const graphName = getTenantGraphName({ orgSlug: "acme", orgId: "01ABC123..." });
 * // => "engram_acme_01ABC123..."
 * ```
 */
export function getTenantGraphName(ctx: Pick<TenantContext, "orgSlug" | "orgId">): string {
	return `engram_${ctx.orgSlug}_${ctx.orgId}`;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a TenantContext from an AuthContext.
 * Requires orgId and orgSlug to be present on the AuthContext.
 *
 * @throws {Error} If orgId or orgSlug is missing from AuthContext
 */
export function createTenantContext(
	auth: AuthContext & { orgId: string; orgSlug: string },
): TenantContext {
	if (!auth.userId) {
		throw new Error("userId is required in AuthContext");
	}
	return {
		orgId: auth.orgId,
		orgSlug: auth.orgSlug,
		userId: auth.userId,
		isAdmin: auth.scopes.includes(ADMIN_READ_SCOPE),
	};
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Error thrown when cross-tenant access is denied.
 */
export class TenantAccessError extends Error {
	constructor(message: string = "Cross-tenant access denied") {
		super(message);
		this.name = "TenantAccessError";
	}
}

/**
 * Validate that a tenant context has access to a resource.
 * Admins with admin:read scope can access any tenant's resources.
 *
 * @throws {TenantAccessError} If cross-tenant access is attempted without admin scope
 */
export function validateTenantAccess(ctx: TenantContext, resourceOrgId: string): void {
	if (ctx.orgId !== resourceOrgId && !ctx.isAdmin) {
		throw new TenantAccessError();
	}
}

/**
 * Validate that an organization slug is valid.
 * Must be lowercase alphanumeric with optional hyphens, max 32 chars.
 */
export function isValidOrgSlug(slug: string): boolean {
	return /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]{1,2}$/.test(slug);
}

/**
 * Generate a URL-safe slug from an organization name.
 * Converts to lowercase, replaces spaces/special chars with hyphens, max 32 chars.
 */
export function generateOrgSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
}

// =============================================================================
// Runtime Context Management
// =============================================================================

/**
 * AsyncLocalStorage instance for request-scoped tenant context.
 * Allows accessing tenant context anywhere in the call stack without explicit passing.
 */
const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Error thrown when tenant context is accessed outside of a request scope.
 */
export class TenantContextError extends Error {
	constructor(message: string = "Tenant context not available") {
		super(message);
		this.name = "TenantContextError";
	}
}

/**
 * Execute a function with tenant context available in AsyncLocalStorage.
 * Used by middleware to establish request-scoped tenant context.
 *
 * @example
 * ```ts
 * // In middleware
 * await runWithTenantContext(tenantContext, async () => {
 *   await handleRequest();
 * });
 *
 * // In any nested function
 * const ctx = getTenantContext();
 * console.log(ctx.orgId); // Access without passing through params
 * ```
 */
export function runWithTenantContext<T>(context: TenantContext, fn: () => Promise<T>): Promise<T> {
	return tenantContextStorage.run(context, fn);
}

/**
 * Get the current tenant context from AsyncLocalStorage.
 * Must be called within a runWithTenantContext scope.
 *
 * @throws {TenantContextError} If called outside of a tenant context scope
 *
 * @example
 * ```ts
 * // Anywhere in the call stack within runWithTenantContext
 * const ctx = getTenantContext();
 * const graphName = getTenantGraphName(ctx);
 * ```
 */
export function getTenantContext(): TenantContext {
	const context = tenantContextStorage.getStore();
	if (!context) {
		throw new TenantContextError(
			"Tenant context not available. Ensure this code runs within runWithTenantContext().",
		);
	}
	return context;
}

/**
 * Get the current tenant context, or undefined if not available.
 * Useful for optional tenant-scoped operations.
 *
 * @example
 * ```ts
 * const ctx = tryGetTenantContext();
 * if (ctx) {
 *   // Tenant-scoped operation
 * } else {
 *   // Global operation
 * }
 * ```
 */
export function tryGetTenantContext(): TenantContext | undefined {
	return tenantContextStorage.getStore();
}
