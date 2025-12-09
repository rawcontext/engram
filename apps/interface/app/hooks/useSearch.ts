"use client";

import useSWR from "swr";
import { useMemo, useState, useCallback, useEffect } from "react";

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
	payload: SearchResultPayload;
}

interface SearchFilters {
	type?: "thought" | "code" | "doc";
	session_id?: string;
}

interface UseSearchOptions {
	debounceMs?: number;
	limit?: number;
	filters?: SearchFilters;
}

interface SearchResponse {
	results: SearchResult[];
}

interface ApiResponse {
	success: boolean;
	data?: SearchResponse;
	error?: string;
}

const fetcher = async (url: string, body: object): Promise<SearchResponse> => {
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
	const { debounceMs = 300, limit = 10, filters } = options;

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
		shouldSearch ? ["/api/search", debouncedQuery, limit, filters] : null,
		([url, q, l, f]) =>
			fetcher(url, {
				query: q,
				limit: l,
				filters: f,
			}),
		{
			revalidateOnFocus: false,
			dedupingInterval: 1000,
		}
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
		isLoading: isLoading || isValidating,
		error: error?.message ?? null,
		mode,
		detectedUUID,
		// Expose whether we're still debouncing
		isDebouncing: query !== debouncedQuery,
	};
}
