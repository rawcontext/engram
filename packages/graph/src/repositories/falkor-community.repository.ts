import { createNodeLogger } from "@engram/logger";
import type { FalkorNode } from "@engram/storage";
import type { CommunityRepository } from "./community.repository";
import { FalkorBaseRepository } from "./falkor-base";
import type { Community, CreateCommunityInput, UpdateCommunityInput } from "./types";

const _logger = createNodeLogger({
	service: "graph",
	base: { component: "falkor-community-repository" },
});

/**
 * Raw FalkorDB Community node properties.
 */
type CommunityNodeProps = {
	id: string;
	name: string;
	summary: string;
	keywords: string[];
	member_count: number;
	memory_count: number;
	last_updated: number;
	project?: string;
	org_id?: string;
	embedding?: number[];
	// Bitemporal
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

/**
 * FalkorDB implementation of CommunityRepository.
 * Supports both legacy (single-tenant) and multi-tenant modes via TenantContext.
 */
export class FalkorCommunityRepository extends FalkorBaseRepository implements CommunityRepository {
	async findById(id: string): Promise<Community | null> {
		const results = await this.query<{ c: FalkorNode<CommunityNodeProps> }>(
			`MATCH (c:Community {id: $id}) WHERE c.tt_end = ${this.maxDate} RETURN c`,
			{ id },
		);
		if (!results[0]?.c) return null;
		return this.mapToCommunity(results[0].c);
	}

	async findByProject(project: string): Promise<Community[]> {
		const results = await this.query<{ c: FalkorNode<CommunityNodeProps> }>(
			`MATCH (c:Community {project: $project}) WHERE c.tt_end = ${this.maxDate} RETURN c ORDER BY c.member_count DESC`,
			{ project },
		);
		return results.map((r) => this.mapToCommunity(r.c));
	}

	async getMembers(communityId: string): Promise<string[]> {
		const results = await this.query<{ entityId: string }>(
			`MATCH (e:Entity)-[:MEMBER_OF]->(c:Community {id: $communityId})
			 WHERE e.tt_end = ${this.maxDate}
			 RETURN e.id as entityId`,
			{ communityId },
		);
		return results.map((r) => r.entityId);
	}

	async create(input: CreateCommunityInput): Promise<Community> {
		const id = this.generateId();
		const temporal = this.createBitemporal();
		const now = this.now;

		const nodeProps: Record<string, unknown> = {
			id,
			name: input.name,
			summary: input.summary,
			keywords: input.keywords ?? [],
			member_count: input.memberCount ?? 0,
			memory_count: input.memoryCount ?? 0,
			last_updated: now,
			// Bitemporal
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		if (input.project) nodeProps.project = input.project;
		if (input.orgId) nodeProps.org_id = input.orgId;
		if (input.embedding) nodeProps.embedding = input.embedding;

		const propsString = this.buildPropertyString(nodeProps);
		const results = await this.query<{ c: FalkorNode<CommunityNodeProps> }>(
			`CREATE (c:Community {${propsString}}) RETURN c`,
			nodeProps,
		);

		return this.mapToCommunity(results[0].c);
	}

	async update(id: string, updates: UpdateCommunityInput): Promise<Community> {
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
			`Failed to update community ${id} after ${maxRetries} attempts due to concurrent modifications. Last error: ${lastError?.message}`,
		);
	}

	/**
	 * Internal method to perform a single update attempt.
	 * Separated for retry logic in the public update() method.
	 */
	private async performUpdate(id: string, updates: UpdateCommunityInput): Promise<Community> {
		const existing = await this.findById(id);
		if (!existing) {
			throw new Error(`Community not found: ${id}`);
		}

		// Close old version with optimistic locking
		const t = this.now;
		const closeResult = await this.query<{ count: number }>(
			`MATCH (c:Community {id: $id}) WHERE c.tt_end = ${this.maxDate}
			 SET c.tt_end = $t
			 RETURN count(c) as count`,
			{ id, t },
		);

		// Check if the close operation affected exactly one node
		if (!closeResult[0] || closeResult[0].count === 0) {
			throw new Error(`Concurrent modification detected for community ${id}. Please retry.`);
		}

		// Create new version with merged properties
		const newTemporal = this.createBitemporal();
		const newId = this.generateId();

		const nodeProps: Record<string, unknown> = {
			id: newId,
			name: updates.name ?? existing.name,
			summary: updates.summary ?? existing.summary,
			keywords: updates.keywords ?? existing.keywords,
			member_count: updates.memberCount ?? existing.memberCount,
			memory_count: updates.memoryCount ?? existing.memoryCount,
			last_updated: t,
			project: existing.project,
			org_id: existing.orgId,
			embedding: updates.embedding ?? existing.embedding,
			// Bitemporal
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
		const results = await this.query<{ c: FalkorNode<CommunityNodeProps> }>(
			`CREATE (c:Community {${propsString}}) RETURN c`,
			nodeProps,
		);

		// Link new version to old
		await this.query(
			`MATCH (new:Community {id: $newId}), (old:Community {id: $oldId})
			 CREATE (new)-[:REPLACES {tt_start: $ttStart, tt_end: ${this.maxDate}, vt_start: $vtStart, vt_end: ${this.maxDate}}]->(old)`,
			{ newId, oldId: id, ttStart: newTemporal.tt_start, vtStart: newTemporal.vt_start },
		);

		return this.mapToCommunity(results[0].c);
	}

	async findExistingByMemberOverlap(
		memberIds: string[],
		minOverlap: number = 2,
	): Promise<Array<{ community: Community; overlapCount: number }>> {
		if (memberIds.length === 0) {
			return [];
		}

		const results = await this.query<{ c: FalkorNode<CommunityNodeProps>; overlapCount: number }>(
			`MATCH (e:Entity)-[:MEMBER_OF]->(c:Community)
			 WHERE e.id IN $memberIds AND c.tt_end = ${this.maxDate} AND e.tt_end = ${this.maxDate}
			 WITH c, count(DISTINCT e) as overlapCount
			 WHERE overlapCount >= $minOverlap
			 RETURN c, overlapCount
			 ORDER BY overlapCount DESC`,
			{ memberIds, minOverlap },
		);

		return results.map((r) => ({
			community: this.mapToCommunity(r.c),
			overlapCount: r.overlapCount,
		}));
	}

	async findActive(): Promise<Community[]> {
		const results = await this.query<{ c: FalkorNode<CommunityNodeProps> }>(
			`MATCH (c:Community) WHERE c.tt_end = ${this.maxDate} RETURN c ORDER BY c.member_count DESC`,
		);
		return results.map((r) => this.mapToCommunity(r.c));
	}

	async delete(id: string): Promise<void> {
		const exists = await this.findById(id);
		if (!exists) {
			throw new Error(`Community not found: ${id}`);
		}
		await this.softDelete("Community", id);
	}

	/**
	 * Map FalkorDB node to domain Community object.
	 */
	private mapToCommunity(node: FalkorNode<CommunityNodeProps>): Community {
		if (!node || !node.properties) {
			throw new Error("Invalid node: node or properties is null/undefined");
		}
		const props = node.properties;
		return {
			id: props.id,
			name: props.name,
			summary: props.summary,
			keywords: Array.isArray(props.keywords) ? props.keywords : [],
			memberCount: props.member_count ?? 0,
			memoryCount: props.memory_count ?? 0,
			lastUpdated: props.last_updated,
			project: props.project,
			orgId: props.org_id,
			embedding: props.embedding,
			// Bitemporal
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}
}
