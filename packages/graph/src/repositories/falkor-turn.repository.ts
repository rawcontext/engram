import type { FalkorNode } from "@engram/storage";
import { EdgeTypes } from "../models/edges";
import { FalkorBaseRepository } from "./falkor-base";
import type { TurnRepository } from "./turn.repository";
import type { CreateTurnInput, Turn, UpdateTurnInput } from "./types";

/**
 * Raw FalkorDB Turn node properties.
 */
type TurnNodeProps = {
	id: string;
	user_content: string;
	user_content_hash: string;
	assistant_preview: string;
	assistant_blob_ref?: string;
	embedding?: number[];
	sequence_index: number;
	files_touched: string[];
	tool_calls_count: number;
	input_tokens?: number;
	output_tokens?: number;
	cache_read_tokens?: number;
	cache_write_tokens?: number;
	reasoning_tokens?: number;
	cost_usd?: number;
	duration_ms?: number;
	git_commit?: string;
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

/**
 * FalkorDB implementation of TurnRepository.
 */
export class FalkorTurnRepository extends FalkorBaseRepository implements TurnRepository {
	async findById(id: string): Promise<Turn | null> {
		const results = await this.query<{ t: FalkorNode<TurnNodeProps>; sessionId: string }>(
			`MATCH (s:Session)-[:${EdgeTypes.HAS_TURN}]->(t:Turn {id: $id})
			 WHERE t.tt_end = ${this.maxDate}
			 RETURN t, s.id as sessionId`,
			{ id },
		);
		if (!results[0]?.t) return null;
		return this.mapToTurn(results[0].t, results[0].sessionId);
	}

	async findBySession(sessionId: string): Promise<Turn[]> {
		const results = await this.query<{ t: FalkorNode<TurnNodeProps> }>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)
			 WHERE t.tt_end = ${this.maxDate}
			 RETURN t
			 ORDER BY t.sequence_index ASC`,
			{ sessionId },
		);
		return results.map((r) => this.mapToTurn(r.t, sessionId));
	}

	async findByTimeRange(sessionId: string, start: Date, end: Date): Promise<Turn[]> {
		const results = await this.query<{ t: FalkorNode<TurnNodeProps> }>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)
			 WHERE t.tt_end = ${this.maxDate}
			   AND t.vt_start >= $startTime
			   AND t.vt_start < $endTime
			 RETURN t
			 ORDER BY t.sequence_index ASC`,
			{ sessionId, startTime: start.getTime(), endTime: end.getTime() },
		);
		return results.map((r) => this.mapToTurn(r.t, sessionId));
	}

	async findLatest(sessionId: string, limit: number = 10): Promise<Turn[]> {
		const results = await this.query<{ t: FalkorNode<TurnNodeProps> }>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)
			 WHERE t.tt_end = ${this.maxDate}
			 RETURN t
			 ORDER BY t.sequence_index DESC
			 LIMIT $limit`,
			{ sessionId, limit },
		);
		// Reverse to get chronological order
		return results.toReversed().map((r) => this.mapToTurn(r.t, sessionId));
	}

	async findByFilePath(sessionId: string, filePath: string): Promise<Turn[]> {
		// FalkorDB list contains check
		const results = await this.query<{ t: FalkorNode<TurnNodeProps> }>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)
			 WHERE t.tt_end = ${this.maxDate}
			   AND $filePath IN t.files_touched
			 RETURN t
			 ORDER BY t.sequence_index ASC`,
			{ sessionId, filePath },
		);
		return results.map((r) => this.mapToTurn(r.t, sessionId));
	}

	async create(input: CreateTurnInput): Promise<Turn> {
		const id = this.generateId();
		const temporal = this.createBitemporal();

		const nodeProps: Record<string, unknown> = {
			id,
			user_content: input.userContent,
			user_content_hash: input.userContentHash,
			assistant_preview: input.assistantPreview,
			sequence_index: input.sequenceIndex,
			files_touched: input.filesTouched ?? [],
			tool_calls_count: input.toolCallsCount ?? 0,
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		// Optional fields
		if (input.assistantBlobRef) nodeProps.assistant_blob_ref = input.assistantBlobRef;
		if (input.embedding) nodeProps.embedding = input.embedding;
		if (input.inputTokens !== undefined) nodeProps.input_tokens = input.inputTokens;
		if (input.outputTokens !== undefined) nodeProps.output_tokens = input.outputTokens;
		if (input.cacheReadTokens !== undefined) nodeProps.cache_read_tokens = input.cacheReadTokens;
		if (input.cacheWriteTokens !== undefined) nodeProps.cache_write_tokens = input.cacheWriteTokens;
		if (input.reasoningTokens !== undefined) nodeProps.reasoning_tokens = input.reasoningTokens;
		if (input.costUsd !== undefined) nodeProps.cost_usd = input.costUsd;
		if (input.durationMs !== undefined) nodeProps.duration_ms = input.durationMs;
		if (input.gitCommit) nodeProps.git_commit = input.gitCommit;

		const propsString = this.buildPropertyString(nodeProps);

		// Create node and link to session
		await this.query(
			`MATCH (s:Session {id: $sessionId})
			 WHERE s.tt_end = ${this.maxDate}
			 CREATE (t:Turn {${propsString}})
			 CREATE (s)-[:${EdgeTypes.HAS_TURN} {vt_start: $vt_start, vt_end: $vt_end, tt_start: $tt_start, tt_end: $tt_end}]->(t)`,
			{ sessionId: input.sessionId, ...nodeProps },
		);

		// Link to previous turn if exists
		if (input.sequenceIndex > 0) {
			await this.query(
				`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(prev:Turn {sequence_index: $prevIndex})
				 MATCH (s)-[:${EdgeTypes.HAS_TURN}]->(curr:Turn {id: $currId})
				 WHERE prev.tt_end = ${this.maxDate} AND curr.tt_end = ${this.maxDate}
				 CREATE (prev)-[:${EdgeTypes.NEXT} {vt_start: $vtStart, vt_end: ${this.maxDate}, tt_start: $ttStart, tt_end: ${this.maxDate}}]->(curr)`,
				{
					sessionId: input.sessionId,
					prevIndex: input.sequenceIndex - 1,
					currId: id,
					vtStart: temporal.vt_start,
					ttStart: temporal.tt_start,
				},
			);
		}

		return {
			id,
			sessionId: input.sessionId,
			userContent: input.userContent,
			userContentHash: input.userContentHash,
			assistantPreview: input.assistantPreview,
			assistantBlobRef: input.assistantBlobRef,
			embedding: input.embedding,
			sequenceIndex: input.sequenceIndex,
			filesTouched: input.filesTouched ?? [],
			toolCallsCount: input.toolCallsCount ?? 0,
			inputTokens: input.inputTokens,
			outputTokens: input.outputTokens,
			cacheReadTokens: input.cacheReadTokens,
			cacheWriteTokens: input.cacheWriteTokens,
			reasoningTokens: input.reasoningTokens,
			costUsd: input.costUsd,
			durationMs: input.durationMs,
			gitCommit: input.gitCommit,
			vtStart: temporal.vt_start,
			vtEnd: temporal.vt_end,
			ttStart: temporal.tt_start,
			ttEnd: temporal.tt_end,
		};
	}

	async update(id: string, updates: UpdateTurnInput): Promise<Turn> {
		const existing = await this.findById(id);
		if (!existing) {
			throw new Error(`Turn not found: ${id}`);
		}

		// Build update SET clause
		const updateProps: Record<string, unknown> = {};
		if (updates.assistantPreview !== undefined)
			updateProps.assistant_preview = updates.assistantPreview;
		if (updates.assistantBlobRef !== undefined)
			updateProps.assistant_blob_ref = updates.assistantBlobRef;
		if (updates.embedding !== undefined) updateProps.embedding = updates.embedding;
		if (updates.filesTouched !== undefined) updateProps.files_touched = updates.filesTouched;
		if (updates.toolCallsCount !== undefined) updateProps.tool_calls_count = updates.toolCallsCount;
		if (updates.inputTokens !== undefined) updateProps.input_tokens = updates.inputTokens;
		if (updates.outputTokens !== undefined) updateProps.output_tokens = updates.outputTokens;
		if (updates.cacheReadTokens !== undefined)
			updateProps.cache_read_tokens = updates.cacheReadTokens;
		if (updates.cacheWriteTokens !== undefined)
			updateProps.cache_write_tokens = updates.cacheWriteTokens;
		if (updates.reasoningTokens !== undefined)
			updateProps.reasoning_tokens = updates.reasoningTokens;
		if (updates.costUsd !== undefined) updateProps.cost_usd = updates.costUsd;
		if (updates.durationMs !== undefined) updateProps.duration_ms = updates.durationMs;
		if (updates.gitCommit !== undefined) updateProps.git_commit = updates.gitCommit;

		if (Object.keys(updateProps).length === 0) {
			return existing;
		}

		const setClause = this.buildSetClause(updateProps, "t");
		await this.query(`MATCH (t:Turn {id: $id}) WHERE t.tt_end = ${this.maxDate} SET ${setClause}`, {
			id,
			...updateProps,
		});

		// Return updated turn
		return {
			...existing,
			assistantPreview: updates.assistantPreview ?? existing.assistantPreview,
			assistantBlobRef: updates.assistantBlobRef ?? existing.assistantBlobRef,
			embedding: updates.embedding ?? existing.embedding,
			filesTouched: updates.filesTouched ?? existing.filesTouched,
			toolCallsCount: updates.toolCallsCount ?? existing.toolCallsCount,
			inputTokens: updates.inputTokens ?? existing.inputTokens,
			outputTokens: updates.outputTokens ?? existing.outputTokens,
			cacheReadTokens: updates.cacheReadTokens ?? existing.cacheReadTokens,
			cacheWriteTokens: updates.cacheWriteTokens ?? existing.cacheWriteTokens,
			reasoningTokens: updates.reasoningTokens ?? existing.reasoningTokens,
			costUsd: updates.costUsd ?? existing.costUsd,
			durationMs: updates.durationMs ?? existing.durationMs,
			gitCommit: updates.gitCommit ?? existing.gitCommit,
		};
	}

	async count(sessionId: string): Promise<number> {
		const results = await this.query<{ cnt: number }>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)
			 WHERE t.tt_end = ${this.maxDate}
			 RETURN count(t) as cnt`,
			{ sessionId },
		);
		return results[0]?.cnt ?? 0;
	}

	/**
	 * Map FalkorDB node to domain Turn object.
	 */
	private mapToTurn(node: FalkorNode<TurnNodeProps>, sessionId: string): Turn {
		const props = node.properties;
		return {
			id: props.id,
			sessionId,
			userContent: props.user_content,
			userContentHash: props.user_content_hash,
			assistantPreview: props.assistant_preview,
			assistantBlobRef: props.assistant_blob_ref,
			embedding: props.embedding,
			sequenceIndex: props.sequence_index,
			filesTouched: props.files_touched ?? [],
			toolCallsCount: props.tool_calls_count ?? 0,
			inputTokens: props.input_tokens,
			outputTokens: props.output_tokens,
			cacheReadTokens: props.cache_read_tokens,
			cacheWriteTokens: props.cache_write_tokens,
			reasoningTokens: props.reasoning_tokens,
			costUsd: props.cost_usd,
			durationMs: props.duration_ms,
			gitCommit: props.git_commit,
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}
}
