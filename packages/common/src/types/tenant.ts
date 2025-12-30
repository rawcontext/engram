/**
 * Multi-Tenancy Types
 *
 * Types and utilities for tenant isolation in Engram.
 * Each organization gets its own FalkorDB graph and Qdrant vector space.
 *
 * @module @engram/common/types/tenant
 */

import { ADMIN_READ_SCOPE } from "./auth";
import type { AuthContext } from "./auth";

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
