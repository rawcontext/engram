/**
 * HTTP client for the Python search service.
 *
 * Provides search functionality by calling the search service API at port 5002.
 * This replaces direct Qdrant integration with a service-oriented approach.
 *
 * @module @engram/api/clients/search
 */

import type { Logger } from "@engram/logger";

export interface SearchFilters {
	session_id?: string;
	type?: "thought" | "code" | "doc";
	time_range?: {
		start: number;
		end: number;
	};
}

export interface SearchOptions {
	text: string;
	limit?: number;
	threshold?: number;
	filters?: SearchFilters;
	strategy?: "hybrid" | "vector" | "bm25";
	rerank?: boolean;
	rerank_tier?: "fast" | "accurate" | "code" | "llm";
	rerank_depth?: number;
}

export interface SearchResult {
	id: string;
	score: number;
	rrf_score: number | null;
	reranker_score: number | null;
	rerank_tier: string | null;
	payload: Record<string, unknown>;
	degraded: boolean;
}

export interface SearchResponse {
	results: SearchResult[];
	total: number;
	took_ms: number;
}

export interface MemoryIndexOptions {
	id: string;
	content: string;
	type?: string;
	tags?: string[];
	project?: string;
	source_session_id?: string;
}

export interface MemoryIndexResponse {
	id: string;
	indexed: boolean;
	took_ms: number;
}

/**
 * HTTP client for the Python search service.
 *
 * @example
 * ```ts
 * const client = new SearchClient("http://localhost:5002", logger);
 * const response = await client.search({ text: "user question", limit: 5 });
 * console.log(response.results);
 * ```
 */
export class SearchClient {
	private baseUrl: string;
	private logger: Logger;

	constructor(baseUrl: string, logger: Logger) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.logger = logger;
	}

	/**
	 * Perform a search query against the search service.
	 */
	async search(options: SearchOptions): Promise<SearchResponse> {
		const url = `${this.baseUrl}/v1/search`;

		const requestBody = {
			text: options.text,
			limit: options.limit ?? 10,
			threshold: options.threshold ?? 0.5,
			filters: options.filters ?? {},
			strategy: options.strategy ?? "hybrid",
			rerank: options.rerank ?? false,
			rerank_tier: options.rerank_tier,
			rerank_depth: options.rerank_depth,
		};

		this.logger.debug({ url, query: options.text.slice(0, 50) }, "Sending search request");

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Search request failed with status ${response.status}: ${errorText}`);
			}

			const data = (await response.json()) as SearchResponse;

			this.logger.debug({ total: data.total, took_ms: data.took_ms }, "Search request completed");

			return data;
		} catch (error) {
			this.logger.error({ error, url }, "Search request failed");
			throw error;
		}
	}

	/**
	 * Check if the search service is healthy.
	 */
	async health(): Promise<{ status: string; qdrant_connected: boolean }> {
		const url = `${this.baseUrl}/v1/health`;

		try {
			const response = await fetch(url);
			if (!response.ok) {
				return { status: "unhealthy", qdrant_connected: false };
			}
			return (await response.json()) as { status: string; qdrant_connected: boolean };
		} catch {
			return { status: "unreachable", qdrant_connected: false };
		}
	}

	/**
	 * Index a memory for semantic search.
	 */
	async indexMemory(options: MemoryIndexOptions): Promise<MemoryIndexResponse> {
		const url = `${this.baseUrl}/v1/index/memory`;

		const requestBody = {
			id: options.id,
			content: options.content,
			type: options.type ?? "context",
			tags: options.tags ?? [],
			project: options.project,
			source_session_id: options.source_session_id,
		};

		this.logger.debug({ url, id: options.id }, "Sending memory index request");

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Memory index request failed with status ${response.status}: ${errorText}`);
			}

			const data = (await response.json()) as MemoryIndexResponse;

			this.logger.debug({ id: data.id, took_ms: data.took_ms }, "Memory indexed");

			return data;
		} catch (error) {
			this.logger.error({ error, url }, "Memory index request failed");
			throw error;
		}
	}
}
