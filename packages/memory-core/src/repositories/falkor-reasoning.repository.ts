import type { FalkorNode } from "@engram/storage";
import { EdgeTypes } from "../models/edges";
import { FalkorBaseRepository } from "./falkor-base";
import type { ReasoningRepository } from "./reasoning.repository";
import type { CreateReasoningInput, Reasoning } from "./types";

/**
 * Raw FalkorDB Reasoning node properties.
 */
type ReasoningNodeProps = {
	id: string;
	content_hash: string;
	preview: string;
	blob_ref?: string;
	reasoning_type: string;
	sequence_index: number;
	embedding?: number[];
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

/**
 * FalkorDB implementation of ReasoningRepository.
 */
export class FalkorReasoningRepository extends FalkorBaseRepository implements ReasoningRepository {
	async findById(id: string): Promise<Reasoning | null> {
		const results = await this.query<{ r: FalkorNode<ReasoningNodeProps>; turnId: string }>(
			`MATCH (t:Turn)-[:${EdgeTypes.CONTAINS}]->(r:Reasoning {id: $id})
			 WHERE r.tt_end = ${this.maxDate}
			 RETURN r, t.id as turnId`,
			{ id },
		);
		if (!results[0]?.r) return null;
		return this.mapToReasoning(results[0].r, results[0].turnId);
	}

	async findByTurn(turnId: string): Promise<Reasoning[]> {
		const results = await this.query<{ r: FalkorNode<ReasoningNodeProps> }>(
			`MATCH (t:Turn {id: $turnId})-[:${EdgeTypes.CONTAINS}]->(r:Reasoning)
			 WHERE r.tt_end = ${this.maxDate}
			 RETURN r
			 ORDER BY r.sequence_index ASC`,
			{ turnId },
		);
		return results.map((row) => this.mapToReasoning(row.r, turnId));
	}

	async findBySession(sessionId: string): Promise<Reasoning[]> {
		const results = await this.query<{
			r: FalkorNode<ReasoningNodeProps>;
			turnId: string;
			turnSeq: number;
		}>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.CONTAINS}]->(r:Reasoning)
			 WHERE t.tt_end = ${this.maxDate} AND r.tt_end = ${this.maxDate}
			 RETURN r, t.id as turnId, t.sequence_index as turnSeq
			 ORDER BY turnSeq ASC, r.sequence_index ASC`,
			{ sessionId },
		);
		return results.map((row) => this.mapToReasoning(row.r, row.turnId));
	}

	async findByType(sessionId: string, reasoningType: string): Promise<Reasoning[]> {
		const results = await this.query<{
			r: FalkorNode<ReasoningNodeProps>;
			turnId: string;
			turnSeq: number;
		}>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.CONTAINS}]->(r:Reasoning {reasoning_type: $reasoningType})
			 WHERE t.tt_end = ${this.maxDate} AND r.tt_end = ${this.maxDate}
			 RETURN r, t.id as turnId, t.sequence_index as turnSeq
			 ORDER BY turnSeq ASC, r.sequence_index ASC`,
			{ sessionId, reasoningType },
		);
		return results.map((row) => this.mapToReasoning(row.r, row.turnId));
	}

	async create(input: CreateReasoningInput): Promise<Reasoning> {
		const id = this.generateId();
		const temporal = this.createBitemporal();

		const nodeProps: Record<string, unknown> = {
			id,
			content_hash: input.contentHash,
			preview: input.preview,
			reasoning_type: input.reasoningType ?? "unknown",
			sequence_index: input.sequenceIndex,
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		if (input.blobRef) nodeProps.blob_ref = input.blobRef;
		if (input.embedding) nodeProps.embedding = input.embedding;

		const propsString = this.buildPropertyString(nodeProps);

		// Create node and link to turn
		await this.query(
			`MATCH (t:Turn {id: $turnId})
			 WHERE t.tt_end = ${this.maxDate}
			 CREATE (r:Reasoning {${propsString}})
			 CREATE (t)-[:${EdgeTypes.CONTAINS} {vt_start: $vt_start, vt_end: $vt_end, tt_start: $tt_start, tt_end: $tt_end}]->(r)`,
			{ turnId: input.turnId, ...nodeProps },
		);

		return {
			id,
			turnId: input.turnId,
			contentHash: input.contentHash,
			preview: input.preview,
			blobRef: input.blobRef,
			reasoningType: input.reasoningType ?? "unknown",
			sequenceIndex: input.sequenceIndex,
			embedding: input.embedding,
			vtStart: temporal.vt_start,
			vtEnd: temporal.vt_end,
			ttStart: temporal.tt_start,
			ttEnd: temporal.tt_end,
		};
	}

	async createBatch(inputs: CreateReasoningInput[]): Promise<Reasoning[]> {
		const results: Reasoning[] = [];

		// Group inputs by turnId for more efficient batching
		const byTurn = new Map<string, CreateReasoningInput[]>();
		for (const input of inputs) {
			const existing = byTurn.get(input.turnId) ?? [];
			existing.push(input);
			byTurn.set(input.turnId, existing);
		}

		for (const [turnId, turnInputs] of byTurn) {
			for (const input of turnInputs) {
				const reasoning = await this.create({ ...input, turnId });
				results.push(reasoning);
			}
		}

		return results;
	}

	async count(turnId: string): Promise<number> {
		const results = await this.query<{ cnt: number }>(
			`MATCH (t:Turn {id: $turnId})-[:${EdgeTypes.CONTAINS}]->(r:Reasoning)
			 WHERE r.tt_end = ${this.maxDate}
			 RETURN count(r) as cnt`,
			{ turnId },
		);
		return results[0]?.cnt ?? 0;
	}

	/**
	 * Map FalkorDB node to domain Reasoning object.
	 */
	private mapToReasoning(node: FalkorNode<ReasoningNodeProps>, turnId: string): Reasoning {
		const props = node.properties;
		return {
			id: props.id,
			turnId,
			contentHash: props.content_hash,
			preview: props.preview,
			blobRef: props.blob_ref,
			reasoningType: props.reasoning_type,
			sequenceIndex: props.sequence_index,
			embedding: props.embedding,
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}
}
