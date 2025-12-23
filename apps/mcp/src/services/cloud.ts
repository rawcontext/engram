/**
 * Engram Cloud Client
 *
 * HTTP client for the Engram Cloud API that implements IEngramClient.
 * Used in cloud mode to proxy MCP tool calls to the Hetzner API.
 */

import type { MemoryNode, MemoryType } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type {
	ContextItem,
	CreateMemoryInput,
	IEngramClient,
	RecallFilters,
	RecallResult,
} from "./interfaces";

export interface EngramCloudClientOptions {
	apiKey: string;
	baseUrl: string;
	logger: Logger;
}

interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
	meta?: {
		usage?: unknown;
	};
}

export class EngramCloudClient implements IEngramClient {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly logger: Logger;

	constructor(options: EngramCloudClientOptions) {
		this.apiKey = options.apiKey;
		this.baseUrl = options.baseUrl.replace(/\/$/, ""); // Remove trailing slash
		this.logger = options.logger;
	}

	// ==========================================================================
	// HTTP Helpers
	// ==========================================================================

	private async request<T>(
		method: "GET" | "POST" | "DELETE",
		path: string,
		body?: unknown,
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.apiKey}`,
		};

		this.logger.debug({ method, url, body }, "API request");

		const response = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});

		const json = (await response.json()) as ApiResponse<T>;

		if (!response.ok || !json.success) {
			const error = json.error ?? { code: "UNKNOWN_ERROR", message: "Request failed" };
			this.logger.error({ status: response.status, error }, "API error");
			throw new Error(`${error.code}: ${error.message}`);
		}

		this.logger.debug({ status: response.status, data: json.data }, "API response");
		return json.data as T;
	}

	// ==========================================================================
	// IMemoryStore Implementation
	// ==========================================================================

	async createMemory(input: CreateMemoryInput): Promise<MemoryNode> {
		const result = await this.request<{ id: string; stored: boolean; duplicate: boolean }>(
			"POST",
			"/v1/memory/remember",
			{
				content: input.content,
				type: input.type,
				tags: input.tags,
				project: input.project,
			},
		);

		// The API returns a minimal response; construct a MemoryNode-like object
		// Note: This is a best-effort construction since the API doesn't return full node data
		const now = Date.now();
		const memoryNode: MemoryNode = {
			id: result.id,
			labels: ["Memory"],
			content: input.content,
			content_hash: "", // Not returned by API
			type: (input.type ?? "context") as MemoryType,
			tags: input.tags ?? [],
			source: input.source ?? "user",
			project: input.project,
			working_dir: input.workingDir,
			source_session_id: input.sourceSessionId,
			source_turn_id: input.sourceTurnId,
			vt_start: now,
			vt_end: 253402300799000,
			tt_start: now,
			tt_end: 253402300799000,
		};

		this.logger.info(
			{ id: result.id, stored: result.stored, duplicate: result.duplicate },
			"Memory created via cloud API",
		);
		return memoryNode;
	}

	async getMemory(id: string): Promise<MemoryNode | null> {
		// Not available in current API - use query endpoint as fallback
		try {
			const results = await this.query<MemoryNode>(
				"MATCH (m:Memory {id: $id}) WHERE m.tt_end > timestamp() RETURN m",
				{ id },
			);
			return results[0] ?? null;
		} catch (error) {
			this.logger.warn({ id, error }, "getMemory not available in cloud mode");
			return null;
		}
	}

	async listMemories(options?: {
		type?: MemoryType;
		project?: string;
		limit?: number;
	}): Promise<MemoryNode[]> {
		// Not directly available - use query endpoint
		try {
			const limit = options?.limit ?? 20;
			let cypher = "MATCH (m:Memory) WHERE m.tt_end > timestamp()";

			if (options?.type) {
				cypher += " AND m.type = $type";
			}
			if (options?.project) {
				cypher += " AND m.project = $project";
			}

			cypher += " RETURN m ORDER BY m.vt_start DESC LIMIT $limit";

			return await this.query<MemoryNode>(cypher, {
				type: options?.type,
				project: options?.project,
				limit,
			});
		} catch (error) {
			this.logger.warn({ options, error }, "listMemories not available in cloud mode");
			return [];
		}
	}

	async deleteMemory(id: string): Promise<boolean> {
		// Not available in current API
		this.logger.warn({ id }, "deleteMemory not available in cloud mode");
		return false;
	}

	async connect(): Promise<void> {
		// HTTP client doesn't need connection management
		this.logger.debug("Cloud client connected (no-op)");
	}

	async disconnect(): Promise<void> {
		// HTTP client doesn't need connection management
		this.logger.debug("Cloud client disconnected (no-op)");
	}

	// ==========================================================================
	// IMemoryRetriever Implementation
	// ==========================================================================

	async recall(query: string, limit = 5, filters?: RecallFilters): Promise<RecallResult[]> {
		// API returns camelCase but our interface uses snake_case
		interface ApiMemoryResult {
			id: string;
			content: string;
			type: string;
			tags: string[];
			score?: number;
			createdAt: string;
		}

		const result = await this.request<{ memories: ApiMemoryResult[] }>(
			"POST",
			"/v1/memory/recall",
			{
				query,
				limit,
				filters: filters
					? {
							type: filters.type,
							project: filters.project,
							after: filters.since,
						}
					: undefined,
			},
		);

		// Map API response to RecallResult interface
		return result.memories.map((m) => ({
			id: m.id,
			content: m.content,
			score: m.score ?? 0,
			type: m.type,
			created_at: m.createdAt,
			project: filters?.project,
		}));
	}

	// ==========================================================================
	// IEngramClient Additional Methods
	// ==========================================================================

	async query<T = unknown>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
		const result = await this.request<{ results: T[] }>("POST", "/v1/memory/query", {
			cypher,
			params,
		});

		return result.results;
	}

	async getContext(
		task: string,
		files?: string[],
		depth: "shallow" | "medium" | "deep" = "medium",
	): Promise<ContextItem[]> {
		const result = await this.request<{ context: ContextItem[] }>("POST", "/v1/memory/context", {
			task,
			files,
			depth,
		});

		return result.context;
	}
}
