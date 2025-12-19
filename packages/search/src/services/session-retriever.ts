/**
 * Session-Aware Retriever for hierarchical two-stage retrieval.
 *
 * Implements a two-stage retrieval approach:
 * 1. Stage 1: Retrieve top-S sessions based on session summaries
 * 2. Stage 2: Retrieve top-T turns within each matched session
 * 3. Optional reranking of combined results
 *
 * This approach improves Multi-Session Reasoning (MR) by ensuring
 * related turns from the same session are retrieved together.
 *
 * Based on research from:
 * - LiCoMemory: Hierarchical Retrieval
 * - SGMem: Sentence Graph Memory
 *
 * @see https://arxiv.org/html/2511.01448 (LiCoMemory)
 * @see https://arxiv.org/html/2509.21212 (SGMem)
 */

import { createLogger } from "@engram/logger";
import type { QdrantClient } from "@qdrant/js-client-rest";
import type { SearchResult, SearchResultPayload } from "../models/schema";
import type { Reranker } from "./reranker";
import { TextEmbedder } from "./text-embedder";

/**
 * Configuration for SessionAwareRetriever
 */
export interface SessionRetrieverConfig {
	/** Number of sessions to retrieve in stage 1 (default: 5) */
	topSessions: number;
	/** Number of turns per session in stage 2 (default: 3) */
	turnsPerSession: number;
	/** Final top-K after reranking (default: 10) */
	finalTopK: number;
	/** Collection name for session summaries (default: "sessions") */
	sessionCollection: string;
	/** Collection name for turns (default: "engram_memory") */
	turnCollection: string;
	/** Vector field name for session embeddings (default: "text_dense") */
	sessionVectorName: string;
	/** Vector field name for turn embeddings (default: "text_dense") */
	turnVectorName: string;
	/** Minimum score threshold for sessions (default: 0.3) */
	sessionScoreThreshold: number;
	/** Enable parallel turn retrieval (default: true) */
	parallelTurnRetrieval: boolean;
}

/**
 * Default configuration for session-aware retrieval
 */
export const DEFAULT_SESSION_RETRIEVER_CONFIG: SessionRetrieverConfig = {
	topSessions: 5,
	turnsPerSession: 3,
	finalTopK: 10,
	sessionCollection: "sessions",
	turnCollection: "engram_memory",
	sessionVectorName: "text_dense",
	turnVectorName: "text_dense",
	sessionScoreThreshold: 0.3,
	parallelTurnRetrieval: true,
};

/**
 * Result from stage 1 session retrieval
 */
export interface SessionResult {
	/** Session ID */
	sessionId: string;
	/** Session summary text */
	summary: string;
	/** Similarity score */
	score: number;
	/** Topics associated with session */
	topics?: string[];
	/** Entities mentioned in session */
	entities?: string[];
}

/**
 * Extended search result with session context
 */
export interface SessionAwareSearchResult extends SearchResult {
	/** Session ID this result belongs to */
	sessionId: string;
	/** Session summary for context */
	sessionSummary?: string;
	/** Session-level score from stage 1 */
	sessionScore?: number;
}

/**
 * SessionAwareRetriever implements two-stage hierarchical retrieval.
 *
 * Stage 1: Session Retrieval
 * - Query against session summary embeddings
 * - Returns top-S most relevant sessions
 *
 * Stage 2: Turn Retrieval
 * - For each session from stage 1, query turns filtered by session_id
 * - Returns top-T turns per session
 *
 * Final: Reranking
 * - Combines all turns (S × T)
 * - Optionally reranks to final top-K
 *
 * @example
 * ```typescript
 * const retriever = new SessionAwareRetriever(qdrantClient, {
 *   topSessions: 5,
 *   turnsPerSession: 3,
 *   finalTopK: 10,
 * });
 *
 * const results = await retriever.retrieve("What did we discuss about Docker?");
 * // Returns up to 10 turns from the 5 most relevant sessions
 * ```
 */
export class SessionAwareRetriever {
	private client: QdrantClient;
	private embedder: TextEmbedder;
	private config: SessionRetrieverConfig;
	private reranker?: Reranker;
	private logger = createLogger({ component: "SessionAwareRetriever" });

	constructor(
		client: QdrantClient,
		config: Partial<SessionRetrieverConfig> = {},
		reranker?: Reranker,
	) {
		this.client = client;
		this.config = { ...DEFAULT_SESSION_RETRIEVER_CONFIG, ...config };
		this.reranker = reranker;
		this.embedder = new TextEmbedder();
	}

	/**
	 * Perform two-stage session-aware retrieval.
	 *
	 * @param query - The search query
	 * @returns Array of search results with session context
	 */
	async retrieve(query: string): Promise<SessionAwareSearchResult[]> {
		const startTime = Date.now();

		// Generate query embedding
		const queryEmbedding = await this.embedder.embedQuery(query);

		// Stage 1: Retrieve relevant sessions
		const sessions = await this.retrieveSessions(queryEmbedding);

		if (sessions.length === 0) {
			this.logger.info({
				msg: "No sessions found in stage 1",
				query: query.slice(0, 100),
				latencyMs: Date.now() - startTime,
			});
			return [];
		}

		this.logger.debug({
			msg: "Stage 1 complete - sessions retrieved",
			sessionCount: sessions.length,
			topSessionScore: sessions[0]?.score,
		});

		// Stage 2: Retrieve turns within each session
		const allTurns = await this.retrieveTurnsFromSessions(queryEmbedding, sessions);

		if (allTurns.length === 0) {
			this.logger.info({
				msg: "No turns found in stage 2",
				sessionCount: sessions.length,
				latencyMs: Date.now() - startTime,
			});
			return [];
		}

		this.logger.debug({
			msg: "Stage 2 complete - turns retrieved",
			turnCount: allTurns.length,
			sessionsWithTurns: new Set(allTurns.map((t) => t.sessionId)).size,
		});

		// Stage 3: Rerank if enabled and needed
		let finalResults = allTurns;
		if (this.reranker && allTurns.length > this.config.finalTopK) {
			finalResults = await this.rerankResults(query, allTurns);
		} else {
			// Sort by score and limit
			finalResults = allTurns.sort((a, b) => b.score - a.score).slice(0, this.config.finalTopK);
		}

		const latencyMs = Date.now() - startTime;
		this.logger.info({
			msg: "Session-aware retrieval complete",
			query: query.slice(0, 50),
			sessionsFound: sessions.length,
			turnsRetrieved: allTurns.length,
			finalResults: finalResults.length,
			latencyMs,
		});

		return finalResults;
	}

	/**
	 * Stage 1: Retrieve relevant sessions based on summary embeddings.
	 *
	 * @param queryEmbedding - Query embedding vector
	 * @returns Array of matched sessions
	 */
	private async retrieveSessions(queryEmbedding: number[]): Promise<SessionResult[]> {
		try {
			const results = await this.client.search(this.config.sessionCollection, {
				vector: {
					name: this.config.sessionVectorName,
					vector: queryEmbedding,
				},
				limit: this.config.topSessions,
				with_payload: true,
				score_threshold: this.config.sessionScoreThreshold,
			});

			return results.map((r) => {
				const payload = r.payload as Record<string, unknown>;
				return {
					sessionId: payload.session_id as string,
					summary: payload.summary as string,
					score: r.score,
					topics: payload.topics as string[] | undefined,
					entities: payload.entities as string[] | undefined,
				};
			});
		} catch (error) {
			this.logger.error({
				msg: "Session retrieval failed",
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}

	/**
	 * Stage 2: Retrieve turns within matched sessions.
	 *
	 * @param queryEmbedding - Query embedding vector
	 * @param sessions - Sessions from stage 1
	 * @returns Array of turns with session context
	 */
	private async retrieveTurnsFromSessions(
		queryEmbedding: number[],
		sessions: SessionResult[],
	): Promise<SessionAwareSearchResult[]> {
		if (this.config.parallelTurnRetrieval) {
			// Parallel retrieval for all sessions
			const turnPromises = sessions.map((session) =>
				this.retrieveTurnsInSession(queryEmbedding, session),
			);
			const results = await Promise.all(turnPromises);
			return results.flat();
		}

		// Sequential retrieval
		const allTurns: SessionAwareSearchResult[] = [];
		for (const session of sessions) {
			const turns = await this.retrieveTurnsInSession(queryEmbedding, session);
			allTurns.push(...turns);
		}
		return allTurns;
	}

	/**
	 * Retrieve turns within a single session.
	 *
	 * @param queryEmbedding - Query embedding vector
	 * @param session - Session to search within
	 * @returns Array of turns from this session
	 */
	private async retrieveTurnsInSession(
		queryEmbedding: number[],
		session: SessionResult,
	): Promise<SessionAwareSearchResult[]> {
		try {
			const results = await this.client.search(this.config.turnCollection, {
				vector: {
					name: this.config.turnVectorName,
					vector: queryEmbedding,
				},
				limit: this.config.turnsPerSession,
				filter: {
					must: [{ key: "session_id", match: { value: session.sessionId } }],
				},
				with_payload: true,
			});

			return results.map((r) => {
				const payload = r.payload as unknown as SearchResultPayload;
				return {
					id: r.id,
					score: r.score,
					payload,
					sessionId: session.sessionId,
					sessionSummary: session.summary,
					sessionScore: session.score,
				};
			});
		} catch (error) {
			this.logger.warn({
				msg: "Turn retrieval failed for session",
				sessionId: session.sessionId,
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}

	/**
	 * Rerank combined results from all sessions.
	 *
	 * @param query - Original query
	 * @param turns - All turns from stage 2
	 * @returns Reranked and limited results
	 */
	private async rerankResults(
		query: string,
		turns: SessionAwareSearchResult[],
	): Promise<SessionAwareSearchResult[]> {
		if (!this.reranker) {
			return turns.slice(0, this.config.finalTopK);
		}

		try {
			// Extract content for reranking
			const documents = turns.map((t) => t.payload?.content ?? "");

			// Rerank
			const reranked = await this.reranker.rerank(query, documents, this.config.finalTopK);

			// Map back to original results
			return reranked.map((r) => {
				const original = turns[r.originalIndex];
				return {
					...original,
					score: r.score,
					rrfScore: original.score,
					rerankerScore: r.score,
				};
			});
		} catch (error) {
			this.logger.error({
				msg: "Reranking failed - returning sorted results",
				error: error instanceof Error ? error.message : String(error),
			});

			// Fall back to score-sorted results
			return turns.sort((a, b) => b.score - a.score).slice(0, this.config.finalTopK);
		}
	}

	/**
	 * Get current configuration.
	 */
	getConfig(): Readonly<SessionRetrieverConfig> {
		return this.config;
	}

	/**
	 * Update configuration at runtime.
	 */
	updateConfig(config: Partial<SessionRetrieverConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Preload the text embedder for faster first retrieval.
	 */
	async preload(): Promise<void> {
		await this.embedder.preload();
	}
}
