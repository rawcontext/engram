/**
 * Community Summarization Prompt for Graph Intelligence
 *
 * This prompt is designed for generating descriptive summaries of entity communities
 * detected through graph algorithms (Leiden, Louvain, etc.). It helps create human-readable
 * labels and descriptions for clusters of related entities in the knowledge graph.
 *
 * References:
 * - Microsoft GraphRAG community summarization approach
 * - Hierarchical graph clustering best practices
 * - LLM-driven knowledge graph enrichment techniques
 */

/**
 * Input data for community summarization
 */
export interface CommunityInput {
	/** Entities that belong to this community */
	entities: Array<{
		/** Entity name (canonical form) */
		name: string;
		/** Entity type (tool, concept, pattern, file, person, project, technology) */
		type: string;
		/** Optional contextual description of the entity */
		description?: string;
	}>;
	/** Memory excerpts that mention entities in this community */
	memories: Array<{
		/** Memory content text */
		content: string;
		/** Memory type (decision, insight, preference, fact, context) */
		type: string;
	}>;
}

/**
 * Output structure for community summary
 */
export interface CommunitySummaryOutput {
	/** Community name: 2-4 words, descriptive and specific */
	name: string;
	/** Summary text: 2-3 sentences explaining the community's theme and relevance */
	text: string;
	/** Keywords: 3-5 relevant keywords for search and filtering */
	keywords: string[];
}

/**
 * System message for community summarization
 */
export const COMMUNITY_SUMMARY_SYSTEM_MESSAGE = `You are an expert knowledge graph analyst specializing in entity clustering and community detection.

Your task is to analyze a community of related entities and their associated memories, then generate a concise, informative summary that captures the community's overarching theme.

## Output Requirements

Return valid JSON matching this schema:

\`\`\`json
{
  "name": "string (2-4 words, descriptive community label)",
  "text": "string (2-3 sentences explaining the theme and relevance)",
  "keywords": ["string", "string", "string"] (3-5 relevant keywords)
}
\`\`\`

## Constraints

1. **Name** (2-4 words):
   - Be specific and descriptive (not generic like "Technical Stack" or "Development Tools")
   - Capture the unique theme of this community
   - Use title case formatting
   - Examples: "OAuth Authentication Infrastructure", "Python Testing Framework", "Graph Storage Architecture"

2. **Text** (2-3 sentences):
   - First sentence: What binds these entities together? What is the common theme?
   - Second sentence: Why is this community significant? What problem does it address?
   - Optional third sentence: Any notable relationships or patterns
   - Focus on "why" and "so what", not just "what"

3. **Keywords** (3-5 items):
   - Extract the most relevant technical terms
   - Include both broad categories and specific technologies
   - Use lowercase for consistency
   - Prioritize searchability and discoverability

## Analysis Guidelines

- **Look for connections**: What patterns emerge from the entity types and relationships?
- **Consider memory context**: What do the associated memories tell you about how these entities are used together?
- **Identify themes**: Is this a technical stack? An architectural pattern? A problem domain? A workflow?
- **Be specific**: "FastAPI Vector Search Service" is better than "Search Service"
- **Avoid jargon**: The summary should be understandable to developers familiar with the domain`;

/**
 * Few-shot examples for community summarization
 */
export const COMMUNITY_SUMMARY_EXAMPLES = [
	{
		input: {
			entities: [
				{ name: "FalkorDB", type: "technology", description: "Graph database" },
				{ name: "Neo4j", type: "technology", description: "Alternative graph database" },
				{ name: "Redis", type: "technology", description: "In-memory data store" },
				{ name: "bitemporal modeling", type: "pattern", description: "Data modeling pattern" },
				{ name: "graph storage", type: "concept", description: "Storage approach" },
			],
			memories: [
				{
					content:
						"Decided to use FalkorDB instead of Neo4j for graph storage because it's Redis-compatible and supports bitemporal modeling natively.",
					type: "decision",
				},
				{
					content:
						"FalkorDB stores all nodes with vt_start/vt_end for valid time and tt_start/tt_end for transaction time.",
					type: "fact",
				},
			],
		},
		output: {
			name: "Graph Storage Architecture",
			text: "This community represents the architectural decisions around persistent graph storage with temporal versioning. FalkorDB was chosen for its Redis compatibility and native support for bitemporal modeling, enabling time-travel queries and audit trails. The combination of graph capabilities with in-memory performance addresses the need for fast, versioned knowledge graph queries.",
			keywords: ["graph-database", "bitemporal", "falkordb", "redis", "temporal-modeling"],
		},
	},
	{
		input: {
			entities: [
				{ name: "pytest-asyncio", type: "tool", description: "Async testing library" },
				{ name: "pytest.ini", type: "file", description: "Pytest configuration file" },
				{
					name: "event loop management",
					type: "concept",
					description: "Async event loop handling",
				},
				{ name: "FastAPI", type: "technology", description: "Python web framework" },
				{ name: "Qdrant", type: "technology", description: "Vector database" },
			],
			memories: [
				{
					content:
						"Discovered that pytest-asyncio requires explicit event_loop_policy='reuse' to avoid 'RuntimeError: Event loop is closed' in teardown.",
					type: "insight",
				},
				{
					content:
						"The search service uses FastAPI with async endpoints and requires careful test setup.",
					type: "fact",
				},
			],
		},
		output: {
			name: "Python Async Testing Framework",
			text: "This community encompasses the testing infrastructure for Python asynchronous services, particularly FastAPI-based applications. The entities reflect common challenges with pytest-asyncio event loop management and the need for proper configuration to handle async teardown. This setup enables reliable testing of async endpoints in the search service.",
			keywords: ["pytest", "async-testing", "fastapi", "python", "event-loop"],
		},
	},
	{
		input: {
			entities: [
				{ name: "OAuth 2.1", type: "technology", description: "Authentication protocol" },
				{ name: "Observatory", type: "project", description: "Authorization server" },
				{ name: "token introspection", type: "concept", description: "RFC 7662 token validation" },
				{ name: "api", type: "project", description: "API service" },
				{ name: "search", type: "project", description: "Search service" },
				{ name: "device flow", type: "pattern", description: "OAuth device authorization" },
			],
			memories: [
				{
					content:
						"Migrating from API keys to OAuth 2.1 for all service authentication. Observatory acts as the authorization server.",
					type: "context",
				},
				{
					content:
						"Implemented RFC 7662 token introspection in Observatory for validating bearer tokens across services.",
					type: "decision",
				},
			],
		},
		output: {
			name: "OAuth Authentication Infrastructure",
			text: "This community represents the centralized authentication architecture based on OAuth 2.1 standards. Observatory serves as the authorization server implementing RFC 7662 token introspection, providing unified authentication for all microservices (API, search, tuner, ingestion). The migration from API keys to OAuth improves security posture and enables fine-grained access control with device flow support.",
			keywords: [
				"oauth",
				"authentication",
				"authorization-server",
				"token-introspection",
				"security",
			],
		},
	},
	{
		input: {
			entities: [
				{ name: "Biome", type: "tool", description: "Formatter and linter" },
				{ name: "ESLint", type: "tool", description: "JavaScript linter" },
				{ name: "Prettier", type: "tool", description: "Code formatter" },
				{ name: "TypeScript", type: "technology", description: "Programming language" },
			],
			memories: [
				{
					content:
						"User prefers Biome over ESLint/Prettier for formatting because it's faster and has a single config file. Always use tabs, double quotes, 100 char line width.",
					type: "preference",
				},
			],
		},
		output: {
			name: "TypeScript Code Quality Tooling",
			text: "This community represents the code quality and formatting toolchain preferences for TypeScript development. Biome was chosen over the traditional ESLint/Prettier combination for its superior performance and unified configuration approach. The standardized formatting rules (tabs, double quotes, 100-character lines) ensure consistent code style across the project.",
			keywords: ["biome", "typescript", "formatting", "linting", "code-quality"],
		},
	},
	{
		input: {
			entities: [
				{ name: "search service", type: "project", description: "Vector search service" },
				{ name: "/apps/search", type: "file", description: "Search service directory" },
				{ name: "FlashRank", type: "tool", description: "Fast reranking model" },
				{ name: "BGE", type: "tool", description: "Accurate reranking model" },
				{ name: "Jina", type: "tool", description: "Code-optimized reranking" },
				{ name: "Qdrant", type: "technology", description: "Vector database" },
			],
			memories: [
				{
					content:
						"The search service supports four reranking tiers: fast (FlashRank ~10ms), accurate (BGE ~50ms), code (Jina ~50ms), and llm (Gemini ~500ms).",
					type: "fact",
				},
				{
					content:
						"Implemented multi-tier reranking to balance accuracy and latency based on query complexity.",
					type: "decision",
				},
			],
		},
		output: {
			name: "Vector Search Reranking Pipeline",
			text: "This community represents the multi-tier reranking architecture in the vector search service. The system offers four reranking strategies with different accuracy/latency tradeoffs, from fast lightweight models (FlashRank) to high-quality LLM-based reranking (Gemini). This tiered approach enables adaptive query optimization based on user requirements and system constraints.",
			keywords: ["reranking", "vector-search", "qdrant", "search-optimization", "hybrid-retrieval"],
		},
	},
] as const;

/**
 * Build the community summarization prompt
 */
export function buildCommunitySummaryPrompt(input: CommunityInput): string {
	const entityList = input.entities
		.map((e) => {
			const desc = e.description ? ` - ${e.description}` : "";
			return `- **${e.name}** (${e.type})${desc}`;
		})
		.join("\n");

	const memoryList = input.memories
		.map((m) => {
			return `- [${m.type}] ${m.content}`;
		})
		.join("\n");

	return `Analyze the following community of related entities and generate a summary.

## Entities in Community

${entityList}

## Related Memories

${memoryList}

## Your Task

1. Identify the common theme that binds these entities together
2. Analyze the memory context to understand how these entities are used
3. Generate a descriptive community name (2-4 words)
4. Write a concise summary explaining the community's significance (2-3 sentences)
5. Extract 3-5 relevant keywords for search and filtering

Return your response as valid JSON matching the schema provided in the system message.`;
}

/**
 * Validate community summary output against schema
 */
export function validateCommunitySummary(result: unknown): result is CommunitySummaryOutput {
	if (!result || typeof result !== "object") return false;

	const typed = result as Partial<CommunitySummaryOutput>;

	// Validate name
	if (!typed.name || typeof typed.name !== "string") return false;
	const wordCount = typed.name.trim().split(/\s+/).length;
	if (wordCount < 2 || wordCount > 4) return false;

	// Validate text
	if (!typed.text || typeof typed.text !== "string") return false;
	const sentenceCount = typed.text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
	if (sentenceCount < 2 || sentenceCount > 3) return false;

	// Validate keywords
	if (!Array.isArray(typed.keywords)) return false;
	if (typed.keywords.length < 3 || typed.keywords.length > 5) return false;
	if (!typed.keywords.every((k) => typeof k === "string" && k.length > 0)) return false;

	return true;
}
