/**
 * Entity Extraction Prompt for Knowledge Graph Construction
 *
 * This prompt is designed for extracting entities and relationships from memory content
 * to build a queryable knowledge graph. It follows best practices from:
 * - Few-shot prompting for improved extraction accuracy
 * - Structured output for reliable parsing
 * - Confidence scoring for filtering low-quality extractions
 * - Entity linking via existing entity awareness
 *
 * References:
 * - Graphiti entity extraction approach (https://github.com/getzep/graphiti)
 * - LLM prompt ensemble methods (2025 research)
 * - Structured output best practices (JSON Schema for LLMs)
 */

import type { MemoryType } from "@engram/graph";

/**
 * Entity types supported in the knowledge graph
 */
export const ENTITY_TYPES = [
	"tool", // Software tools and utilities (pytest, Docker, Biome)
	"concept", // Abstract ideas and domains (authentication, caching, multi-tenancy)
	"pattern", // Design patterns and architectures (repository pattern, CQRS)
	"file", // Source code files (/src/index.ts, apps/api/src/server.ts)
	"person", // People mentioned (@alice, team members)
	"project", // Repositories, packages, services (@engram/graph, search service)
	"technology", // Languages, databases, frameworks (PostgreSQL, React, FalkorDB)
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * Relationship types between entities
 */
export const RELATIONSHIP_TYPES = [
	"RELATED_TO", // General semantic relationship
	"DEPENDS_ON", // A requires B (e.g., service depends on database)
	"IMPLEMENTS", // A implements B (e.g., class implements pattern)
	"PART_OF", // A is contained in B (e.g., file part of project)
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * Extracted entity with context and confidence
 */
export interface ExtractedEntity {
	/** Entity name (canonical form, e.g., "PostgreSQL" not "postgres") */
	name: string;
	/** Entity type classification */
	type: EntityType;
	/** Contextual snippet explaining the entity's relevance (1-2 sentences) */
	context: string;
	/** Confidence score 0.0-1.0 (threshold: 0.6 for production) */
	confidence: number;
}

/**
 * Extracted relationship between two entities
 */
export interface ExtractedRelationship {
	/** Source entity name (must match an entity.name) */
	from: string;
	/** Target entity name (must match an entity.name) */
	to: string;
	/** Relationship type */
	type: RelationshipType;
}

/**
 * Complete extraction result
 */
export interface EntityExtractionResult {
	entities: ExtractedEntity[];
	relationships: ExtractedRelationship[];
}

/**
 * System message for entity extraction
 */
export const ENTITY_EXTRACTION_SYSTEM_MESSAGE = `You are an expert entity extraction system for building knowledge graphs from developer memory content.

Your task is to extract entities (tools, concepts, patterns, files, people, projects, technologies) and relationships from memory content. Focus on:

1. **Accuracy over recall**: Only extract entities you're confident about (>0.6 confidence)
2. **Canonical naming**: Use standard names (PostgreSQL not postgres, React not react.js)
3. **Entity linking**: Reuse existing entity names when referring to the same concept
4. **Contextual relevance**: Only extract entities that are central to the memory's meaning

## Entity Types

- **tool**: Software tools and utilities (pytest, Docker, Biome, curl)
- **concept**: Abstract ideas and domains (authentication, caching, multi-tenancy, rate limiting)
- **pattern**: Design patterns and architectures (repository pattern, CQRS, pub/sub, bitemporal modeling)
- **file**: Source code files (use absolute paths: /apps/api/src/server.ts)
- **person**: People mentioned (@alice, Bob Johnson, team members)
- **project**: Repositories, packages, services (@engram/graph, search service, Observatory)
- **technology**: Languages, databases, frameworks (PostgreSQL, React, FalkorDB, TypeScript)

## Relationship Types

- **RELATED_TO**: General semantic relationship (authentication RELATED_TO JWT)
- **DEPENDS_ON**: A requires B (API service DEPENDS_ON PostgreSQL)
- **IMPLEMENTS**: A implements B (MemoryStore IMPLEMENTS repository pattern)
- **PART_OF**: A is contained in B (/src/auth.ts PART_OF @engram/api)

## Output Format

Return valid JSON matching this schema:

\`\`\`json
{
  "entities": [
    {
      "name": "string (canonical entity name)",
      "type": "tool|concept|pattern|file|person|project|technology",
      "context": "string (1-2 sentence explanation of relevance)",
      "confidence": number (0.0-1.0, minimum 0.6)
    }
  ],
  "relationships": [
    {
      "from": "string (source entity name)",
      "to": "string (target entity name)",
      "type": "RELATED_TO|DEPENDS_ON|IMPLEMENTS|PART_OF"
    }
  ]
}
\`\`\`

## Guidelines

- Extract 3-8 entities per memory (fewer for simple memories, more for complex ones)
- Extract 2-5 relationships (only meaningful connections)
- Use confidence scores: 0.9-1.0 (certain), 0.7-0.9 (likely), 0.6-0.7 (possible)
- Relationship entities must exist in the entities array
- Avoid generic entities (e.g., "code", "software", "system")
- File paths should be absolute when mentioned`;

/**
 * Few-shot examples for entity extraction
 */
export const ENTITY_EXTRACTION_EXAMPLES = [
	{
		memory_type: "decision" as MemoryType,
		memory_content:
			"Decided to use FalkorDB instead of Neo4j for graph storage because it's Redis-compatible and supports bitemporal modeling natively. This simplifies our infrastructure since we already run Redis for caching.",
		output: {
			entities: [
				{
					name: "FalkorDB",
					type: "technology",
					context:
						"Chosen as the graph database for its Redis compatibility and native bitemporal support.",
					confidence: 0.95,
				},
				{
					name: "Neo4j",
					type: "technology",
					context: "Considered but rejected alternative graph database.",
					confidence: 0.9,
				},
				{
					name: "Redis",
					type: "technology",
					context: "Already used for caching, enabling FalkorDB compatibility.",
					confidence: 0.85,
				},
				{
					name: "bitemporal modeling",
					type: "pattern",
					context: "Required data pattern that FalkorDB supports natively.",
					confidence: 0.9,
				},
				{
					name: "graph storage",
					type: "concept",
					context: "The primary use case requiring a specialized database.",
					confidence: 0.8,
				},
			],
			relationships: [
				{ from: "FalkorDB", to: "Redis", type: "DEPENDS_ON" },
				{ from: "FalkorDB", to: "bitemporal modeling", type: "IMPLEMENTS" },
				{ from: "graph storage", to: "FalkorDB", type: "RELATED_TO" },
			],
		},
	},
	{
		memory_type: "insight" as MemoryType,
		memory_content:
			"Discovered that pytest-asyncio requires explicit event_loop_policy='reuse' to avoid 'RuntimeError: Event loop is closed' in teardown. Added to pytest.ini after debugging for 2 hours.",
		output: {
			entities: [
				{
					name: "pytest-asyncio",
					type: "tool",
					context:
						"Testing library that required specific configuration to prevent event loop errors.",
					confidence: 0.95,
				},
				{
					name: "pytest.ini",
					type: "file",
					context: "Configuration file where the event_loop_policy setting was added.",
					confidence: 0.9,
				},
				{
					name: "event loop management",
					type: "concept",
					context: "The underlying issue causing RuntimeError during test teardown.",
					confidence: 0.75,
				},
			],
			relationships: [
				{ from: "pytest-asyncio", to: "pytest.ini", type: "RELATED_TO" },
				{ from: "pytest-asyncio", to: "event loop management", type: "RELATED_TO" },
			],
		},
	},
	{
		memory_type: "preference" as MemoryType,
		memory_content:
			"User prefers Biome over ESLint/Prettier for formatting because it's faster and has a single config file. Always use tabs, double quotes, 100 char line width.",
		output: {
			entities: [
				{
					name: "Biome",
					type: "tool",
					context: "Preferred formatter/linter for its speed and unified configuration.",
					confidence: 0.95,
				},
				{
					name: "ESLint",
					type: "tool",
					context: "Alternative linting tool that was rejected in favor of Biome.",
					confidence: 0.85,
				},
				{
					name: "Prettier",
					type: "tool",
					context: "Alternative formatter that was rejected in favor of Biome.",
					confidence: 0.85,
				},
			],
			relationships: [],
		},
	},
	{
		memory_type: "fact" as MemoryType,
		memory_content:
			"The search service at apps/search uses FastAPI with Qdrant for vector storage and supports four reranking tiers: fast (FlashRank), accurate (BGE), code (Jina), and llm (Gemini).",
		output: {
			entities: [
				{
					name: "search service",
					type: "project",
					context: "FastAPI-based service responsible for vector search and reranking.",
					confidence: 0.95,
				},
				{
					name: "/apps/search",
					type: "file",
					context: "Directory containing the search service implementation.",
					confidence: 0.9,
				},
				{
					name: "FastAPI",
					type: "technology",
					context: "Python web framework used to build the search service.",
					confidence: 0.95,
				},
				{
					name: "Qdrant",
					type: "technology",
					context: "Vector database used for storing and searching embeddings.",
					confidence: 0.95,
				},
				{
					name: "FlashRank",
					type: "tool",
					context: "Fast reranking model used in the 'fast' tier.",
					confidence: 0.85,
				},
				{
					name: "BGE",
					type: "tool",
					context: "Accurate cross-encoder reranking model.",
					confidence: 0.85,
				},
				{
					name: "Jina",
					type: "tool",
					context: "Code-optimized reranking model.",
					confidence: 0.85,
				},
			],
			relationships: [
				{ from: "search service", to: "/apps/search", type: "PART_OF" },
				{ from: "search service", to: "FastAPI", type: "DEPENDS_ON" },
				{ from: "search service", to: "Qdrant", type: "DEPENDS_ON" },
				{ from: "FlashRank", to: "search service", type: "PART_OF" },
				{ from: "BGE", to: "search service", type: "PART_OF" },
				{ from: "Jina", to: "search service", type: "PART_OF" },
			],
		},
	},
	{
		memory_type: "context" as MemoryType,
		memory_content:
			"Currently migrating from API keys to OAuth 2.1 for all service authentication. Observatory acts as the authorization server, implementing RFC 7662 token introspection. All services (api, search, tuner, ingestion) are being updated.",
		output: {
			entities: [
				{
					name: "OAuth 2.1",
					type: "technology",
					context: "New authentication protocol being adopted across all services.",
					confidence: 0.95,
				},
				{
					name: "Observatory",
					type: "project",
					context: "Service acting as the OAuth authorization server.",
					confidence: 0.95,
				},
				{
					name: "token introspection",
					type: "concept",
					context: "RFC 7662 standard implemented by Observatory for validating tokens.",
					confidence: 0.85,
				},
				{
					name: "api",
					type: "project",
					context: "Service being updated to use OAuth authentication.",
					confidence: 0.9,
				},
				{
					name: "search",
					type: "project",
					context: "Service being updated to use OAuth authentication.",
					confidence: 0.9,
				},
			],
			relationships: [
				{ from: "Observatory", to: "OAuth 2.1", type: "IMPLEMENTS" },
				{ from: "Observatory", to: "token introspection", type: "IMPLEMENTS" },
				{ from: "api", to: "OAuth 2.1", type: "DEPENDS_ON" },
				{ from: "search", to: "OAuth 2.1", type: "DEPENDS_ON" },
			],
		},
	},
] as const;

/**
 * Generate user prompt for entity extraction
 */
export function generateEntityExtractionPrompt(
	memoryContent: string,
	memoryType: MemoryType,
	existingEntities: string[],
): string {
	const existingEntitiesSection =
		existingEntities.length > 0
			? `
## Existing Entities (Reuse These When Relevant)

${existingEntities.map((e) => `- ${e}`).join("\n")}

When you encounter these entities in the memory, use the exact name from this list to enable entity linking across memories.
`
			: "";

	return `Extract entities and relationships from the following memory.

## Memory Details

**Type**: ${memoryType}
**Content**: ${memoryContent}
${existingEntitiesSection}
## Your Task

1. Identify 3-8 relevant entities with confidence ≥ 0.6
2. Extract 2-5 meaningful relationships between entities
3. Use canonical entity names and prefer reusing existing entities
4. Provide 1-2 sentence context explaining each entity's relevance
5. Return valid JSON matching the schema

Remember: Quality over quantity. Only extract entities and relationships that are central to the memory's meaning.`;
}

/**
 * Validate extraction result against schema
 */
export function validateExtractionResult(result: unknown): result is EntityExtractionResult {
	if (!result || typeof result !== "object") return false;

	const typed = result as Partial<EntityExtractionResult>;

	if (!Array.isArray(typed.entities) || !Array.isArray(typed.relationships)) {
		return false;
	}

	// Validate entities
	for (const entity of typed.entities) {
		if (!entity.name || !entity.type || !entity.context || typeof entity.confidence !== "number") {
			return false;
		}
		if (!ENTITY_TYPES.includes(entity.type as EntityType)) {
			return false;
		}
		if (entity.confidence < 0 || entity.confidence > 1) {
			return false;
		}
	}

	// Validate relationships
	const entityNames = new Set(typed.entities.map((e) => e.name));
	for (const rel of typed.relationships) {
		if (!rel.from || !rel.to || !rel.type) {
			return false;
		}
		if (!RELATIONSHIP_TYPES.includes(rel.type as RelationshipType)) {
			return false;
		}
		// Both entities must exist in the entities array
		if (!entityNames.has(rel.from) || !entityNames.has(rel.to)) {
			return false;
		}
	}

	return true;
}

/**
 * Filter entities by confidence threshold
 */
export function filterByConfidence(
	result: EntityExtractionResult,
	threshold = 0.6,
): EntityExtractionResult {
	const filteredEntities = result.entities.filter((e) => e.confidence >= threshold);
	const entityNames = new Set(filteredEntities.map((e) => e.name));

	// Remove relationships where either entity was filtered out
	const filteredRelationships = result.relationships.filter(
		(r) => entityNames.has(r.from) && entityNames.has(r.to),
	);

	return {
		entities: filteredEntities,
		relationships: filteredRelationships,
	};
}
