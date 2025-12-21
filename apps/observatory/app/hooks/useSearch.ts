"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

export interface SearchResultPayload {
	content: string;
	node_id: string;
	session_id: string;
	type: "thought" | "code" | "doc";
	timestamp: number;
	file_path?: string;
}

export interface SearchResult {
	id: string;
	/** Final score used for ranking */
	score: number;
	/** Original RRF/dense/sparse score before reranking */
	rrfScore?: number;
	/** Cross-encoder relevance score, present if reranking was applied */
	rerankerScore?: number;
	/** Which reranker tier was used */
	rerankTier?: "fast" | "accurate" | "code" | "llm";
	/** Indicates if the result is degraded (reranker failed) */
	degraded?: boolean;
	/** Reason for degradation if applicable */
	degradedReason?: string;
	payload: SearchResultPayload;
}

interface SearchFilters {
	type?: "thought" | "code" | "doc";
	session_id?: string;
}

interface SearchSettings {
	rerank?: boolean;
	rerankTier?: "fast" | "accurate" | "code" | "llm";
	rerankDepth?: number;
	latencyBudgetMs?: number;
}

interface UseSearchOptions {
	debounceMs?: number;
	limit?: number;
	filters?: SearchFilters;
	settings?: SearchSettings;
}

export interface RerankerMeta {
	tier: "fast" | "accurate" | "code" | "llm";
	model: string;
	latencyMs: number;
}

export interface SearchMeta {
	query: string;
	strategy: string;
	reranker?: RerankerMeta;
	totalLatencyMs: number;
}

interface SearchResponse {
	results: SearchResult[];
	meta?: SearchMeta;
}

interface ApiResponse {
	success: boolean;
	data?: SearchResponse;
	error?: string;
}

const fetcher = async (
	url: string,
	body: {
		query: string;
		limit: number;
		filters?: SearchFilters;
		settings?: SearchSettings;
	},
): Promise<SearchResponse> => {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		throw new Error("Search failed");
	}

	const json: ApiResponse = await res.json();

	if (!json.success || !json.data) {
		throw new Error(json.error || "Search failed");
	}

	return json.data;
};

// UUID regex pattern
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SearchMode = "idle" | "uuid" | "search";

export function useSearch(query: string, options: UseSearchOptions = {}) {
	const { debounceMs = 300, limit = 10, filters, settings } = options;

	const [debouncedQuery, setDebouncedQuery] = useState(query);

	// Debounce the query
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(query);
		}, debounceMs);

		return () => clearTimeout(timer);
	}, [query, debounceMs]);

	// Determine mode based on input
	const mode: SearchMode = useMemo(() => {
		const trimmed = debouncedQuery.trim();
		if (!trimmed) return "idle";
		if (UUID_PATTERN.test(trimmed)) return "uuid";
		return "search";
	}, [debouncedQuery]);

	// Only fetch when in search mode and query is long enough (3+ chars)
	const shouldSearch = mode === "search" && debouncedQuery.trim().length >= 3;

	const { data, error, isLoading, isValidating } = useSWR(
		shouldSearch ? ["/api/search", debouncedQuery, limit, filters, settings] : null,
		([url, q, l, f, s]) =>
			fetcher(url, {
				query: q as string,
				limit: l as number,
				filters: f as SearchFilters | undefined,
				settings: s as SearchSettings | undefined,
			}),
		{
			revalidateOnFocus: false,
			dedupingInterval: 1000,
		},
	);

	// Get the detected UUID for navigation
	const detectedUUID = useMemo(() => {
		if (mode === "uuid") {
			return debouncedQuery.trim();
		}
		return null;
	}, [mode, debouncedQuery]);

	return {
		results: data?.results ?? [],
		meta: data?.meta,
		isLoading: isLoading || isValidating,
		error: error?.message ?? null,
		mode,
		detectedUUID,
		// Expose whether we're still debouncing
		isDebouncing: query !== debouncedQuery,
	};
}
