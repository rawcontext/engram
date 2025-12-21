import type { FalkorNode } from "@engram/storage";
import { EdgeTypes } from "../models/edges";
import { FalkorBaseRepository } from "./falkor-base";
import type { ToolCallRepository } from "./tool-call.repository";
import type { CreateToolCallInput, ToolCall, ToolResult } from "./types";

/**
 * Raw FalkorDB ToolCall node properties.
 */
type ToolCallNodeProps = {
	id: string;
	call_id: string;
	tool_name: string;
	tool_type: string;
	arguments_json: string;
	arguments_preview?: string;
	status: string;
	error_message?: string;
	sequence_index: number;
	reasoning_sequence?: number;
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

/**
 * FalkorDB implementation of ToolCallRepository.
 */
export class FalkorToolCallRepository extends FalkorBaseRepository implements ToolCallRepository {
	async findById(id: string): Promise<ToolCall | null> {
		const results = await this.query<{ tc: FalkorNode<ToolCallNodeProps>; turnId: string }>(
			`MATCH (t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall {id: $id})
			 WHERE tc.tt_end = ${this.maxDate}
			 RETURN tc, t.id as turnId`,
			{ id },
		);
		if (!results[0]?.tc) return null;
		return this.mapToToolCall(results[0].tc, results[0].turnId);
	}

	async findByCallId(callId: string): Promise<ToolCall | null> {
		const results = await this.query<{ tc: FalkorNode<ToolCallNodeProps>; turnId: string }>(
			`MATCH (t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall {call_id: $callId})
			 WHERE tc.tt_end = ${this.maxDate}
			 RETURN tc, t.id as turnId`,
			{ callId },
		);
		if (!results[0]?.tc) return null;
		return this.mapToToolCall(results[0].tc, results[0].turnId);
	}

	async findByTurn(turnId: string): Promise<ToolCall[]> {
		const results = await this.query<{ tc: FalkorNode<ToolCallNodeProps> }>(
			`MATCH (t:Turn {id: $turnId})-[:${EdgeTypes.INVOKES}]->(tc:ToolCall)
			 WHERE tc.tt_end = ${this.maxDate}
			 RETURN tc
			 ORDER BY tc.sequence_index ASC`,
			{ turnId },
		);
		return results.map((row) => this.mapToToolCall(row.tc, turnId));
	}

	async findBySession(sessionId: string): Promise<ToolCall[]> {
		const results = await this.query<{
			tc: FalkorNode<ToolCallNodeProps>;
			turnId: string;
			turnSeq: number;
		}>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall)
			 WHERE t.tt_end = ${this.maxDate} AND tc.tt_end = ${this.maxDate}
			 RETURN tc, t.id as turnId, t.sequence_index as turnSeq
			 ORDER BY turnSeq ASC, tc.sequence_index ASC`,
			{ sessionId },
		);
		return results.map((row) => this.mapToToolCall(row.tc, row.turnId));
	}

	async findByToolType(sessionId: string, toolType: string): Promise<ToolCall[]> {
		const results = await this.query<{
			tc: FalkorNode<ToolCallNodeProps>;
			turnId: string;
			turnSeq: number;
		}>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall {tool_type: $toolType})
			 WHERE t.tt_end = ${this.maxDate} AND tc.tt_end = ${this.maxDate}
			 RETURN tc, t.id as turnId, t.sequence_index as turnSeq
			 ORDER BY turnSeq ASC, tc.sequence_index ASC`,
			{ sessionId, toolType },
		);
		return results.map((row) => this.mapToToolCall(row.tc, row.turnId));
	}

	async findByStatus(sessionId: string, status: string): Promise<ToolCall[]> {
		const results = await this.query<{
			tc: FalkorNode<ToolCallNodeProps>;
			turnId: string;
			turnSeq: number;
		}>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall {status: $status})
			 WHERE t.tt_end = ${this.maxDate} AND tc.tt_end = ${this.maxDate}
			 RETURN tc, t.id as turnId, t.sequence_index as turnSeq
			 ORDER BY turnSeq ASC, tc.sequence_index ASC`,
			{ sessionId, status },
		);
		return results.map((row) => this.mapToToolCall(row.tc, row.turnId));
	}

	async findPending(sessionId?: string): Promise<ToolCall[]> {
		if (sessionId) {
			return this.findByStatus(sessionId, "pending");
		}

		const results = await this.query<{ tc: FalkorNode<ToolCallNodeProps>; turnId: string }>(
			`MATCH (t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall {status: 'pending'})
			 WHERE tc.tt_end = ${this.maxDate}
			 RETURN tc, t.id as turnId
			 ORDER BY tc.vt_start ASC`,
		);
		return results.map((row) => this.mapToToolCall(row.tc, row.turnId));
	}

	async create(input: CreateToolCallInput): Promise<ToolCall> {
		const id = this.generateId();
		const temporal = this.createBitemporal();

		const nodeProps: Record<string, unknown> = {
			id,
			call_id: input.callId,
			tool_name: input.toolName,
			tool_type: input.toolType ?? "unknown",
			arguments_json: input.argumentsJson,
			status: input.status ?? "pending",
			sequence_index: input.sequenceIndex,
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		if (input.argumentsPreview) nodeProps.arguments_preview = input.argumentsPreview;
		if (input.errorMessage) nodeProps.error_message = input.errorMessage;
		if (input.reasoningSequence !== undefined)
			nodeProps.reasoning_sequence = input.reasoningSequence;

		const propsString = this.buildPropertyString(nodeProps);

		// Create node and link to turn
		await this.query(
			`MATCH (t:Turn {id: $turnId})
			 WHERE t.tt_end = ${this.maxDate}
			 CREATE (tc:ToolCall {${propsString}})
			 CREATE (t)-[:${EdgeTypes.INVOKES} {vt_start: $vt_start, vt_end: $vt_end, tt_start: $tt_start, tt_end: $tt_end}]->(tc)`,
			{ turnId: input.turnId, ...nodeProps },
		);

		// If there's a reasoning sequence, link to the triggering Reasoning node
		if (input.reasoningSequence !== undefined) {
			await this.query(
				`MATCH (t:Turn {id: $turnId})-[:${EdgeTypes.CONTAINS}]->(r:Reasoning {sequence_index: $reasoningSeq})
				 MATCH (t)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall {id: $tcId})
				 WHERE r.tt_end = ${this.maxDate} AND tc.tt_end = ${this.maxDate}
				 CREATE (r)-[:${EdgeTypes.TRIGGERS} {vt_start: $vtStart, vt_end: ${this.maxDate}, tt_start: $ttStart, tt_end: ${this.maxDate}}]->(tc)`,
				{
					turnId: input.turnId,
					reasoningSeq: input.reasoningSequence,
					tcId: id,
					vtStart: temporal.vt_start,
					ttStart: temporal.tt_start,
				},
			);
		}

		return {
			id,
			turnId: input.turnId,
			callId: input.callId,
			toolName: input.toolName,
			toolType: input.toolType ?? "unknown",
			argumentsJson: input.argumentsJson,
			argumentsPreview: input.argumentsPreview,
			status: input.status ?? "pending",
			errorMessage: input.errorMessage,
			sequenceIndex: input.sequenceIndex,
			reasoningSequence: input.reasoningSequence,
			vtStart: temporal.vt_start,
			vtEnd: temporal.vt_end,
			ttStart: temporal.tt_start,
			ttEnd: temporal.tt_end,
		};
	}

	async createBatch(inputs: CreateToolCallInput[]): Promise<ToolCall[]> {
		const results: ToolCall[] = [];

		// Group inputs by turnId for more efficient batching
		const byTurn = new Map<string, CreateToolCallInput[]>();
		for (const input of inputs) {
			const existing = byTurn.get(input.turnId) ?? [];
			existing.push(input);
			byTurn.set(input.turnId, existing);
		}

		for (const [turnId, turnInputs] of byTurn) {
			for (const input of turnInputs) {
				const toolCall = await this.create({ ...input, turnId });
				results.push(toolCall);
			}
		}

		return results;
	}

	async updateResult(id: string, result: ToolResult): Promise<ToolCall> {
		const existing = await this.findById(id);
		if (!existing) {
			throw new Error(`ToolCall not found: ${id}`);
		}

		const updateProps: Record<string, unknown> = {
			status: result.status,
		};
		if (result.errorMessage) updateProps.error_message = result.errorMessage;

		const setClause = this.buildSetClause(updateProps, "tc");
		await this.query(
			`MATCH (tc:ToolCall {id: $id}) WHERE tc.tt_end = ${this.maxDate} SET ${setClause}`,
			{ id, ...updateProps },
		);

		return {
			...existing,
			status: result.status,
			errorMessage: result.errorMessage ?? existing.errorMessage,
		};
	}

	async count(turnId: string): Promise<number> {
		const results = await this.query<{ cnt: number }>(
			`MATCH (t:Turn {id: $turnId})-[:${EdgeTypes.INVOKES}]->(tc:ToolCall)
			 WHERE tc.tt_end = ${this.maxDate}
			 RETURN count(tc) as cnt`,
			{ turnId },
		);
		return results[0]?.cnt ?? 0;
	}

	async countByStatus(sessionId: string): Promise<Record<string, number>> {
		const results = await this.query<{ status: string; cnt: number }>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall)
			 WHERE t.tt_end = ${this.maxDate} AND tc.tt_end = ${this.maxDate}
			 RETURN tc.status as status, count(tc) as cnt`,
			{ sessionId },
		);

		const counts: Record<string, number> = {};
		for (const row of results) {
			counts[row.status] = row.cnt;
		}
		return counts;
	}

	/**
	 * Map FalkorDB node to domain ToolCall object.
	 */
	private mapToToolCall(node: FalkorNode<ToolCallNodeProps>, turnId: string): ToolCall {
		if (!node || !node.properties) {
			throw new Error("Invalid node: node or properties is null/undefined");
		}
		const props = node.properties;
		return {
			id: props.id,
			turnId,
			callId: props.call_id,
			toolName: props.tool_name,
			toolType: props.tool_type,
			argumentsJson: props.arguments_json,
			argumentsPreview: props.arguments_preview,
			status: props.status,
			errorMessage: props.error_message,
			sequenceIndex: props.sequence_index,
			reasoningSequence: props.reasoning_sequence,
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}
}
