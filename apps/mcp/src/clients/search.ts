import { createLogger, type Logger } from "@engram/logger";

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

export class SearchClient {
	private baseUrl: string;
	private logger: Logger;

	constructor(baseUrl: string, logger?: Logger) {
		this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
		this.logger = logger ?? createLogger({ component: "SearchClient" });
	}

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

		this.logger.debug({ url, requestBody }, "Sending search request to search");

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Search-py request failed with status ${response.status}: ${errorText}`);
			}

			const data = (await response.json()) as SearchResponse;

			this.logger.debug(
				{ total: data.total, took_ms: data.took_ms },
				"Search-py request completed",
			);

			return data;
		} catch (error) {
			this.logger.error({ error, url }, "Search-py request failed");
			throw error;
		}
	}
}
