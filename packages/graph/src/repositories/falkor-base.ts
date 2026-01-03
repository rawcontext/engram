import type { TenantContext } from "@engram/common/types";
import type { GraphClient, QueryParams } from "@engram/storage";
import { TenantAwareFalkorClient } from "@engram/storage";
import type { Graph } from "falkordb";
import { ulid } from "ulid";
import { QueryBuilder } from "../queries/builder";
import type { QueryClient } from "../runtime/types";
import { createBitemporal, MAX_DATE, now } from "../utils/time";

/**
 * Options for time-travel queries.
 */
export interface TimeTravelOptions {
	/** Valid time - when the data was valid in the real world */
	vt?: number;
	/** Transaction time - when the data was recorded in the database */
	tt?: number | "current";
}

/**
 * Base class for FalkorDB repository implementations.
 * Provides common utilities for:
 * - ID generation
 * - Bitemporal property management
 * - Query parameter building
 * - Node property mapping
 * - Time-travel query support
 * - Tenant-aware graph selection
 *
 * @remarks
 * This class supports both legacy (single-tenant) and multi-tenant modes:
 * - Legacy mode: Pass GraphClient directly, all queries use default graph
 * - Tenant mode: Pass TenantAwareFalkorClient + TenantContext, queries scoped to tenant graph
 */
export abstract class FalkorBaseRepository {
	protected readonly graphClient?: GraphClient;
	protected readonly tenantClient?: TenantAwareFalkorClient;
	protected readonly tenantContext?: TenantContext;

	constructor(client: GraphClient | TenantAwareFalkorClient, tenantContext?: TenantContext) {
		if (client instanceof TenantAwareFalkorClient) {
			this.tenantClient = client;
			this.tenantContext = tenantContext;
		} else {
			this.graphClient = client;
		}
	}

	/**
	 * Generate a new ULID for entity IDs.
	 */
	protected generateId(): string {
		return ulid();
	}

	/**
	 * Create bitemporal properties for a new node.
	 * @param validFrom - Optional valid time start (defaults to now)
	 */
	protected createBitemporal(validFrom?: number) {
		return createBitemporal(validFrom ?? now());
	}

	/**
	 * Create a QueryBuilder for time-travel queries.
	 */
	protected createQueryBuilder(): QueryBuilder {
		return new QueryBuilder();
	}

	/**
	 * Build a Cypher property string from an object.
	 * Example: { id: 'abc', name: 'test' } => "id: $id, name: $name"
	 */
	protected buildPropertyString(obj: Record<string, unknown>): string {
		return Object.keys(obj)
			.map((k) => `${k}: $${k}`)
			.join(", ");
	}

	/**
	 * Build a Cypher SET clause for updates.
	 * Example: { name: 'new', age: 30 } => "n.name = $name, n.age = $age"
	 */
	protected buildSetClause(updates: Record<string, unknown>, alias: string = "n"): string {
		return Object.keys(updates)
			.map((k) => `${alias}.${k} = $${k}`)
			.join(", ");
	}

	/**
	 * Convert snake_case properties to camelCase for domain objects.
	 */
	protected snakeToCamel<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
			result[camelKey] = value;
		}
		return result;
	}

	/**
	 * Convert camelCase properties to snake_case for FalkorDB.
	 */
	protected camelToSnake<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			if (value !== undefined) {
				const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
				result[snakeKey] = value;
			}
		}
		return result;
	}

	/**
	 * Execute a typed Cypher query.
	 * Automatically routes to tenant-specific graph when in tenant mode.
	 */
	protected async query<T>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
		if (this.tenantClient && this.tenantContext) {
			// Tenant mode: use tenant-specific graph
			const graph = await this.tenantClient.ensureTenantGraph(this.tenantContext);
			// Cast params to QueryParams (compatible with FalkorDB library)
			const queryParams = params as QueryParams;
			const result = await graph.query(cypher, { params: queryParams });
			return result.data as T[];
		}
		if (this.graphClient) {
			// Legacy mode: use default graph
			return this.graphClient.query<T>(cypher, params);
		}
		throw new Error(
			"Repository not properly initialized with GraphClient or TenantAwareFalkorClient",
		);
	}

	/**
	 * Get the tenant-specific graph instance.
	 * Only available in tenant mode.
	 *
	 * @throws {Error} If not in tenant mode
	 */
	protected async getTenantGraph(): Promise<Graph> {
		if (!this.tenantClient || !this.tenantContext) {
			throw new Error(
				"Tenant mode not enabled. Pass TenantAwareFalkorClient and TenantContext to constructor.",
			);
		}
		return this.tenantClient.ensureTenantGraph(this.tenantContext);
	}

	/**
	 * Check if this repository is operating in tenant mode.
	 */
	protected isTenantMode(): boolean {
		return this.tenantClient !== undefined && this.tenantContext !== undefined;
	}

	/**
	 * Get the current tenant context.
	 *
	 * @throws {Error} If not in tenant mode
	 */
	protected getTenantContext(): TenantContext {
		if (!this.tenantContext) {
			throw new Error(
				"Tenant mode not enabled. Pass TenantAwareFalkorClient and TenantContext to constructor.",
			);
		}
		return this.tenantContext;
	}

	/**
	 * Check if a node exists with the given condition.
	 */
	protected async exists(
		label: string,
		condition: string,
		params: Record<string, unknown>,
	): Promise<boolean> {
		const result = await this.query<{ cnt: number }>(
			`MATCH (n:${label} {${condition}}) WHERE n.tt_end = ${MAX_DATE} RETURN count(n) as cnt`,
			params,
		);
		return (result[0]?.cnt ?? 0) > 0;
	}

	/**
	 * Soft delete a node by closing its transaction time.
	 */
	protected async softDelete(label: string, id: string): Promise<void> {
		const t = now();
		await this.query(
			`MATCH (n:${label} {id: $id}) WHERE n.tt_end = ${MAX_DATE} SET n.tt_end = $t`,
			{ id, t },
		);
	}

	/**
	 * Get the MAX_DATE constant for queries.
	 */
	protected get maxDate(): number {
		return MAX_DATE;
	}

	/**
	 * Get the current timestamp.
	 */
	protected get now(): number {
		return now();
	}

	/**
	 * Get a QueryClient adapter for use with generated query builders.
	 * This allows repositories to use the type-safe query builder API
	 * while maintaining access to the underlying graph client.
	 *
	 * @example
	 * ```typescript
	 * const results = await new MemoryQueryBuilder(this.queryClient)
	 *   .whereType('decision')
	 *   .whereCurrent()
	 *   .execute();
	 * ```
	 */
	protected get queryClient(): QueryClient {
		return {
			query: <T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> =>
				this.query<T>(cypher, params ?? {}),
		};
	}
}
