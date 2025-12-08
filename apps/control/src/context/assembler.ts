import type { SearchRetriever } from "@engram/search-core";
import type { FalkorClient, ThoughtNode } from "@engram/storage";

const SYSTEM_PROMPT = `You are Engram, an intelligent assistant with access to a knowledge graph and semantic memory.
You can recall past conversations, search for relevant information, and use tools to help accomplish tasks.
Be helpful, accurate, and concise in your responses.`;

// Approximate tokens: ~4 characters per token for English text
const CHARS_PER_TOKEN = 4;

interface ContextSection {
	label: string;
	content: string;
	priority: number; // Lower = higher priority (kept first when pruning)
}

export class ContextAssembler {
	private search: SearchRetriever | null;
	private memory: FalkorClient;

	constructor(search: SearchRetriever | null, memory: FalkorClient) {
		this.search = search;
		this.memory = memory;
	}

	/**
	 * Assemble context for the agent loop.
	 * Combines system prompt, recent history, and relevant memories.
	 * Prunes to fit within token limit.
	 */
	async assembleContext(sessionId: string, query: string, tokenLimit = 8000): Promise<string> {
		const sections: ContextSection[] = [];

		// 1. System Prompt (highest priority - never pruned)
		sections.push({
			label: "System",
			content: SYSTEM_PROMPT,
			priority: 0,
		});

		// 2. Recent Session History (high priority)
		const history = await this.fetchRecentHistory(sessionId, 20);
		if (history.length > 0) {
			const historyText = history
				.map((t) => `${t.properties.role}: ${t.properties.content}`)
				.join("\n");
			sections.push({
				label: "Recent History",
				content: historyText,
				priority: 1,
			});
		}

		// 3. Relevant Memories from Search (medium priority)
		const memories = await this.searchRelevantMemories(query, sessionId);
		if (memories.length > 0) {
			const memoriesText = memories.map((m) => `- ${m}`).join("\n");
			sections.push({
				label: "Relevant Memories",
				content: memoriesText,
				priority: 2,
			});
		}

		// 4. Current Query (high priority - always included)
		sections.push({
			label: "Current Query",
			content: query,
			priority: 1,
		});

		// Assemble and prune to fit token limit
		return this.pruneToFit(sections, tokenLimit);
	}

	/**
	 * Fetch recent thoughts from the session's history.
	 * Uses NEXT relationship chain, falling back to timestamp ordering.
	 */
	private async fetchRecentHistory(sessionId: string, limit: number): Promise<ThoughtNode[]> {
		try {
			await this.memory.connect();

			// Try to fetch using NEXT chain (preferred for lineage)
			const chainQuery = `
				MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(first:Thought)
				OPTIONAL MATCH p = (first)-[:NEXT*0..${limit}]->(t:Thought)
				WITH COALESCE(t, first) as thought
				RETURN thought
				ORDER BY thought.vt_start DESC
				LIMIT ${limit}
			`;

			const result = await this.memory.query<{ thought: ThoughtNode }>(chainQuery, { sessionId });

			if (result.length > 0) {
				// Reverse to get chronological order (oldest first)
				return result.map((r) => r.thought).reverse();
			}

			// Fallback: simple timestamp-based ordering if no NEXT chain
			const fallbackQuery = `
				MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(t:Thought)
				RETURN t as thought
				ORDER BY t.vt_start ASC
				LIMIT ${limit}
			`;

			const fallbackResult = await this.memory.query<{ thought: ThoughtNode }>(fallbackQuery, {
				sessionId,
			});
			return fallbackResult.map((r) => r.thought);
		} catch (error) {
			// If graph query fails, return empty history
			return [];
		}
	}

	/**
	 * Search for relevant memories using semantic search.
	 * Returns content strings from matching results.
	 */
	private async searchRelevantMemories(query: string, currentSessionId: string): Promise<string[]> {
		if (!this.search) {
			return [];
		}

		try {
			const results = await this.search.search({
				text: query,
				limit: 5,
				strategy: "hybrid",
				// Optionally exclude current session to avoid repetition
				// filters: { session_id: { $ne: currentSessionId } }
			});

			if (!results || !Array.isArray(results)) {
				return [];
			}

			// Extract content from search results, excluding current session's content
			return results
				.filter((r) => r.payload?.session_id !== currentSessionId)
				.map((r) => r.payload?.content as string)
				.filter(Boolean)
				.slice(0, 3); // Limit to top 3 most relevant
		} catch (error) {
			// If search fails, return empty
			return [];
		}
	}

	/**
	 * Estimate token count using character-based approximation.
	 */
	private estimateTokens(text: string): number {
		return Math.ceil(text.length / CHARS_PER_TOKEN);
	}

	/**
	 * Prune sections to fit within token limit.
	 * Removes lowest priority sections first, then truncates if needed.
	 */
	private pruneToFit(sections: ContextSection[], tokenLimit: number): string {
		// Sort by priority (lower number = higher priority)
		const sorted = [...sections].sort((a, b) => a.priority - b.priority);

		const included: ContextSection[] = [];
		let totalTokens = 0;

		for (const section of sorted) {
			const sectionTokens = this.estimateTokens(section.content);

			if (totalTokens + sectionTokens <= tokenLimit) {
				included.push(section);
				totalTokens += sectionTokens;
			} else {
				// Try to include truncated version if it's high priority
				if (section.priority <= 1) {
					const remainingTokens = tokenLimit - totalTokens;
					const remainingChars = remainingTokens * CHARS_PER_TOKEN;
					if (remainingChars > 100) {
						// Only truncate if meaningful
						const truncated = section.content.slice(0, remainingChars - 20) + "... [truncated]";
						included.push({ ...section, content: truncated });
						break;
					}
				}
			}
		}

		// Format output
		return included
			.map((s) => {
				if (s.label === "System") {
					return s.content;
				}
				if (s.label === "Current Query") {
					return `User: ${s.content}`;
				}
				return `[${s.label}]\n${s.content}`;
			})
			.join("\n\n");
	}
}
