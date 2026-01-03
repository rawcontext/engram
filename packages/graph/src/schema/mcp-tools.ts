/**
 * MCP Tool Definitions for Engram
 *
 * Defines MCP tools using the mcp.tool() DSL. These definitions are used
 * to generate type-safe schemas and registration functions.
 *
 * @example
 * ```bash
 * # Generate MCP tools
 * bun run generate --tools ./src/schema/mcp-tools.ts
 * ```
 */

import { mcp } from "./mcp";

// =============================================================================
// Memory Types
// =============================================================================

/** Memory type values for the remember tool */
const MemoryTypes = ["decision", "context", "insight", "preference", "fact", "turn"] as const;

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Summarize tool - Condense text using client LLM sampling.
 */
const summarize = mcp.tool({
	title: "Summarize Text",
	description:
		"Condense long text into key points using the MCP client's LLM. Use before storing memories to create compact, searchable summaries. Also useful for: distilling verbose error logs, compressing context that exceeds limits, or creating session recaps. Requires client sampling capability - returns available=false if unsupported.",
	input: {
		text: mcp.param.string(
			"Text to condense. Works best with structured content like logs, documentation, or conversation history. Very long texts may be truncated - consider chunking inputs over 10,000 characters.",
		),
		maxWords: mcp.param
			.int(
				"Target summary length. 10-30 words for memory tags/titles. 50-100 words for memory content. 200-500 words for detailed session recaps. Actual output may vary slightly.",
			)
			.min(10)
			.max(500)
			.default(100),
	},
	output: {
		summary: mcp.param.string("The condensed summary of the input text").optional(),
		available: mcp.param.boolean("Whether sampling capability is available"),
	},
});

/**
 * Extract facts tool - Parse text into discrete atomic facts.
 */
const extract_facts = mcp.tool({
	title: "Extract Facts",
	description:
		"Parse unstructured text into discrete, atomic facts suitable for storage. Use before remember when processing: documentation, chat logs, meeting notes, or verbose command outputs. Each extracted fact can be stored and searched independently, improving retrieval precision. Requires client sampling capability.",
	input: {
		text: mcp.param.string(
			"Unstructured text containing multiple facts to extract. Works well with: documentation sections, error logs with multiple issues, conversation transcripts, or configuration explanations. Each distinct fact becomes a separate item in the output array.",
		),
	},
	output: {
		facts: mcp.param.array(mcp.param.string(), "Extracted atomic facts").optional(),
		available: mcp.param.boolean("Whether sampling capability is available"),
		count: mcp.param.int("Number of facts extracted"),
	},
});

/**
 * Enrich memory tool - Auto-generate metadata for memory content.
 */
const enrich_memory = mcp.tool({
	title: "Enrich Memory",
	description:
		"Auto-generate metadata for memory content before storing. Returns: one-line summary, searchable keywords, and suggested category (maps to memory type). Recommended workflow: call enrich_memory first, then pass the enriched metadata to remember for better future retrieval. Requires client sampling capability.",
	input: {
		content: mcp.param.string(
			"The memory content you plan to store. The LLM analyzes this to generate: a concise summary (for quick scanning), relevant keywords (for search), and a category suggestion (decision/insight/fact/preference/context). Use the output to populate remember parameters.",
		),
	},
	output: {
		enrichment: mcp.param
			.object(
				{
					summary: mcp.param.string("One-line summary for quick scanning"),
					keywords: mcp.param.array(mcp.param.string(), "Searchable keywords"),
					category: mcp.param.string("Suggested memory type category"),
				},
				"Enrichment metadata for the memory",
			)
			.optional(),
		available: mcp.param.boolean("Whether sampling capability is available"),
	},
});

/**
 * Remember tool - Persist information to long-term memory.
 */
const remember = mcp.tool({
	title: "Remember",
	description:
		"Persist valuable information to long-term memory for future sessions. Use PROACTIVELY when you learn: user preferences, architectural decisions, project conventions, debugging insights, or facts worth preserving. Memories are searchable across sessions and survive context boundaries.",
	input: {
		content: mcp.param.string(
			"The information to store. Be specific and self-contained - this will be retrieved out of context. Include relevant details like file paths, reasoning, or constraints. Avoid storing transient information like 'working on X' - store conclusions and decisions instead.",
		),
		type: mcp.param
			.enum(
				MemoryTypes,
				"Memory classification for retrieval. 'decision': Architectural or implementation choices with rationale. 'preference': User preferences for tools, style, or workflow. 'insight': Debugging discoveries or non-obvious learnings. 'fact': Objective information about codebase or domain. 'context': Background for ongoing work.",
			)
			.optional(),
		tags: mcp.param
			.array(
				mcp.param.string(),
				"Keywords for filtering and discovery. Use lowercase, specific terms. Good: ['authentication', 'postgres', 'performance']. Avoid generic tags like ['important', 'remember'].",
			)
			.optional(),
	},
	output: {
		id: mcp.param.string("The unique ID of the stored memory"),
		stored: mcp.param.boolean("Whether the memory was successfully stored"),
		duplicate: mcp.param.boolean("Whether this was detected as a duplicate").optional(),
		entities: mcp.param
			.array(
				mcp.param.object({
					name: mcp.param.string("Entity name"),
					type: mcp.param.string("Entity type"),
					isNew: mcp.param.boolean("Whether this is a newly created entity"),
				}),
				"Entities extracted and linked from the memory content",
			)
			.optional(),
	},
});

/**
 * Recall tool - Search past memories using semantic similarity.
 */
const recall = mcp.tool({
	title: "Recall",
	description:
		"Search past memories using semantic similarity and knowledge graph traversal. Use PROACTIVELY: at session start to prime yourself with relevant prior knowledge, before making decisions to check for existing rationale, or when the user references 'before', 'last time', or 'remember when'. Returns memories ranked by relevance score.",
	input: {
		query: mcp.param.string(
			"Natural language search query. Be descriptive - 'authentication decisions' works better than 'auth'. Include context words that would appear in relevant memories.",
		),
		limit: mcp.param.int("Maximum number of results").min(1).max(20).default(5),
		rerank: mcp.param.boolean("Enable reranking to improve result relevance").default(true),
		rerank_tier: mcp.param
			.enum(
				["fast", "accurate", "code", "llm"] as const,
				"Reranker model tier. 'fast': FlashRank lightweight model. 'accurate': BGE cross-encoder. 'code': Jina code-optimized. 'llm': Gemini Flash for highest quality.",
			)
			.default("fast"),
		includeEntities: mcp.param
			.boolean("Enable graph expansion via entity relationships")
			.default(true),
		graphDepth: mcp.param
			.int("Maximum hops for graph expansion through entity relationships")
			.min(0)
			.max(3)
			.default(2),
		graphWeight: mcp.param.float("Weight for graph-based scoring (0-1)").min(0).max(1).default(0.3),
		graphRerank: mcp.param
			.boolean("Enable graph-based reranking using entity relationships")
			.default(true),
		includeInvalidated: mcp.param
			.boolean("Include invalidated (expired) memories in results")
			.default(false),
		disambiguate: mcp.param
			.boolean("If multiple similar memories match, ask user to select one")
			.default(false),
	},
	output: {
		memories: mcp.param.array(
			mcp.param.object({
				id: mcp.param.string("Memory ID"),
				content: mcp.param.string("Memory content"),
				type: mcp.param.string("Memory type"),
				score: mcp.param.float("Relevance score"),
				tags: mcp.param.array(mcp.param.string(), "Memory tags").optional(),
			}),
			"Matching memories ranked by relevance",
		),
		count: mcp.param.int("Total number of results returned"),
	},
});

/**
 * Context tool - Assemble comprehensive context for a task.
 */
const context = mcp.tool({
	title: "Assemble Context",
	description:
		"Assemble comprehensive context for a task by combining: semantic memory search, past decisions, and file modification history. Use PROACTIVELY at the START of complex tasks to prime yourself with institutional knowledge before diving in. More thorough than recall alone - automatically searches multiple dimensions and cross-references results.",
	input: {
		task: mcp.param.string(
			"Description of the task you're starting. Be specific - 'implement OAuth2 login' retrieves better context than 'add auth'. The task description is used for semantic search across all memory types.",
		),
		files: mcp.param
			.array(
				mcp.param.string(),
				"File paths to retrieve modification history for. Useful when resuming work on specific files.",
			)
			.optional(),
		depth: mcp.param
			.enum(
				["shallow", "medium", "deep"] as const,
				"Search thoroughness. 'shallow': Quick scan, 3 memories + 2 files. 'medium': Balanced, 5 memories + 5 files. 'deep': Comprehensive, 10 memories + 10 files.",
			)
			.default("medium"),
	},
	output: {
		memories: mcp.param.array(
			mcp.param.object({
				id: mcp.param.string("Memory ID"),
				content: mcp.param.string("Memory content"),
				type: mcp.param.string("Memory type"),
				score: mcp.param.float("Relevance score"),
			}),
			"Relevant memories for the task",
		),
		decisions: mcp.param.array(
			mcp.param.object({
				id: mcp.param.string("Decision memory ID"),
				content: mcp.param.string("Decision content"),
				score: mcp.param.float("Relevance score"),
			}),
			"Past decisions relevant to this task",
		),
		files: mcp.param
			.array(
				mcp.param.object({
					path: mcp.param.string("File path"),
					sessions: mcp.param.array(mcp.param.string(), "Session IDs that touched this file"),
				}),
				"File modification history",
			)
			.optional(),
	},
});

/**
 * Query tool - Execute read-only Cypher queries against the knowledge graph.
 */
const query = mcp.tool({
	title: "Query Knowledge Graph",
	description:
		"Query the knowledge graph directly using Cypher for complex lookups that semantic search cannot handle. Use when you need to: find all decisions within a date range, trace relationships between sessions and files, count memories by type, or explore graph structure. Only read operations are allowed.",
	input: {
		cypher: mcp.param.string(
			"Cypher query starting with MATCH, WITH, or RETURN. Common patterns: 'MATCH (m:Memory {type: $type}) RETURN m' for filtering, 'MATCH (s:Session)-[:HAS_TURN]->(t:Turn) RETURN s, t' for relationships.",
		),
		params: mcp.param
			.object(
				{},
				"Query parameters for safe value injection. Use $paramName in query, provide {paramName: value} here.",
			)
			.optional(),
	},
	output: {
		results: mcp.param.array(
			mcp.param.object({}, "Query result row"),
			"Query results as array of objects",
		),
		count: mcp.param.int("Number of results returned"),
	},
});

// =============================================================================
// Tool Collection Export
// =============================================================================

/**
 * All Engram MCP tools.
 *
 * Used by code generation to produce:
 * - Zod schemas for input/output validation
 * - JSON Schema for MCP protocol
 * - Type-safe registration functions
 *
 * @example
 * ```bash
 * bun run generate --tools ./src/schema/mcp-tools.ts
 * ```
 */
export const engramTools = mcp.defineTools({
	summarize,
	extract_facts,
	enrich_memory,
	remember,
	recall,
	context,
	query,
});

export type EngramTools = typeof engramTools;

/** Alias for CLI compatibility */
export const mcpTools = engramTools;
