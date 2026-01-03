import type { Logger } from "@engram/logger";
import type { IEngramClient } from "./interfaces";

/**
 * Result from community search
 */
export interface CommunitySearchResult {
	id: string;
	name: string;
	summary: string;
	keywords: string[];
	memberCount: number;
	memoryCount: number;
	score: number;
}

/**
 * Options for community search
 */
export interface CommunitySearchOptions {
	/** Project filter */
	project?: string;
	/** Maximum number of communities to return (default: 3) */
	limit?: number;
	/** Minimum similarity score threshold (default: 0.5) */
	threshold?: number;
}

/**
 * Interface for community retrieval operations
 */
export interface ICommunityRetriever {
	/**
	 * Search for communities by semantic similarity to query
	 */
	search(query: string, options?: CommunitySearchOptions): Promise<CommunitySearchResult[]>;
}

/**
 * Community retriever implementation using cloud client.
 *
 * Queries communities from the graph and computes semantic similarity
 * using the search service's embed endpoint.
 */
export class CommunityRetrieverService implements ICommunityRetriever {
	constructor(
		private readonly client: IEngramClient,
		private readonly searchUrl: string,
		private readonly logger: Logger,
	) {}

	async search(
		query: string,
		options: CommunitySearchOptions = {},
	): Promise<CommunitySearchResult[]> {
		const { project, limit = 3, threshold = 0.5 } = options;

		try {
			// Step 1: Get active communities from graph
			const communities = await this.getCommunities(project);

			if (communities.length === 0) {
				this.logger.debug("No communities found for search");
				return [];
			}

			// Step 2: Filter communities with embeddings
			const communitiesWithEmbeddings = communities.filter(
				(c) => c.embedding && c.embedding.length > 0,
			);

			if (communitiesWithEmbeddings.length === 0) {
				this.logger.debug("No communities with embeddings found");
				return [];
			}

			// Step 3: Embed the query
			const queryEmbedding = await this.embedQuery(query);
			if (!queryEmbedding) {
				this.logger.warn("Failed to embed query for community search");
				return [];
			}

			// Step 4: Compute similarity scores
			const results: CommunitySearchResult[] = [];
			for (const community of communitiesWithEmbeddings) {
				// Embedding existence is guaranteed by the filter above
				const embedding = community.embedding as number[];
				const score = this.cosineSimilarity(queryEmbedding, embedding);
				if (score >= threshold) {
					results.push({
						id: community.id,
						name: community.name,
						summary: community.summary,
						keywords: community.keywords,
						memberCount: community.memberCount,
						memoryCount: community.memoryCount,
						score,
					});
				}
			}

			// Sort by score descending and limit
			results.sort((a, b) => b.score - a.score);
			const topResults = results.slice(0, limit);

			this.logger.debug(
				{ count: topResults.length, threshold, query: query.slice(0, 50) },
				"Community search completed",
			);

			return topResults;
		} catch (error) {
			this.logger.error({ error }, "Community search failed");
			return [];
		}
	}

	/**
	 * Get communities from graph database
	 */
	private async getCommunities(project?: string): Promise<CommunityNode[]> {
		const query = project
			? `MATCH (c:Community {project: $project}) WHERE c.tt_end = 8640000000000000 RETURN c ORDER BY c.member_count DESC LIMIT 50`
			: `MATCH (c:Community) WHERE c.tt_end = 8640000000000000 RETURN c ORDER BY c.member_count DESC LIMIT 50`;

		const results = await this.client.query<{ c: CommunityNodeRaw }>(
			query,
			project ? { project } : {},
		);

		return results.map((r) => this.mapCommunity(r.c));
	}

	/**
	 * Embed query using search service
	 */
	private async embedQuery(text: string): Promise<number[] | null> {
		try {
			const response = await fetch(`${this.searchUrl}/v1/search/embed`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					text,
					embedder_type: "text",
					is_query: true,
				}),
			});

			if (!response.ok) {
				this.logger.warn({ status: response.status }, "Embed request failed");
				return null;
			}

			const result = (await response.json()) as { embedding: number[] };
			return result.embedding;
		} catch (error) {
			this.logger.error({ error }, "Failed to embed query");
			return null;
		}
	}

	/**
	 * Compute cosine similarity between two vectors
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			return 0;
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		const denominator = Math.sqrt(normA) * Math.sqrt(normB);
		if (denominator === 0) {
			return 0;
		}

		return dotProduct / denominator;
	}

	/**
	 * Map raw FalkorDB community node to domain object
	 */
	private mapCommunity(raw: CommunityNodeRaw): CommunityNode {
		const props = raw.properties ?? raw;
		return {
			id: props.id ?? "",
			name: props.name ?? "",
			summary: props.summary ?? "",
			keywords: Array.isArray(props.keywords) ? props.keywords : [],
			memberCount: props.member_count ?? 0,
			memoryCount: props.memory_count ?? 0,
			embedding: props.embedding,
			project: props.project,
		};
	}
}

/**
 * Raw community node from FalkorDB
 */
interface CommunityNodeRaw {
	properties?: {
		id: string;
		name: string;
		summary: string;
		keywords: string[];
		member_count: number;
		memory_count: number;
		embedding?: number[];
		project?: string;
	};
	id?: string;
	name?: string;
	summary?: string;
	keywords?: string[];
	member_count?: number;
	memory_count?: number;
	embedding?: number[];
	project?: string;
}

/**
 * Domain community node
 */
interface CommunityNode {
	id: string;
	name: string;
	summary: string;
	keywords: string[];
	memberCount: number;
	memoryCount: number;
	embedding?: number[];
	project?: string;
}
