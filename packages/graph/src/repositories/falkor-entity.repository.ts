import { createNodeLogger } from "@engram/logger";
import type { FalkorNode } from "@engram/storage";
import type { EntityRepository } from "./entity.repository";
import { FalkorBaseRepository } from "./falkor-base";
import type { CreateEntityInput, Entity, Memory, UpdateEntityInput } from "./types";

const _logger = createNodeLogger({
	service: "graph",
	base: { component: "falkor-entity-repository" },
});

/**
 * Raw FalkorDB Entity node properties.
 */
type EntityNodeProps = {
	id: string;
	name: string;
	aliases: string[];
	type: string;
	description?: string;
	mention_count: number;
	project?: string;
	embedding?: number[];
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

/**
 * Raw FalkorDB Memory node properties (for MENTIONS edge traversal).
 */
type MemoryNodeProps = {
	id: string;
	content: string;
	content_hash: string;
	type: string;
	tags: string[];
	source_session_id?: string;
	source_turn_id?: string;
	source: string;
	project?: string;
	working_dir?: string;
	embedding?: number[];
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

/**
 * FalkorDB implementation of EntityRepository.
 * Supports both legacy (single-tenant) and multi-tenant modes via TenantContext.
 *
 * Entities are named concepts, tools, technologies, patterns, files, people,
 * or projects extracted from conversations and memories. They enable
 * entity-based retrieval and knowledge graph construction.
 */
export class FalkorEntityRepository extends FalkorBaseRepository implements EntityRepository {
	// =============================================================================
	// CRUD Operations
	// =============================================================================

	async findById(id: string): Promise<Entity | null> {
		const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
			`MATCH (e:Entity {id: $id}) WHERE e.tt_end = ${this.maxDate} RETURN e`,
			{ id },
		);
		if (!results[0]?.e) return null;
		return this.mapToEntity(results[0].e);
	}

	async findByName(name: string, project?: string): Promise<Entity | null> {
		if (project) {
			const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
				`MATCH (e:Entity {name: $name, project: $project}) WHERE e.tt_end = ${this.maxDate} RETURN e`,
				{ name, project },
			);
			if (!results[0]?.e) return null;
			return this.mapToEntity(results[0].e);
		}

		const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
			`MATCH (e:Entity {name: $name}) WHERE e.tt_end = ${this.maxDate} RETURN e`,
			{ name },
		);
		if (!results[0]?.e) return null;
		return this.mapToEntity(results[0].e);
	}

	async findByType(type: string, project?: string): Promise<Entity[]> {
		if (project) {
			const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
				`MATCH (e:Entity {type: $type, project: $project}) WHERE e.tt_end = ${this.maxDate} RETURN e ORDER BY e.mention_count DESC`,
				{ type, project },
			);
			return results.map((r) => this.mapToEntity(r.e));
		}

		const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
			`MATCH (e:Entity {type: $type}) WHERE e.tt_end = ${this.maxDate} RETURN e ORDER BY e.mention_count DESC`,
			{ type },
		);
		return results.map((r) => this.mapToEntity(r.e));
	}

	async findByAlias(alias: string, project?: string): Promise<Entity | null> {
		if (project) {
			const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
				`MATCH (e:Entity {project: $project}) WHERE e.tt_end = ${this.maxDate} AND $alias IN e.aliases RETURN e`,
				{ alias, project },
			);
			if (!results[0]?.e) return null;
			return this.mapToEntity(results[0].e);
		}

		const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
			`MATCH (e:Entity) WHERE e.tt_end = ${this.maxDate} AND $alias IN e.aliases RETURN e`,
			{ alias },
		);
		if (!results[0]?.e) return null;
		return this.mapToEntity(results[0].e);
	}

	async create(input: CreateEntityInput): Promise<Entity> {
		const id = this.generateId();
		const temporal = this.createBitemporal();

		const nodeProps: Record<string, unknown> = {
			id,
			name: input.name,
			aliases: input.aliases ?? [],
			type: input.type,
			mention_count: input.mentionCount ?? 1,
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		if (input.description) nodeProps.description = input.description;
		if (input.project) nodeProps.project = input.project;
		if (input.embedding) nodeProps.embedding = input.embedding;

		const propsString = this.buildPropertyString(nodeProps);
		const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
			`CREATE (e:Entity {${propsString}}) RETURN e`,
			nodeProps,
		);

		return this.mapToEntity(results[0].e);
	}

	async update(id: string, updates: UpdateEntityInput): Promise<Entity> {
		const maxRetries = 3;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				return await this.performUpdate(id, updates);
			} catch (error) {
				if (error instanceof Error && error.message.includes("Concurrent modification")) {
					lastError = error;
					// Exponential backoff: 10ms, 20ms, 40ms
					await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
					continue;
				}
				// Non-retryable error, throw immediately
				throw error;
			}
		}

		throw new Error(
			`Failed to update entity ${id} after ${maxRetries} attempts due to concurrent modifications. Last error: ${lastError?.message}`,
		);
	}

	/**
	 * Internal method to perform a single update attempt.
	 * Separated for retry logic in the public update() method.
	 */
	private async performUpdate(id: string, updates: UpdateEntityInput): Promise<Entity> {
		const existing = await this.findById(id);
		if (!existing) {
			throw new Error(`Entity not found: ${id}`);
		}

		// Close old version with optimistic locking
		const t = this.now;
		const closeResult = await this.query<{ count: number }>(
			`MATCH (e:Entity {id: $id}) WHERE e.tt_end = ${this.maxDate}
			 SET e.tt_end = $t
			 RETURN count(e) as count`,
			{ id, t },
		);

		// Check if the close operation affected exactly one node
		if (!closeResult[0] || closeResult[0].count === 0) {
			throw new Error(`Concurrent modification detected for entity ${id}. Please retry.`);
		}

		// Create new version with merged properties
		const newTemporal = this.createBitemporal();
		const newId = this.generateId();

		const nodeProps: Record<string, unknown> = {
			id: newId,
			name: updates.name ?? existing.name,
			aliases: updates.aliases ?? existing.aliases,
			type: updates.type ?? existing.type,
			description: updates.description ?? existing.description,
			mention_count: updates.mentionCount ?? existing.mentionCount,
			project: existing.project,
			embedding: updates.embedding ?? existing.embedding,
			vt_start: newTemporal.vt_start,
			vt_end: newTemporal.vt_end,
			tt_start: newTemporal.tt_start,
			tt_end: newTemporal.tt_end,
		};

		// Remove undefined values
		for (const key of Object.keys(nodeProps)) {
			if (nodeProps[key] === undefined) {
				delete nodeProps[key];
			}
		}

		const propsString = this.buildPropertyString(nodeProps);
		const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
			`CREATE (e:Entity {${propsString}}) RETURN e`,
			nodeProps,
		);

		// Link new version to old
		await this.query(
			`MATCH (new:Entity {id: $newId}), (old:Entity {id: $oldId})
			 CREATE (new)-[:REPLACES {tt_start: $ttStart, tt_end: ${this.maxDate}, vt_start: $vtStart, vt_end: ${this.maxDate}}]->(old)`,
			{ newId, oldId: id, ttStart: newTemporal.tt_start, vtStart: newTemporal.vt_start },
		);

		return this.mapToEntity(results[0].e);
	}

	async delete(id: string): Promise<void> {
		const exists = await this.findById(id);
		if (!exists) {
			throw new Error(`Entity not found: ${id}`);
		}
		await this.softDelete("Entity", id);
	}

	async incrementMentionCount(id: string): Promise<void> {
		const existing = await this.findById(id);
		if (!existing) {
			throw new Error(`Entity not found: ${id}`);
		}

		// Update the entity with incremented mention count
		await this.update(id, { mentionCount: existing.mentionCount + 1 });
	}

	// =============================================================================
	// Similarity Search
	// =============================================================================

	async findByEmbedding(embedding: number[], limit: number, threshold?: number): Promise<Entity[]> {
		const minThreshold = threshold ?? 0.0;

		const results = await this.query<{
			node: FalkorNode<EntityNodeProps>;
			score: number;
		}>(
			`CALL db.idx.vector.queryNodes('Entity', 'embedding', $limit, vecf32($embedding))
			 YIELD node, score
			 WHERE score > $threshold AND node.vt_end = ${this.maxDate}
			 RETURN node, score
			 ORDER BY score DESC`,
			{ embedding, limit, threshold: minThreshold },
		);

		return results.map((r) => this.mapToEntity(r.node));
	}

	async findSimilarEntities(id: string, limit: number): Promise<Entity[]> {
		const entity = await this.findById(id);
		if (!entity) {
			throw new Error(`Entity not found: ${id}`);
		}
		if (!entity.embedding) {
			throw new Error(`Entity ${id} has no embedding`);
		}

		// Find similar entities excluding the source entity itself
		const results = await this.query<{
			node: FalkorNode<EntityNodeProps>;
			score: number;
		}>(
			`CALL db.idx.vector.queryNodes('Entity', 'embedding', $limit, vecf32($embedding))
			 YIELD node, score
			 WHERE node.id <> $excludeId AND node.vt_end = ${this.maxDate}
			 RETURN node, score
			 ORDER BY score DESC`,
			{ embedding: entity.embedding, limit: limit + 1, excludeId: id },
		);

		return results.slice(0, limit).map((r) => this.mapToEntity(r.node));
	}

	// =============================================================================
	// Edge Operations
	// =============================================================================

	async createMentionsEdge(memoryId: string, entityId: string, context?: string): Promise<void> {
		const temporal = this.createBitemporal();

		const edgeProps: Record<string, unknown> = {
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		if (context) {
			edgeProps.context = context;
		}

		const propsString = this.buildPropertyString(edgeProps);

		await this.query(
			`MATCH (m:Memory {id: $memoryId}), (e:Entity {id: $entityId})
			 WHERE m.tt_end = ${this.maxDate} AND e.tt_end = ${this.maxDate}
			 CREATE (m)-[:MENTIONS {${propsString}}]->(e)`,
			{ memoryId, entityId, ...edgeProps },
		);
	}

	async createRelationship(
		fromId: string,
		toId: string,
		type: "RELATED_TO" | "DEPENDS_ON" | "IMPLEMENTS" | "PART_OF",
		props?: Record<string, unknown>,
	): Promise<void> {
		const temporal = this.createBitemporal();

		const edgeProps: Record<string, unknown> = {
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
			...(props ?? {}),
		};

		const propsString = this.buildPropertyString(edgeProps);

		await this.query(
			`MATCH (from:Entity {id: $fromId}), (to:Entity {id: $toId})
			 WHERE from.tt_end = ${this.maxDate} AND to.tt_end = ${this.maxDate}
			 CREATE (from)-[:${type} {${propsString}}]->(to)`,
			{ fromId, toId, ...edgeProps },
		);
	}

	// =============================================================================
	// Graph Traversal
	// =============================================================================

	async findRelatedEntities(id: string, depth: number = 1): Promise<Entity[]> {
		const results = await this.query<{ related: FalkorNode<EntityNodeProps> }>(
			`MATCH (e:Entity {id: $id})-[:RELATED_TO|DEPENDS_ON|IMPLEMENTS|PART_OF*1..${depth}]-(related:Entity)
			 WHERE e.tt_end = ${this.maxDate} AND related.vt_end = ${this.maxDate}
			 RETURN DISTINCT related
			 ORDER BY related.mention_count DESC`,
			{ id },
		);

		return results.map((r) => this.mapToEntity(r.related));
	}

	async findMentioningMemories(id: string): Promise<Memory[]> {
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`MATCH (m:Memory)-[:MENTIONS]->(e:Entity {id: $id})
			 WHERE m.tt_end = ${this.maxDate} AND e.tt_end = ${this.maxDate}
			 RETURN m
			 ORDER BY m.vt_start DESC`,
			{ id },
		);

		return results.map((r) => this.mapToMemory(r.m));
	}

	async findByProject(project: string): Promise<Entity[]> {
		const results = await this.query<{ e: FalkorNode<EntityNodeProps> }>(
			`MATCH (e:Entity {project: $project}) WHERE e.tt_end = ${this.maxDate} RETURN e ORDER BY e.mention_count DESC`,
			{ project },
		);
		return results.map((r) => this.mapToEntity(r.e));
	}

	// =============================================================================
	// Private Mapping Methods
	// =============================================================================

	/**
	 * Map FalkorDB node to domain Entity object.
	 */
	private mapToEntity(node: FalkorNode<EntityNodeProps>): Entity {
		if (!node || !node.properties) {
			throw new Error("Invalid node: node or properties is null/undefined");
		}
		const props = node.properties;
		return {
			id: props.id,
			name: props.name,
			aliases: Array.isArray(props.aliases) ? props.aliases : [],
			type: props.type,
			description: props.description,
			mentionCount: props.mention_count,
			project: props.project,
			embedding: props.embedding,
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}

	/**
	 * Map FalkorDB Memory node to domain Memory object.
	 * Used for MENTIONS edge traversal.
	 */
	private mapToMemory(node: FalkorNode<MemoryNodeProps>): Memory {
		if (!node || !node.properties) {
			throw new Error("Invalid node: node or properties is null/undefined");
		}
		const props = node.properties;
		return {
			id: props.id,
			content: props.content,
			contentHash: props.content_hash,
			type: props.type,
			tags: Array.isArray(props.tags) ? props.tags : [],
			sourceSessionId: props.source_session_id,
			sourceTurnId: props.source_turn_id,
			source: props.source,
			project: props.project,
			workingDir: props.working_dir,
			embedding: props.embedding,
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}
}
