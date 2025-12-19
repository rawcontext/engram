import type { FalkorNode } from "@engram/storage";
import { FalkorBaseRepository } from "./falkor-base";
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

		// Close old version
		const t = this.now;
		await this.query(
			`MATCH (s:Session {id: $id}) WHERE s.tt_end = ${this.maxDate} SET s.tt_end = $t`,
			{ id, t },
		);

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
			metadata: props.metadata ? JSON.parse(props.metadata) : undefined,
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}
}
