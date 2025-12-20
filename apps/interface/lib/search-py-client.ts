/**
 * HTTP client for search-py service
 * Base URL: http://localhost:5002 (configurable via SEARCH_PY_URL env var)
 */

export type RerankerTier = "fast" | "accurate" | "code" | "llm";

export interface SearchPyFilters {
	session_id?: string;
	type?: "thought" | "code" | "doc";
	time_range?: {
		start: number;
		end: number;
	};
}

export interface SearchPyRequest {
	text: string;
	limit?: number;
	threshold?: number;
	filters?: SearchPyFilters;
	strategy?: "hybrid" | "dense" | "sparse";
	rerank?: boolean;
	rerank_tier?: RerankerTier;
	rerank_depth?: number;
}

export interface SearchPyResult {
	id: string;
	score: number;
	rrf_score: number | null;
	reranker_score: number | null;
	rerank_tier: RerankerTier | null;
	payload: Record<string, unknown>;
	degraded: boolean;
}

export interface SearchPyResponse {
	results: SearchPyResult[];
	total: number;
	took_ms: number;
}

export class SearchPyError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public details?: unknown,
	) {
		super(message);
		this.name = "SearchPyError";
	}
}

/**
 * Calls the search-py service /search endpoint
 * @param request Search request parameters
 * @param baseUrl Base URL for search-py service (default: SEARCH_PY_URL env var or http://localhost:5002)
 * @returns Search results
 * @throws SearchPyError on failure
 */
export async function searchPy(
	request: SearchPyRequest,
	baseUrl?: string,
): Promise<SearchPyResponse> {
	const url = baseUrl || process.env.SEARCH_PY_URL || "http://localhost:5002";
	const endpoint = `${url}/search`;

	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			let errorMessage = `Search-py request failed with status ${response.status}`;
			let errorDetails: unknown;

			try {
				const errorBody = await response.json();
				errorMessage = errorBody.message || errorBody.error || errorMessage;
				errorDetails = errorBody;
			} catch {
				// If response body is not JSON, use status text
				errorMessage = response.statusText || errorMessage;
			}

			throw new SearchPyError(errorMessage, response.status, errorDetails);
		}

		const data = await response.json();
		return data as SearchPyResponse;
	} catch (error) {
		if (error instanceof SearchPyError) {
			throw error;
		}

		if (error instanceof Error) {
			throw new SearchPyError(
				`Failed to connect to search-py service: ${error.message}`,
				undefined,
				error,
			);
		}

		throw new SearchPyError("Unknown error occurred while calling search-py service");
	}
}
