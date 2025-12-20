/**
 * HTTP client for the Python search service.
 *
 * Provides search functionality by calling the search service API at port 5002.
 * This replaces the deprecated TypeScript @engram/search package.
 *
 * @module @engram/control/clients/search
 */

import { createNodeLogger, type Logger } from "@engram/logger";

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

/**
 * HTTP client for the Python search service.
 *
 * @example
 * ```ts
 * const client = new SearchClient("http://localhost:5002");
 * const response = await client.search({ text: "user question", limit: 5 });
 * console.log(response.results);
 * ```
 */
export class SearchClient {
	private baseUrl: string;
	private logger: Logger;

	constructor(baseUrl: string, logger?: Logger) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.logger =
			logger ??
			createNodeLogger({ service: "control-service", base: { component: "SearchClient" } });
	}

	/**
	 * Perform a search query against the search service.
	 */
	async search(options: SearchOptions): Promise<SearchResponse> {
		const url = `${this.baseUrl}/search`;

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
		const url = `${this.baseUrl}/health`;

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
}

/**
 * Create a SearchClient with default configuration.
 */
export function createSearchClient(baseUrl?: string): SearchClient {
	const url = baseUrl ?? process.env.SEARCH_URL ?? "http://localhost:5002";
	return new SearchClient(url);
}
