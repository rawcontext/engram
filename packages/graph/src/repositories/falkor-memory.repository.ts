import { createNodeLogger } from "@engram/logger";
import type { FalkorNode } from "@engram/storage";
import { FalkorBaseRepository } from "./falkor-base";
import type { MemoryRepository } from "./memory.repository";
import type { CreateMemoryInput, Memory, UpdateMemoryInput } from "./types";

const _logger = createNodeLogger({
	service: "graph",
	base: { component: "falkor-memory-repository" },
});

/**
 * Raw FalkorDB Memory node properties.
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
 * FalkorDB implementation of MemoryRepository.
 * Supports both legacy (single-tenant) and multi-tenant modes via TenantContext.
 */
export class FalkorMemoryRepository extends FalkorBaseRepository implements MemoryRepository {
	async findById(id: string): Promise<Memory | null> {
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`MATCH (m:Memory {id: $id}) WHERE m.tt_end = ${this.maxDate} RETURN m`,
			{ id },
		);
		if (!results[0]?.m) return null;
		return this.mapToMemory(results[0].m);
	}

	async findByType(type: string): Promise<Memory[]> {
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`MATCH (m:Memory {type: $type}) WHERE m.tt_end = ${this.maxDate} RETURN m ORDER BY m.vt_start DESC`,
			{ type },
		);
		return results.map((r) => this.mapToMemory(r.m));
	}

	async findByTag(tag: string): Promise<Memory[]> {
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`MATCH (m:Memory) WHERE m.tt_end = ${this.maxDate} AND $tag IN m.tags RETURN m ORDER BY m.vt_start DESC`,
			{ tag },
		);
		return results.map((r) => this.mapToMemory(r.m));
	}

	async findByProject(project: string): Promise<Memory[]> {
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`MATCH (m:Memory {project: $project}) WHERE m.tt_end = ${this.maxDate} RETURN m ORDER BY m.vt_start DESC`,
			{ project },
		);
		return results.map((r) => this.mapToMemory(r.m));
	}

	async findByWorkingDir(workingDir: string): Promise<Memory[]> {
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`MATCH (m:Memory {working_dir: $workingDir}) WHERE m.tt_end = ${this.maxDate} RETURN m ORDER BY m.vt_start DESC`,
			{ workingDir },
		);
		return results.map((r) => this.mapToMemory(r.m));
	}

	async findBySession(sessionId: string): Promise<Memory[]> {
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`MATCH (m:Memory {source_session_id: $sessionId}) WHERE m.tt_end = ${this.maxDate} RETURN m ORDER BY m.vt_start DESC`,
			{ sessionId },
		);
		return results.map((r) => this.mapToMemory(r.m));
	}

	async findActive(): Promise<Memory[]> {
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`MATCH (m:Memory) WHERE m.tt_end = ${this.maxDate} RETURN m ORDER BY m.vt_start DESC`,
		);
		return results.map((r) => this.mapToMemory(r.m));
	}

	async create(input: CreateMemoryInput): Promise<Memory> {
		const id = this.generateId();
		const temporal = this.createBitemporal();

		const nodeProps: Record<string, unknown> = {
			id,
			content: input.content,
			content_hash: input.contentHash,
			type: input.type ?? "context",
			tags: input.tags ?? [],
			source: input.source ?? "user",
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		if (input.sourceSessionId) nodeProps.source_session_id = input.sourceSessionId;
		if (input.sourceTurnId) nodeProps.source_turn_id = input.sourceTurnId;
		if (input.project) nodeProps.project = input.project;
		if (input.workingDir) nodeProps.working_dir = input.workingDir;
		if (input.embedding) nodeProps.embedding = input.embedding;

		const propsString = this.buildPropertyString(nodeProps);
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`CREATE (m:Memory {${propsString}}) RETURN m`,
			nodeProps,
		);

		return this.mapToMemory(results[0].m);
	}

	async update(id: string, updates: UpdateMemoryInput): Promise<Memory> {
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
			`Failed to update memory ${id} after ${maxRetries} attempts due to concurrent modifications. Last error: ${lastError?.message}`,
		);
	}

	/**
	 * Internal method to perform a single update attempt.
	 * Separated for retry logic in the public update() method.
	 */
	private async performUpdate(id: string, updates: UpdateMemoryInput): Promise<Memory> {
		const existing = await this.findById(id);
		if (!existing) {
			throw new Error(`Memory not found: ${id}`);
		}

		// Close old version with optimistic locking
		const t = this.now;
		const closeResult = await this.query<{ count: number }>(
			`MATCH (m:Memory {id: $id}) WHERE m.tt_end = ${this.maxDate}
			 SET m.tt_end = $t
			 RETURN count(m) as count`,
			{ id, t },
		);

		// Check if the close operation affected exactly one node
		if (!closeResult[0] || closeResult[0].count === 0) {
			throw new Error(`Concurrent modification detected for memory ${id}. Please retry.`);
		}

		// Create new version with merged properties
		const newTemporal = this.createBitemporal();
		const newId = this.generateId();

		const nodeProps: Record<string, unknown> = {
			id: newId,
			content: updates.content ?? existing.content,
			content_hash: updates.contentHash ?? existing.contentHash,
			type: updates.type ?? existing.type,
			tags: updates.tags ?? existing.tags,
			source_session_id: existing.sourceSessionId,
			source_turn_id: existing.sourceTurnId,
			source: existing.source,
			project: existing.project,
			working_dir: existing.workingDir,
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
		const results = await this.query<{ m: FalkorNode<MemoryNodeProps> }>(
			`CREATE (m:Memory {${propsString}}) RETURN m`,
			nodeProps,
		);

		// Link new version to old
		await this.query(
			`MATCH (new:Memory {id: $newId}), (old:Memory {id: $oldId})
			 CREATE (new)-[:REPLACES {tt_start: $ttStart, tt_end: ${this.maxDate}, vt_start: $vtStart, vt_end: ${this.maxDate}}]->(old)`,
			{ newId, oldId: id, ttStart: newTemporal.tt_start, vtStart: newTemporal.vt_start },
		);

		return this.mapToMemory(results[0].m);
	}

	async delete(id: string): Promise<void> {
		const exists = await this.findById(id);
		if (!exists) {
			throw new Error(`Memory not found: ${id}`);
		}
		await this.softDelete("Memory", id);
	}

	async invalidate(id: string, replacedById?: string): Promise<void> {
		const exists = await this.findById(id);
		if (!exists) {
			throw new Error(`Memory not found: ${id}`);
		}

		const now = this.now;
		const setClause = replacedById
			? "SET m.vt_end = $now, m.tt_end = $now, m.invalidated_at = $now, m.replaced_by = $replacedById"
			: "SET m.vt_end = $now, m.tt_end = $now, m.invalidated_at = $now";

		await this.query(
			`MATCH (m:Memory {id: $id})
			 WHERE m.vt_end > $now
			 ${setClause}
			 RETURN m`,
			{ id, now, replacedById },
		);
	}

	/**
	 * Map FalkorDB node to domain Memory object.
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
