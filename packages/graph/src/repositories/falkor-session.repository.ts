import type { FalkorNode } from "@engram/storage";
import { FalkorBaseRepository, type TimeTravelOptions } from "./falkor-base";
import type { SessionRepository } from "./session.repository";
import type { CreateSessionInput, Session, UpdateSessionInput } from "./types";

/**
 * Raw FalkorDB Session node properties.
 */
type SessionNodeProps = {
	id: string;
	external_id?: string;
	title?: string;
	user_id: string;
	provider?: string;
	started_at: number;
	working_dir?: string;
	git_remote?: string;
	agent_type: string;
	summary?: string;
	embedding?: number[];
	metadata?: string; // JSON string
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

/**
 * FalkorDB implementation of SessionRepository.
 */
export class FalkorSessionRepository extends FalkorBaseRepository implements SessionRepository {
	async findById(id: string): Promise<Session | null> {
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(
			`MATCH (s:Session {id: $id}) WHERE s.tt_end = ${this.maxDate} RETURN s`,
			{ id },
		);
		if (!results[0]?.s) return null;
		return this.mapToSession(results[0].s);
	}

	/**
	 * Find a session as it existed at a specific point in time.
	 * Supports both valid time (vt) and transaction time (tt) queries.
	 *
	 * @param id - Session ID
	 * @param time - Time-travel options (vt and/or tt)
	 * @returns Session as it existed at the specified time, or null if not found
	 *
	 * @example
	 * // Get session as it was valid on Jan 1, 2024
	 * const session = await repo.findByIdAt('123', { vt: Date.parse('2024-01-01') });
	 *
	 * @example
	 * // Get session as it was recorded in the database at a specific time
	 * const session = await repo.findByIdAt('123', { tt: Date.parse('2024-01-01') });
	 *
	 * @example
	 * // Get current version (default behavior)
	 * const session = await repo.findByIdAt('123', { tt: 'current' });
	 */
	async findByIdAt(id: string, time: TimeTravelOptions): Promise<Session | null> {
		const qb = this.createQueryBuilder().match("(s:Session {id: $id})").at(["s"], time).return("s");

		const { cypher, params } = qb.build();
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(cypher, {
			...params,
			id,
		});

		if (!results[0]?.s) return null;
		return this.mapToSession(results[0].s);
	}

	/**
	 * Find all sessions for a user as they existed at a specific point in time.
	 *
	 * @param userId - User ID
	 * @param time - Time-travel options (vt and/or tt)
	 * @returns Sessions as they existed at the specified time
	 */
	async findByUserAt(userId: string, time: TimeTravelOptions): Promise<Session[]> {
		const qb = this.createQueryBuilder()
			.match("(s:Session {user_id: $userId})")
			.at(["s"], time)
			.return("s");

		const { cypher, params } = qb.build();
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(cypher, {
			...params,
			userId,
		});

		return results.map((r) => this.mapToSession(r.s));
	}

	async findByExternalId(externalId: string): Promise<Session | null> {
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(
			`MATCH (s:Session {external_id: $externalId}) WHERE s.tt_end = ${this.maxDate} RETURN s`,
			{ externalId },
		);
		if (!results[0]?.s) return null;
		return this.mapToSession(results[0].s);
	}

	async findActive(): Promise<Session[]> {
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(
			`MATCH (s:Session) WHERE s.tt_end = ${this.maxDate} RETURN s ORDER BY s.started_at DESC`,
		);
		return results.map((r) => this.mapToSession(r.s));
	}

	async findByProvider(provider: string): Promise<Session[]> {
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(
			`MATCH (s:Session {agent_type: $provider}) WHERE s.tt_end = ${this.maxDate} RETURN s ORDER BY s.started_at DESC`,
			{ provider },
		);
		return results.map((r) => this.mapToSession(r.s));
	}

	async findByUser(userId: string): Promise<Session[]> {
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(
			`MATCH (s:Session {user_id: $userId}) WHERE s.tt_end = ${this.maxDate} RETURN s ORDER BY s.started_at DESC`,
			{ userId },
		);
		return results.map((r) => this.mapToSession(r.s));
	}

	async findByWorkingDir(workingDir: string): Promise<Session[]> {
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(
			`MATCH (s:Session {working_dir: $workingDir}) WHERE s.tt_end = ${this.maxDate} RETURN s ORDER BY s.started_at DESC`,
			{ workingDir },
		);
		return results.map((r) => this.mapToSession(r.s));
	}

	async create(input: CreateSessionInput): Promise<Session> {
		const id = this.generateId();
		const temporal = this.createBitemporal();
		const startedAt = this.now;

		const nodeProps: Record<string, unknown> = {
			id,
			user_id: input.userId,
			started_at: startedAt,
			agent_type: input.agentType ?? "unknown",
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		if (input.externalId) nodeProps.external_id = input.externalId;
		if (input.title) nodeProps.title = input.title;
		if (input.provider) nodeProps.provider = input.provider;
		if (input.workingDir) nodeProps.working_dir = input.workingDir;
		if (input.gitRemote) nodeProps.git_remote = input.gitRemote;
		if (input.metadata) nodeProps.metadata = JSON.stringify(input.metadata);

		const propsString = this.buildPropertyString(nodeProps);
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(
			`CREATE (s:Session {${propsString}}) RETURN s`,
			nodeProps,
		);

		return this.mapToSession(results[0].s);
	}

	async update(id: string, updates: UpdateSessionInput): Promise<Session> {
		const existing = await this.findById(id);
		if (!existing) {
			throw new Error(`Session not found: ${id}`);
		}

		// Close old version with optimistic locking
		// Only close if tt_end is still maxDate (concurrent update detection)
		const t = this.now;
		const closeResult = await this.query<{ count: number }>(
			`MATCH (s:Session {id: $id}) WHERE s.tt_end = ${this.maxDate}
			 SET s.tt_end = $t
			 RETURN count(s) as count`,
			{ id, t },
		);

		// Check if the close operation affected exactly one node
		// If zero rows affected, another transaction closed it first
		if (!closeResult[0] || closeResult[0].count === 0) {
			throw new Error(`Concurrent modification detected for session ${id}. Please retry.`);
		}

		// Prepare update properties
		const updateProps: Record<string, unknown> = {};
		if (updates.title !== undefined) updateProps.title = updates.title;
		if (updates.summary !== undefined) updateProps.summary = updates.summary;
		if (updates.embedding !== undefined) updateProps.embedding = updates.embedding;
		if (updates.metadata !== undefined) updateProps.metadata = JSON.stringify(updates.metadata);

		// Create new version with merged properties
		const newTemporal = this.createBitemporal();
		const newId = this.generateId();

		const nodeProps: Record<string, unknown> = {
			id: newId,
			external_id: existing.externalId,
			user_id: existing.userId,
			started_at: existing.startedAt.getTime(),
			agent_type: existing.agentType,
			working_dir: existing.workingDir,
			git_remote: existing.gitRemote,
			provider: existing.provider,
			title: updates.title ?? existing.title,
			summary: updates.summary ?? existing.summary,
			embedding: updates.embedding ?? existing.embedding,
			metadata: updates.metadata
				? JSON.stringify(updates.metadata)
				: existing.metadata
					? JSON.stringify(existing.metadata)
					: undefined,
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
		const results = await this.query<{ s: FalkorNode<SessionNodeProps> }>(
			`CREATE (s:Session {${propsString}}) RETURN s`,
			nodeProps,
		);

		// Link new version to old
		await this.query(
			`MATCH (new:Session {id: $newId}), (old:Session {id: $oldId})
			 CREATE (new)-[:REPLACES {tt_start: $ttStart, tt_end: ${this.maxDate}, vt_start: $vtStart, vt_end: ${this.maxDate}}]->(old)`,
			{ newId, oldId: id, ttStart: newTemporal.tt_start, vtStart: newTemporal.vt_start },
		);

		return this.mapToSession(results[0].s);
	}

	async delete(id: string): Promise<void> {
		const exists = await this.findById(id);
		if (!exists) {
			throw new Error(`Session not found: ${id}`);
		}
		await this.softDelete("Session", id);
	}

	/**
	 * Safely parse JSON with fallback.
	 * Logs a warning if parsing fails.
	 */
	private safeParseJson<T>(jsonString: string | undefined, fallback: T, context: string): T {
		if (!jsonString) return fallback;
		try {
			return JSON.parse(jsonString) as T;
		} catch {
			// Log warning but don't fail - return fallback value
			console.warn(`[FalkorSessionRepository] Failed to parse ${context} JSON, using fallback`);
			return fallback;
		}
	}

	/**
	 * Map FalkorDB node to domain Session object.
	 */
	private mapToSession(node: FalkorNode<SessionNodeProps>): Session {
		const props = node.properties;
		return {
			id: props.id,
			externalId: props.external_id,
			title: props.title,
			userId: props.user_id,
			provider: props.provider,
			startedAt: new Date(props.started_at),
			workingDir: props.working_dir,
			gitRemote: props.git_remote,
			agentType: props.agent_type,
			summary: props.summary,
			embedding: props.embedding,
			metadata: this.safeParseJson(props.metadata, undefined, "metadata"),
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}
}
