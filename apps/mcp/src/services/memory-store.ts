import { createHash } from "node:crypto";
import { type MemoryNode, MemoryNodeSchema, type MemoryType } from "@engram/graph";
import { createLogger, type Logger } from "@engram/logger";
import { createFalkorClient, type GraphClient } from "@engram/storage";
import { ulid } from "ulid";

export interface CreateMemoryInput {
	content: string;
	type?: MemoryType;
	tags?: string[];
	project?: string;
	workingDir?: string;
	sourceSessionId?: string;
	sourceTurnId?: string;
	source?: "user" | "auto" | "import";
}

export interface MemoryStoreOptions {
	graphClient?: GraphClient;
	logger?: Logger;
}

export class MemoryStore {
	private graphClient: GraphClient;
	private logger: Logger;

	constructor(options?: MemoryStoreOptions) {
		this.graphClient = options?.graphClient ?? createFalkorClient();
		this.logger = options?.logger ?? createLogger({ component: "MemoryStore" });
	}

	async connect(): Promise<void> {
		await this.graphClient.connect();
	}

	async disconnect(): Promise<void> {
		await this.graphClient.disconnect();
	}

	async createMemory(input: CreateMemoryInput): Promise<MemoryNode> {
		await this.connect();

		const now = Date.now();
		const contentHash = createHash("sha256").update(input.content).digest("hex");

		// Check for duplicate content
		const existing = await this.graphClient.query(
			`MATCH (m:Memory {content_hash: $contentHash}) RETURN m`,
			{ contentHash },
		);

		if (Array.isArray(existing) && existing.length > 0) {
			this.logger.debug({ contentHash }, "Duplicate memory detected, returning existing");
			// Return existing memory
			const existingNode = existing[0] as { m: { properties: MemoryNode } };
			return existingNode.m.properties;
		}

		const id = ulid();
		const memory: MemoryNode = {
			id,
			labels: ["Memory"] as const,
			content: input.content,
			content_hash: contentHash,
			type: input.type ?? "context",
			tags: input.tags ?? [],
			source: input.source ?? "user",
			source_session_id: input.sourceSessionId,
			source_turn_id: input.sourceTurnId,
			project: input.project,
			working_dir: input.workingDir,
			// Bitemporal properties
			vt_start: now,
			vt_end: Number.MAX_SAFE_INTEGER,
			tt_start: now,
			tt_end: Number.MAX_SAFE_INTEGER,
		};

		// Validate with Zod
		MemoryNodeSchema.parse(memory);

		await this.graphClient.query(
			`CREATE (m:Memory {
				id: $id,
				content: $content,
				content_hash: $contentHash,
				type: $type,
				tags: $tags,
				source: $source,
				source_session_id: $sourceSessionId,
				source_turn_id: $sourceTurnId,
				project: $project,
				working_dir: $workingDir,
				vt_start: $vtStart,
				vt_end: $vtEnd,
				tt_start: $ttStart,
				tt_end: $ttEnd
			})`,
			{
				id,
				content: memory.content,
				contentHash: memory.content_hash,
				type: memory.type,
				tags: memory.tags,
				source: memory.source,
				sourceSessionId: memory.source_session_id ?? null,
				sourceTurnId: memory.source_turn_id ?? null,
				project: memory.project ?? null,
				workingDir: memory.working_dir ?? null,
				vtStart: memory.vt_start,
				vtEnd: memory.vt_end,
				ttStart: memory.tt_start,
				ttEnd: memory.tt_end,
			},
		);

		this.logger.info({ id, type: memory.type }, "Created memory");
		return memory;
	}

	async getMemory(id: string): Promise<MemoryNode | null> {
		await this.connect();

		const result = await this.graphClient.query(`MATCH (m:Memory {id: $id}) RETURN m`, { id });

		if (!Array.isArray(result) || result.length === 0) {
			return null;
		}

		const node = result[0] as { m: { properties: MemoryNode } };
		return node.m.properties;
	}

	async listMemories(options?: {
		type?: MemoryType;
		project?: string;
		limit?: number;
	}): Promise<MemoryNode[]> {
		await this.connect();

		const { type, project, limit = 50 } = options ?? {};

		let cypher = "MATCH (m:Memory) WHERE m.vt_end > $now";
		const params: Record<string, unknown> = { now: Date.now() };

		if (type) {
			cypher += " AND m.type = $type";
			params.type = type;
		}

		if (project) {
			cypher += " AND m.project = $project";
			params.project = project;
		}

		cypher += " RETURN m ORDER BY m.vt_start DESC LIMIT $limit";
		params.limit = limit;

		const result = await this.graphClient.query(cypher, params);

		if (!Array.isArray(result)) {
			return [];
		}

		return result.map((row) => {
			const typedRow = row as { m: { properties: MemoryNode } };
			return typedRow.m.properties;
		});
	}

	async deleteMemory(id: string): Promise<boolean> {
		await this.connect();

		// Soft delete - update vt_end to now
		const now = Date.now();
		const result = await this.graphClient.query(
			`MATCH (m:Memory {id: $id}) SET m.vt_end = $now RETURN m`,
			{ id, now },
		);

		return Array.isArray(result) && result.length > 0;
	}
}
