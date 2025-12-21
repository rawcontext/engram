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
				throw error;
			}
		}

		throw new Error(
			`Failed to update turn ${id} after ${maxRetries} attempts due to concurrent modifications. Last error: ${lastError?.message}`,
		);
	}

	/**
	 * Internal method to perform a single update attempt with proper bitemporal versioning.
	 * Creates a new version and closes the old one (immutable history).
	 */
	private async performUpdate(id: string, updates: UpdateTurnInput): Promise<Turn> {
		const existing = await this.findById(id);
		if (!existing) {
			throw new Error(`Turn not found: ${id}`);
		}

		// Check if there are any updates to apply
		const hasUpdates =
			updates.assistantPreview !== undefined ||
			updates.assistantBlobRef !== undefined ||
			updates.embedding !== undefined ||
			updates.filesTouched !== undefined ||
			updates.toolCallsCount !== undefined ||
			updates.inputTokens !== undefined ||
			updates.outputTokens !== undefined ||
			updates.cacheReadTokens !== undefined ||
			updates.cacheWriteTokens !== undefined ||
			updates.reasoningTokens !== undefined ||
			updates.costUsd !== undefined ||
			updates.durationMs !== undefined ||
			updates.gitCommit !== undefined;

		if (!hasUpdates) {
			return existing;
		}

		// Close old version with optimistic locking
		const t = this.now;
		const closeResult = await this.query<{ count: number }>(
			`MATCH (t:Turn {id: $id}) WHERE t.tt_end = ${this.maxDate}
			 SET t.tt_end = $t
			 RETURN count(t) as count`,
			{ id, t },
		);

		if (!closeResult[0] || closeResult[0].count === 0) {
			throw new Error(`Concurrent modification detected for turn ${id}. Please retry.`);
		}

		// Create new version with merged properties
		const newTemporal = this.createBitemporal();
		const newId = this.generateId();

		const nodeProps: Record<string, unknown> = {
			id: newId,
			user_content: existing.userContent,
			user_content_hash: existing.userContentHash,
			assistant_preview: updates.assistantPreview ?? existing.assistantPreview,
			sequence_index: existing.sequenceIndex,
			files_touched: updates.filesTouched ?? existing.filesTouched,
			tool_calls_count: updates.toolCallsCount ?? existing.toolCallsCount,
			vt_start: newTemporal.vt_start,
			vt_end: newTemporal.vt_end,
			tt_start: newTemporal.tt_start,
			tt_end: newTemporal.tt_end,
		};

		// Optional fields - use update value if provided, else existing value
		const assistantBlobRef = updates.assistantBlobRef ?? existing.assistantBlobRef;
		if (assistantBlobRef) nodeProps.assistant_blob_ref = assistantBlobRef;

		const embedding = updates.embedding ?? existing.embedding;
		if (embedding) nodeProps.embedding = embedding;

		const inputTokens = updates.inputTokens ?? existing.inputTokens;
		if (inputTokens !== undefined) nodeProps.input_tokens = inputTokens;

		const outputTokens = updates.outputTokens ?? existing.outputTokens;
		if (outputTokens !== undefined) nodeProps.output_tokens = outputTokens;

		const cacheReadTokens = updates.cacheReadTokens ?? existing.cacheReadTokens;
		if (cacheReadTokens !== undefined) nodeProps.cache_read_tokens = cacheReadTokens;

		const cacheWriteTokens = updates.cacheWriteTokens ?? existing.cacheWriteTokens;
		if (cacheWriteTokens !== undefined) nodeProps.cache_write_tokens = cacheWriteTokens;

		const reasoningTokens = updates.reasoningTokens ?? existing.reasoningTokens;
		if (reasoningTokens !== undefined) nodeProps.reasoning_tokens = reasoningTokens;

		const costUsd = updates.costUsd ?? existing.costUsd;
		if (costUsd !== undefined) nodeProps.cost_usd = costUsd;

		const durationMs = updates.durationMs ?? existing.durationMs;
		if (durationMs !== undefined) nodeProps.duration_ms = durationMs;

		const gitCommit = updates.gitCommit ?? existing.gitCommit;
		if (gitCommit) nodeProps.git_commit = gitCommit;

		const propsString = this.buildPropertyString(nodeProps);

		// Create new turn and link to session
		await this.query(
			`MATCH (s:Session {id: $sessionId})
			 WHERE s.tt_end = ${this.maxDate}
			 CREATE (t:Turn {${propsString}})
			 CREATE (s)-[:${EdgeTypes.HAS_TURN} {vt_start: $vt_start, vt_end: $vt_end, tt_start: $tt_start, tt_end: $tt_end}]->(t)`,
			{ sessionId: existing.sessionId, ...nodeProps },
		);

		// Link new version to old with REPLACES edge
		await this.query(
			`MATCH (new:Turn {id: $newId}), (old:Turn {id: $oldId})
			 CREATE (new)-[:REPLACES {tt_start: $ttStart, tt_end: ${this.maxDate}, vt_start: $vtStart, vt_end: ${this.maxDate}}]->(old)`,
			{ newId, oldId: id, ttStart: newTemporal.tt_start, vtStart: newTemporal.vt_start },
		);

		// Re-establish NEXT edges if this turn had them
		// Link from previous turn to new version
		if (existing.sequenceIndex > 0) {
			await this.query(
				`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(prev:Turn {sequence_index: $prevIndex})
				 MATCH (s)-[:${EdgeTypes.HAS_TURN}]->(curr:Turn {id: $currId})
				 WHERE prev.tt_end = ${this.maxDate} AND curr.tt_end = ${this.maxDate}
				 CREATE (prev)-[:${EdgeTypes.NEXT} {vt_start: $vtStart, vt_end: ${this.maxDate}, tt_start: $ttStart, tt_end: ${this.maxDate}}]->(curr)`,
				{
					sessionId: existing.sessionId,
					prevIndex: existing.sequenceIndex - 1,
					currId: newId,
					vtStart: newTemporal.vt_start,
					ttStart: newTemporal.tt_start,
				},
			);
		}

		// Link to next turn if it exists
		const nextTurnResult = await this.query<{ nextId: string }>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(next:Turn {sequence_index: $nextIndex})
			 WHERE next.tt_end = ${this.maxDate}
			 RETURN next.id as nextId`,
			{ sessionId: existing.sessionId, nextIndex: existing.sequenceIndex + 1 },
		);

		if (nextTurnResult[0]?.nextId) {
			await this.query(
				`MATCH (curr:Turn {id: $currId}), (next:Turn {id: $nextId})
				 WHERE curr.tt_end = ${this.maxDate} AND next.tt_end = ${this.maxDate}
				 CREATE (curr)-[:${EdgeTypes.NEXT} {vt_start: $vtStart, vt_end: ${this.maxDate}, tt_start: $ttStart, tt_end: ${this.maxDate}}]->(next)`,
				{
					currId: newId,
					nextId: nextTurnResult[0].nextId,
					vtStart: newTemporal.vt_start,
					ttStart: newTemporal.tt_start,
				},
			);
		}

		return {
			id: newId,
			sessionId: existing.sessionId,
			userContent: existing.userContent,
			userContentHash: existing.userContentHash,
			assistantPreview: updates.assistantPreview ?? existing.assistantPreview,
			assistantBlobRef,
			embedding,
			sequenceIndex: existing.sequenceIndex,
			filesTouched: updates.filesTouched ?? existing.filesTouched,
			toolCallsCount: updates.toolCallsCount ?? existing.toolCallsCount,
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheWriteTokens,
			reasoningTokens,
			costUsd,
			durationMs,
			gitCommit,
			vtStart: newTemporal.vt_start,
			vtEnd: newTemporal.vt_end,
			ttStart: newTemporal.tt_start,
			ttEnd: newTemporal.tt_end,
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
		if (!node || !node.properties) {
			throw new Error("Invalid node: node or properties is null/undefined");
		}
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
