import { createSearchClient, type SearchClient } from "../clients/index.js";

export interface Tool {
	name: string;
	description: string;
	parameters: Record<string, unknown>; // JSON Schema
}

export class ToolRegistry {
	private tools: Map<string, Tool> = new Map();
	private embeddingCache: Map<string, number[]> = new Map();
	private searchClient: SearchClient;

	constructor(searchClient?: SearchClient) {
		this.searchClient = searchClient ?? createSearchClient();
	}

	register(tool: Tool) {
		this.tools.set(tool.name, tool);
		// Invalidate cache when new tools are registered
		this.embeddingCache.delete(tool.name);
	}

	get(name: string): Tool | undefined {
		return this.tools.get(name);
	}

	list(): Tool[] {
		return Array.from(this.tools.values());
	}

	/**
	 * Select tools most relevant to the given query using semantic similarity.
	 *
	 * Embeds the query and compares it against cached tool description embeddings
	 * using cosine similarity. Returns the top-k most relevant tools.
	 *
	 * @param query - Natural language query describing the task
	 * @param topK - Number of tools to return (default: 3)
	 * @returns Array of most relevant tools, sorted by relevance
	 */
	async selectTools(query: string, topK: number = 3): Promise<Tool[]> {
		const tools = this.list();

		if (tools.length === 0) {
			return [];
		}

		// If we have fewer tools than requested, return all
		if (tools.length <= topK) {
			return tools;
		}

		// Embed the query
		const queryEmbedding = await this.getEmbedding(query);

		// Get or compute embeddings for all tools
		const toolsWithEmbeddings = await Promise.all(
			tools.map(async (tool) => ({
				tool,
				embedding: await this.getToolEmbedding(tool),
			})),
		);

		// Compute cosine similarity for each tool
		const toolsWithScores = toolsWithEmbeddings.map(({ tool, embedding }) => ({
			tool,
			score: this.cosineSimilarity(queryEmbedding, embedding),
		}));

		// Sort by score descending and return top-k
		return toolsWithScores
			.toSorted((a, b) => b.score - a.score)
			.slice(0, topK)
			.map(({ tool }) => tool);
	}

	/**
	 * Get or compute embedding for a tool description.
	 * Uses an in-memory cache to avoid re-embedding the same tool.
	 */
	private async getToolEmbedding(tool: Tool): Promise<number[]> {
		const cached = this.embeddingCache.get(tool.name);
		if (cached) {
			return cached;
		}

		const embedding = await this.getEmbedding(tool.description);
		this.embeddingCache.set(tool.name, embedding);
		return embedding;
	}

	/**
	 * Generate embedding for text using the search service.
	 */
	private async getEmbedding(text: string): Promise<number[]> {
		const response = await this.searchClient.embed({
			text,
			embedder_type: "text",
			is_query: true,
		});
		return response.embedding;
	}

	/**
	 * Compute cosine similarity between two vectors.
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error("Vectors must have the same length");
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
}

export const CORE_TOOLS: Tool[] = [
	{
		name: "read_file",
		description: "Read a file from the virtual file system",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
			},
			required: ["path"],
		},
	},
	{
		name: "execute_tool",
		description: "Execute a script in the sandbox",
		parameters: {
			type: "object",
			properties: {
				tool_name: { type: "string" },
				args_json: { type: "string" },
			},
			required: ["tool_name", "args_json"],
		},
	},
	{
		name: "search_memory",
		description: "Search for information in the knowledge graph",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string" },
			},
			required: ["query"],
		},
	},
];
