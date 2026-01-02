/**
 * Cloud Entity Repository
 *
 * Implements EntityRepository interface using the cloud client's query method.
 * This enables entity resolution in cloud mode by proxying all operations
 * through Cypher queries to the Engram API.
 *
 * Note: Embedding-based similarity search is not supported in this adapter.
 * Entity resolution falls back to exact name match, alias match, and LLM confirmation.
 */

import type {
	CreateEntityInput,
	Entity,
	EntityRepository,
	Memory,
	UpdateEntityInput,
} from "@engram/graph";
import { MAX_DATE } from "@engram/graph";
import type { Logger } from "@engram/logger";
import { ulid } from "ulid";
import type { IEngramClient, TenantContext } from "./interfaces";

/**
 * EntityRepository implementation that uses the cloud client's query API.
 * Provides entity CRUD operations and graph traversal via Cypher queries.
 */
export class CloudEntityRepository implements EntityRepository {
	private readonly cloudClient: IEngramClient;
	private readonly logger: Logger;
	private readonly tenant?: TenantContext;

	constructor(cloudClient: IEngramClient, logger: Logger, tenant?: TenantContext) {
		this.cloudClient = cloudClient;
		this.logger = logger;
		this.tenant = tenant;
	}

	// =============================================================================
	// CRUD Operations
	// =============================================================================

	async findById(id: string): Promise<Entity | null> {
		const results = await this.cloudClient.query<Entity>(
			`MATCH (e:Entity {id: $id}) WHERE e.tt_end > timestamp() RETURN e`,
			{ id },
			this.tenant,
		);
		return this.mapEntity(results[0]) ?? null;
	}

	async findByName(name: string, project?: string): Promise<Entity | null> {
		let cypher = `MATCH (e:Entity) WHERE e.tt_end > timestamp() AND toLower(e.name) = toLower($name)`;
		if (project) {
			cypher += ` AND (e.project = $project OR e.project IS NULL)`;
		}
		cypher += ` RETURN e LIMIT 1`;

		const results = await this.cloudClient.query<Entity>(cypher, { name, project }, this.tenant);
		return this.mapEntity(results[0]) ?? null;
	}

	async findByType(type: string, project?: string): Promise<Entity[]> {
		let cypher = `MATCH (e:Entity) WHERE e.tt_end > timestamp() AND e.type = $type`;
		if (project) {
			cypher += ` AND (e.project = $project OR e.project IS NULL)`;
		}
		cypher += ` RETURN e ORDER BY e.mention_count DESC`;

		const results = await this.cloudClient.query<Entity>(cypher, { type, project }, this.tenant);
		return results.map((r) => this.mapEntity(r)).filter((e): e is Entity => e !== null);
	}

	async findByAlias(alias: string, project?: string): Promise<Entity | null> {
		// FalkorDB array contains check uses list comprehension
		let cypher = `
			MATCH (e:Entity)
			WHERE e.tt_end > timestamp()
			AND any(a IN e.aliases WHERE toLower(a) = toLower($alias))
		`;
		if (project) {
			cypher += ` AND (e.project = $project OR e.project IS NULL)`;
		}
		cypher += ` RETURN e LIMIT 1`;

		const results = await this.cloudClient.query<Entity>(cypher, { alias, project }, this.tenant);
		return this.mapEntity(results[0]) ?? null;
	}

	async create(input: CreateEntityInput): Promise<Entity> {
		const id = ulid();
		const now = Date.now();

		const cypher = `
			CREATE (e:Entity {
				id: $id,
				name: $name,
				aliases: $aliases,
				type: $type,
				description: $description,
				mention_count: $mentionCount,
				project: $project,
				vt_start: $vtStart,
				vt_end: $vtEnd,
				tt_start: $ttStart,
				tt_end: $ttEnd
			})
			RETURN e
		`;

		const results = await this.cloudClient.query<Entity>(
			cypher,
			{
				id,
				name: input.name,
				aliases: input.aliases ?? [],
				type: input.type,
				description: input.description ?? null,
				mentionCount: input.mentionCount ?? 1,
				project: input.project ?? null,
				vtStart: now,
				vtEnd: MAX_DATE,
				ttStart: now,
				ttEnd: MAX_DATE,
			},
			this.tenant,
		);

		const entity = this.mapEntity(results[0]);
		if (!entity) {
			throw new Error("Failed to create entity");
		}

		this.logger.info({ entityId: id, name: input.name, type: input.type }, "Entity created");
		return entity;
	}

	async update(id: string, updates: UpdateEntityInput): Promise<Entity> {
		const setClause: string[] = [];
		const params: Record<string, unknown> = { id };

		if (updates.name !== undefined) {
			setClause.push("e.name = $name");
			params.name = updates.name;
		}
		if (updates.aliases !== undefined) {
			setClause.push("e.aliases = $aliases");
			params.aliases = updates.aliases;
		}
		if (updates.type !== undefined) {
			setClause.push("e.type = $type");
			params.type = updates.type;
		}
		if (updates.description !== undefined) {
			setClause.push("e.description = $description");
			params.description = updates.description;
		}
		if (updates.mentionCount !== undefined) {
			setClause.push("e.mention_count = $mentionCount");
			params.mentionCount = updates.mentionCount;
		}

		if (setClause.length === 0) {
			const existing = await this.findById(id);
			if (!existing) {
				throw new Error(`Entity not found: ${id}`);
			}
			return existing;
		}

		const cypher = `
			MATCH (e:Entity {id: $id})
			WHERE e.tt_end > timestamp()
			SET ${setClause.join(", ")}
			RETURN e
		`;

		const results = await this.cloudClient.query<Entity>(cypher, params, this.tenant);
		const entity = this.mapEntity(results[0]);
		if (!entity) {
			throw new Error(`Entity not found: ${id}`);
		}

		this.logger.debug({ entityId: id, updates }, "Entity updated");
		return entity;
	}

	async delete(id: string): Promise<void> {
		const now = Date.now();
		await this.cloudClient.query(
			`
			MATCH (e:Entity {id: $id})
			WHERE e.tt_end > timestamp()
			SET e.tt_end = $now
			`,
			{ id, now },
			this.tenant,
		);
		this.logger.debug({ entityId: id }, "Entity deleted (soft)");
	}

	async incrementMentionCount(id: string): Promise<void> {
		await this.cloudClient.query(
			`
			MATCH (e:Entity {id: $id})
			WHERE e.tt_end > timestamp()
			SET e.mention_count = e.mention_count + 1
			`,
			{ id },
			this.tenant,
		);
	}

	// =============================================================================
	// Similarity Search (not supported in cloud mode)
	// =============================================================================

	async findByEmbedding(
		_embedding: number[],
		_limit: number,
		_threshold?: number,
	): Promise<Entity[]> {
		// Embedding-based search requires Qdrant or similar vector store
		// Not supported in cloud mode - resolution falls back to LLM confirmation
		this.logger.debug("findByEmbedding not supported in cloud mode");
		return [];
	}

	async findSimilarEntities(_id: string, _limit: number): Promise<Entity[]> {
		// Requires entity embeddings - not supported in cloud mode
		this.logger.debug("findSimilarEntities not supported in cloud mode");
		return [];
	}

	// =============================================================================
	// Edge Operations
	// =============================================================================

	async createMentionsEdge(memoryId: string, entityId: string, context?: string): Promise<void> {
		await this.cloudClient.query(
			`
			MATCH (m:Memory {id: $memoryId}), (e:Entity {id: $entityId})
			WHERE m.tt_end > timestamp() AND e.tt_end > timestamp()
			CREATE (m)-[:MENTIONS {
				context: $context,
				vt_start: timestamp(),
				vt_end: $maxTime,
				tt_start: timestamp(),
				tt_end: $maxTime
			}]->(e)
			`,
			{ memoryId, entityId, context: context ?? "", maxTime: MAX_DATE },
			this.tenant,
		);
		this.logger.debug({ memoryId, entityId }, "MENTIONS edge created");
	}

	async createRelationship(
		fromId: string,
		toId: string,
		type: "RELATED_TO" | "DEPENDS_ON" | "IMPLEMENTS" | "PART_OF",
		props?: Record<string, unknown>,
	): Promise<void> {
		// Use dynamic relationship type via string interpolation (safe since type is validated enum)
		await this.cloudClient.query(
			`
			MATCH (e1:Entity {id: $fromId}), (e2:Entity {id: $toId})
			WHERE e1.tt_end > timestamp() AND e2.tt_end > timestamp()
			MERGE (e1)-[r:${type}]->(e2)
			ON CREATE SET r.vt_start = timestamp(), r.vt_end = $maxTime, r.tt_start = timestamp(), r.tt_end = $maxTime
			`,
			{ fromId, toId, maxTime: MAX_DATE, ...props },
			this.tenant,
		);
		this.logger.debug({ fromId, toId, type }, "Entity relationship created");
	}

	// =============================================================================
	// Graph Traversal
	// =============================================================================

	async findRelatedEntities(id: string, depth = 1): Promise<Entity[]> {
		const cypher = `
			MATCH (e:Entity {id: $id})-[*1..${depth}]-(related:Entity)
			WHERE e.tt_end > timestamp() AND related.tt_end > timestamp()
			RETURN DISTINCT related
		`;
		const results = await this.cloudClient.query<Entity>(cypher, { id }, this.tenant);
		return results.map((r) => this.mapEntity(r)).filter((e): e is Entity => e !== null);
	}

	async findMentioningMemories(id: string): Promise<Memory[]> {
		const cypher = `
			MATCH (m:Memory)-[:MENTIONS]->(e:Entity {id: $id})
			WHERE m.tt_end > timestamp() AND e.tt_end > timestamp()
			RETURN m ORDER BY m.vt_start DESC
		`;
		const results = await this.cloudClient.query<Memory>(cypher, { id }, this.tenant);
		return results;
	}

	async findByProject(project: string): Promise<Entity[]> {
		const cypher = `
			MATCH (e:Entity)
			WHERE e.tt_end > timestamp() AND e.project = $project
			RETURN e ORDER BY e.mention_count DESC
		`;
		const results = await this.cloudClient.query<Entity>(cypher, { project }, this.tenant);
		return results.map((r) => this.mapEntity(r)).filter((e): e is Entity => e !== null);
	}

	// =============================================================================
	// Helpers
	// =============================================================================

	/**
	 * Map raw query result to Entity interface.
	 * Handles property name differences (snake_case in DB vs camelCase in interface).
	 */
	private mapEntity(raw: any): Entity | null {
		if (!raw) return null;

		// Handle both nested (e.property) and flat result formats
		const data = raw.e ?? raw;

		return {
			id: data.id,
			name: data.name,
			aliases: data.aliases ?? [],
			type: data.type,
			description: data.description,
			mentionCount: data.mention_count ?? data.mentionCount ?? 1,
			project: data.project,
			embedding: data.embedding,
			vtStart: data.vt_start ?? data.vtStart,
			vtEnd: data.vt_end ?? data.vtEnd,
			ttStart: data.tt_start ?? data.ttStart,
			ttEnd: data.tt_end ?? data.ttEnd,
		};
	}
}
