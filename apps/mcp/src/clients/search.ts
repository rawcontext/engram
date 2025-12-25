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
	collection?: string;
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

export class SearchClient {
	private baseUrl: string;
	private logger: Logger;
	private apiKey?: string;

	constructor(baseUrl: string, logger?: Logger, apiKey?: string) {
		this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
		this.apiKey = apiKey;
		this.logger =
			logger ??
			createNodeLogger({
				service: "engram-mcp",
				base: { component: "SearchClient" },
			});
	}

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
			collection: options.collection,
		};

		this.logger.debug({ url, requestBody }, "Sending search request to search");

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};
				if (this.apiKey) {
					headers.Authorization = `Bearer ${this.apiKey}`;
				}

				const response = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(requestBody),
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

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
				clearTimeout(timeoutId);
				throw error;
			}
		} catch (error) {
			this.logger.error({ error, url }, "Search-py request failed");
			throw error;
		}
	}

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
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 30000);

			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};
				if (this.apiKey) {
					headers.Authorization = `Bearer ${this.apiKey}`;
				}

				const response = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(requestBody),
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(
						`Memory index request failed with status ${response.status}: ${errorText}`,
					);
				}

				const data = (await response.json()) as MemoryIndexResponse;

				this.logger.debug({ id: data.id, took_ms: data.took_ms }, "Memory indexed");

				return data;
			} catch (error) {
				clearTimeout(timeoutId);
				throw error;
			}
		} catch (error) {
			this.logger.error({ error, url }, "Memory index request failed");
			throw error;
		}
	}
}
