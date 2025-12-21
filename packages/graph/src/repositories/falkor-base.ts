import type { GraphClient } from "@engram/storage";
import { ulid } from "ulid";
import { QueryBuilder } from "../queries/builder";
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
 */
export abstract class FalkorBaseRepository {
	constructor(protected readonly graphClient: GraphClient) {}

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
	 */
	protected async query<T>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
		return this.graphClient.query<T>(cypher, params);
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
}
