import type { MemoryNode, MemoryType } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type {
	ContextItem,
	CreateMemoryInput,
	IEngramClient,
	RecallFilters,
	RecallResult,
} from "../interfaces";
import { EngramApiError } from "./errors";

export interface EngramCloudClientOptions {
	apiKey: string;
	baseUrl: string;
	logger?: Logger;
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
		usage?: Record<string, unknown>;
	};
}

/**
 * Engram Cloud API client
 *
 * Implements IEngramClient interface for cloud mode operations.
 * All operations are proxied to the Engram Cloud API.
 */
export class EngramCloudClient implements IEngramClient {
	private apiKey: string;
	private baseUrl: string;
	private logger?: Logger;

	constructor(options: EngramCloudClientOptions) {
		this.apiKey = options.apiKey;
		this.baseUrl = options.baseUrl.replace(/\/$/, ""); // Remove trailing slash
		this.logger = options.logger;
	}

	/**
	 * Make an authenticated request to the API
	 */
	private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`;

		this.logger?.debug({ url, method: options.method ?? "GET" }, "API request");

		const response = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
				...options.headers,
			},
		});

		const body = (await response.json()) as ApiResponse<T>;

		if (!body.success || body.error) {
			throw new EngramApiError(
				body.error?.code ?? "UNKNOWN_ERROR",
				body.error?.message ?? "An unknown error occurred",
				response.status,
				body.error?.details,
			);
		}

		return body.data as T;
	}

	// ============================================
	// IMemoryStore implementation
	// ============================================

	async createMemory(input: CreateMemoryInput): Promise<MemoryNode> {
		const result = await this.request<{
			id: string;
			stored: boolean;
			duplicate: boolean;
		}>("/v1/memory/remember", {
			method: "POST",
			body: JSON.stringify({
				content: input.content,
				type: input.type,
				tags: input.tags,
				project: input.project,
			}),
		});

		// Return a minimal MemoryNode structure
		// The cloud API returns the stored memory
		const now = Date.now();
		return {
			id: result.id,
			labels: ["Memory"],
			content: input.content,
			content_hash: "", // Not returned by API
			type: (input.type ?? "context") as MemoryType,
			tags: input.tags ?? [],
			source: input.source ?? "user",
			source_session_id: input.sourceSessionId,
			source_turn_id: input.sourceTurnId,
			project: input.project,
			working_dir: input.workingDir,
			vt_start: now,
			vt_end: Number.MAX_SAFE_INTEGER,
			tt_start: now,
			tt_end: Number.MAX_SAFE_INTEGER,
		} as MemoryNode;
	}

	async getMemory(id: string): Promise<MemoryNode | null> {
		try {
			const results = await this.query<MemoryNode>(
				"MATCH (m:Memory {id: $id}) WHERE m.vt_end > $now RETURN m",
				{ id, now: Date.now() },
			);
			return results.length > 0 ? results[0] : null;
		} catch {
			return null;
		}
	}

	async listMemories(options?: {
		type?: MemoryType;
		project?: string;
		limit?: number;
	}): Promise<MemoryNode[]> {
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

		return this.query<MemoryNode>(cypher, params);
	}

	async deleteMemory(id: string): Promise<boolean> {
		try {
			const results = await this.query<{ deleted: boolean }>(
				"MATCH (m:Memory {id: $id}) SET m.vt_end = $now RETURN true as deleted",
				{ id, now: Date.now() },
			);
			return results.length > 0;
		} catch {
			return false;
		}
	}

	// ============================================
	// IMemoryRetriever implementation
	// ============================================

	async recall(queryText: string, limit = 5, filters?: RecallFilters): Promise<RecallResult[]> {
		const result = await this.request<{ memories: RecallResult[] }>("/v1/memory/recall", {
			method: "POST",
			body: JSON.stringify({
				query: queryText,
				limit,
				filters: filters
					? {
							type: filters.type,
							project: filters.project,
							after: filters.since,
						}
					: undefined,
			}),
		});

		return result.memories;
	}

	// ============================================
	// Graph query
	// ============================================

	async query<T = unknown>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
		const result = await this.request<{ results: T[] }>("/v1/memory/query", {
			method: "POST",
			body: JSON.stringify({ cypher, params }),
		});

		return result.results;
	}

	// ============================================
	// Context retrieval
	// ============================================

	async getContext(
		task: string,
		files?: string[],
		depth: "shallow" | "medium" | "deep" = "medium",
	): Promise<ContextItem[]> {
		const result = await this.request<{ context: ContextItem[] }>("/v1/memory/context", {
			method: "POST",
			body: JSON.stringify({ task, files, depth }),
		});

		return result.context;
	}

	// ============================================
	// Connection management (no-op for cloud)
	// ============================================

	async connect(): Promise<void> {
		// No-op: Cloud client doesn't need explicit connection
		this.logger?.debug("Cloud client connect (no-op)");
	}

	async disconnect(): Promise<void> {
		// No-op: Cloud client doesn't need explicit disconnection
		this.logger?.debug("Cloud client disconnect (no-op)");
	}
}
