import type { FalkorNode } from "@engram/storage";
import { EdgeTypes } from "../models/edges";
import { FalkorBaseRepository } from "./falkor-base";
import type { FileTouchRepository } from "./file-touch.repository";
import type { CreateFileTouchInput, FileTouch } from "./types";

/**
 * Raw FalkorDB FileTouch node properties.
 */
type FileTouchNodeProps = {
	id: string;
	file_path: string;
	action: string;
	tool_call_id?: string;
	sequence_index?: number;
	diff_preview?: string;
	lines_added?: number;
	lines_removed?: number;
	match_count?: number;
	matched_files?: string[];
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

/**
 * FalkorDB implementation of FileTouchRepository.
 * Supports both legacy (single-tenant) and multi-tenant modes.
 */
export class FalkorFileTouchRepository extends FalkorBaseRepository implements FileTouchRepository {
	async findById(id: string): Promise<FileTouch | null> {
		const results = await this.query<{ ft: FalkorNode<FileTouchNodeProps>; toolCallId: string }>(
			`MATCH (tc:ToolCall)-[:${EdgeTypes.TOUCHES}]->(ft:FileTouch {id: $id})
			 WHERE ft.tt_end = ${this.maxDate}
			 RETURN ft, tc.id as toolCallId`,
			{ id },
		);
		if (!results[0]?.ft) return null;
		return this.mapToFileTouch(results[0].ft, results[0].toolCallId);
	}

	async findByToolCall(toolCallId: string): Promise<FileTouch[]> {
		const results = await this.query<{ ft: FalkorNode<FileTouchNodeProps> }>(
			`MATCH (tc:ToolCall {id: $toolCallId})-[:${EdgeTypes.TOUCHES}]->(ft:FileTouch)
			 WHERE ft.tt_end = ${this.maxDate}
			 RETURN ft
			 ORDER BY ft.sequence_index ASC`,
			{ toolCallId },
		);
		return results.map((row) => this.mapToFileTouch(row.ft, toolCallId));
	}

	async findByTurn(turnId: string): Promise<FileTouch[]> {
		const results = await this.query<{
			ft: FalkorNode<FileTouchNodeProps>;
			toolCallId: string;
			tcSeq: number;
		}>(
			`MATCH (t:Turn {id: $turnId})-[:${EdgeTypes.INVOKES}]->(tc:ToolCall)-[:${EdgeTypes.TOUCHES}]->(ft:FileTouch)
			 WHERE tc.tt_end = ${this.maxDate} AND ft.tt_end = ${this.maxDate}
			 RETURN ft, tc.id as toolCallId, tc.sequence_index as tcSeq
			 ORDER BY tcSeq ASC, ft.sequence_index ASC`,
			{ turnId },
		);
		return results.map((row) => this.mapToFileTouch(row.ft, row.toolCallId));
	}

	async findBySession(sessionId: string): Promise<FileTouch[]> {
		const results = await this.query<{
			ft: FalkorNode<FileTouchNodeProps>;
			toolCallId: string;
			turnSeq: number;
			tcSeq: number;
		}>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall)-[:${EdgeTypes.TOUCHES}]->(ft:FileTouch)
			 WHERE t.tt_end = ${this.maxDate} AND tc.tt_end = ${this.maxDate} AND ft.tt_end = ${this.maxDate}
			 RETURN ft, tc.id as toolCallId, t.sequence_index as turnSeq, tc.sequence_index as tcSeq
			 ORDER BY turnSeq ASC, tcSeq ASC, ft.sequence_index ASC`,
			{ sessionId },
		);
		return results.map((row) => this.mapToFileTouch(row.ft, row.toolCallId));
	}

	async findByFilePath(filePath: string): Promise<FileTouch[]> {
		const results = await this.query<{ ft: FalkorNode<FileTouchNodeProps>; toolCallId: string }>(
			`MATCH (tc:ToolCall)-[:${EdgeTypes.TOUCHES}]->(ft:FileTouch {file_path: $filePath})
			 WHERE ft.tt_end = ${this.maxDate}
			 RETURN ft, tc.id as toolCallId
			 ORDER BY ft.vt_start DESC`,
			{ filePath },
		);
		return results.map((row) => this.mapToFileTouch(row.ft, row.toolCallId));
	}

	async findByFilePathInSession(sessionId: string, filePath: string): Promise<FileTouch[]> {
		const results = await this.query<{
			ft: FalkorNode<FileTouchNodeProps>;
			toolCallId: string;
			turnSeq: number;
			tcSeq: number;
		}>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall)-[:${EdgeTypes.TOUCHES}]->(ft:FileTouch {file_path: $filePath})
			 WHERE t.tt_end = ${this.maxDate} AND tc.tt_end = ${this.maxDate} AND ft.tt_end = ${this.maxDate}
			 RETURN ft, tc.id as toolCallId, t.sequence_index as turnSeq, tc.sequence_index as tcSeq
			 ORDER BY turnSeq ASC, tcSeq ASC, ft.sequence_index ASC`,
			{ sessionId, filePath },
		);
		return results.map((row) => this.mapToFileTouch(row.ft, row.toolCallId));
	}

	async findByAction(sessionId: string, action: string): Promise<FileTouch[]> {
		const results = await this.query<{
			ft: FalkorNode<FileTouchNodeProps>;
			toolCallId: string;
			turnSeq: number;
			tcSeq: number;
		}>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall)-[:${EdgeTypes.TOUCHES}]->(ft:FileTouch {action: $action})
			 WHERE t.tt_end = ${this.maxDate} AND tc.tt_end = ${this.maxDate} AND ft.tt_end = ${this.maxDate}
			 RETURN ft, tc.id as toolCallId, t.sequence_index as turnSeq, tc.sequence_index as tcSeq
			 ORDER BY turnSeq ASC, tcSeq ASC, ft.sequence_index ASC`,
			{ sessionId, action },
		);
		return results.map((row) => this.mapToFileTouch(row.ft, row.toolCallId));
	}

	async create(input: CreateFileTouchInput): Promise<FileTouch> {
		const id = this.generateId();
		const temporal = this.createBitemporal();

		const nodeProps: Record<string, unknown> = {
			id,
			file_path: input.filePath,
			action: input.action,
			tool_call_id: input.toolCallId,
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		if (input.sequenceIndex !== undefined) nodeProps.sequence_index = input.sequenceIndex;
		if (input.diffPreview) nodeProps.diff_preview = input.diffPreview;
		if (input.linesAdded !== undefined) nodeProps.lines_added = input.linesAdded;
		if (input.linesRemoved !== undefined) nodeProps.lines_removed = input.linesRemoved;
		if (input.matchCount !== undefined) nodeProps.match_count = input.matchCount;
		if (input.matchedFiles) nodeProps.matched_files = input.matchedFiles;

		const propsString = this.buildPropertyString(nodeProps);

		// Create node and link to tool call
		await this.query(
			`MATCH (tc:ToolCall {id: $toolCallId})
			 WHERE tc.tt_end = ${this.maxDate}
			 CREATE (ft:FileTouch {${propsString}})
			 CREATE (tc)-[:${EdgeTypes.TOUCHES} {vt_start: $vt_start, vt_end: $vt_end, tt_start: $tt_start, tt_end: $tt_end}]->(ft)`,
			{ toolCallId: input.toolCallId, ...nodeProps },
		);

		return {
			id,
			toolCallId: input.toolCallId,
			filePath: input.filePath,
			action: input.action,
			sequenceIndex: input.sequenceIndex,
			diffPreview: input.diffPreview,
			linesAdded: input.linesAdded,
			linesRemoved: input.linesRemoved,
			matchCount: input.matchCount,
			matchedFiles: input.matchedFiles,
			vtStart: temporal.vt_start,
			vtEnd: temporal.vt_end,
			ttStart: temporal.tt_start,
			ttEnd: temporal.tt_end,
		};
	}

	async createBatch(inputs: CreateFileTouchInput[]): Promise<FileTouch[]> {
		const results: FileTouch[] = [];

		// Group inputs by toolCallId for more efficient batching
		const byToolCall = new Map<string, CreateFileTouchInput[]>();
		for (const input of inputs) {
			const existing = byToolCall.get(input.toolCallId) ?? [];
			existing.push(input);
			byToolCall.set(input.toolCallId, existing);
		}

		for (const [toolCallId, toolCallInputs] of byToolCall) {
			for (const input of toolCallInputs) {
				const fileTouch = await this.create({ ...input, toolCallId });
				results.push(fileTouch);
			}
		}

		return results;
	}

	async count(toolCallId: string): Promise<number> {
		const results = await this.query<{ cnt: number }>(
			`MATCH (tc:ToolCall {id: $toolCallId})-[:${EdgeTypes.TOUCHES}]->(ft:FileTouch)
			 WHERE ft.tt_end = ${this.maxDate}
			 RETURN count(ft) as cnt`,
			{ toolCallId },
		);
		return results[0]?.cnt ?? 0;
	}

	async countByAction(sessionId: string): Promise<Record<string, number>> {
		const results = await this.query<{ action: string; cnt: number }>(
			`MATCH (s:Session {id: $sessionId})-[:${EdgeTypes.HAS_TURN}]->(t:Turn)-[:${EdgeTypes.INVOKES}]->(tc:ToolCall)-[:${EdgeTypes.TOUCHES}]->(ft:FileTouch)
			 WHERE t.tt_end = ${this.maxDate} AND tc.tt_end = ${this.maxDate} AND ft.tt_end = ${this.maxDate}
			 RETURN ft.action as action, count(ft) as cnt`,
			{ sessionId },
		);

		const counts: Record<string, number> = {};
		for (const row of results) {
			counts[row.action] = row.cnt;
		}
		return counts;
	}

	/**
	 * Map FalkorDB node to domain FileTouch object.
	 */
	private mapToFileTouch(node: FalkorNode<FileTouchNodeProps>, toolCallId: string): FileTouch {
		if (!node || !node.properties) {
			throw new Error("Invalid node: node or properties is null/undefined");
		}
		const props = node.properties;
		return {
			id: props.id,
			toolCallId,
			filePath: props.file_path,
			action: props.action,
			sequenceIndex: props.sequence_index,
			diffPreview: props.diff_preview,
			linesAdded: props.lines_added,
			linesRemoved: props.lines_removed,
			matchCount: props.match_count,
			matchedFiles: props.matched_files,
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}
}
