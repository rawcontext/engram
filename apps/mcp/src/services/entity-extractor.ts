import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Types and interfaces for entity extraction from memory content
 *
 * Entity extraction identifies key entities (tools, concepts, patterns, etc.)
 * and relationships between them, enabling knowledge graph construction.
 */

/**
 * Entity types extracted from memory content
 */
export enum EntityType {
	/** Software tools and utilities (pytest, Docker, Kubernetes) */
	TOOL = "tool",
	/** Abstract ideas and concepts (authentication, caching, testing) */
	CONCEPT = "concept",
	/** Design patterns and architectural patterns (repository pattern, CQRS) */
	PATTERN = "pattern",
	/** Source code files */
	FILE = "file",
	/** People mentioned in memories */
	PERSON = "person",
	/** Repositories, packages, services */
	PROJECT = "project",
	/** Languages, databases, frameworks (PostgreSQL, React) */
	TECHNOLOGY = "technology",
}

/**
 * Relationship types between entities
 */
export enum RelationshipType {
	/** Generic relationship between entities */
	RELATED_TO = "RELATED_TO",
	/** One entity depends on another */
	DEPENDS_ON = "DEPENDS_ON",
	/** One entity implements another */
	IMPLEMENTS = "IMPLEMENTS",
	/** One entity is part of another */
	PART_OF = "PART_OF",
}

/**
 * An extracted entity with metadata
 */
export interface ExtractedEntity {
	/** Canonical name of the entity */
	name: string;
	/** Type of entity */
	type: EntityType;
	/** Context describing how it appears in the memory */
	context: string;
	/** Confidence score [0, 1] */
	confidence: number;
}

/**
 * An extracted relationship between entities
 */
export interface ExtractedRelationship {
	/** Source entity name */
	from: string;
	/** Target entity name */
	to: string;
	/** Type of relationship */
	type: RelationshipType;
}

/**
 * Result of entity extraction
 */
export interface EntityExtractionResult {
	/** Extracted entities */
	entities: ExtractedEntity[];
	/** Extracted relationships between entities */
	relationships: ExtractedRelationship[];
	/** Time taken for extraction in milliseconds */
	took_ms: number;
	/** Model used for extraction */
	model_used: "sampling" | "gemini";
}

/**
 * JSON schema for entity extraction LLM response
 */
const ENTITY_EXTRACTION_SCHEMA = {
	type: "object",
	properties: {
		entities: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "Canonical name of the entity",
					},
					type: {
						type: "string",
						enum: ["tool", "concept", "pattern", "file", "person", "project", "technology"],
						description: "Type of entity",
					},
					context: {
						type: "string",
						description: "How this entity appears in the memory",
					},
					confidence: {
						type: "number",
						minimum: 0,
						maximum: 1,
						description: "Confidence score for this entity",
					},
				},
				required: ["name", "type", "context", "confidence"],
			},
		},
		relationships: {
			type: "array",
			items: {
				type: "object",
				properties: {
					from: {
						type: "string",
						description: "Source entity name",
					},
					to: {
						type: "string",
						description: "Target entity name",
					},
					type: {
						type: "string",
						enum: ["RELATED_TO", "DEPENDS_ON", "IMPLEMENTS", "PART_OF"],
						description: "Type of relationship",
					},
				},
				required: ["from", "to", "type"],
			},
		},
	},
	required: ["entities", "relationships"],
	additionalProperties: false,
} as const;

/**
 * Service for extracting entities and relationships from memory content.
 *
 * Uses LLM analysis (via MCP sampling or Gemini) to identify key entities
 * and their relationships, enabling knowledge graph construction.
 */
export class EntityExtractorService {
	private server: McpServer;
	private logger: Logger;
	private geminiApiKey?: string;

	constructor(server: McpServer, logger: Logger, geminiApiKey?: string) {
		this.server = server;
		this.logger = logger;
		this.geminiApiKey = geminiApiKey || process.env.GEMINI_API_KEY;
	}

	/**
	 * Extract entities and relationships from memory content.
	 *
	 * Analyzes the content using an LLM to identify key entities (tools, concepts,
	 * patterns, etc.) and relationships between them.
	 */
	async extract(
		content: string,
		memoryType: string,
		existingEntities?: string[],
	): Promise<EntityExtractionResult> {
		const startTime = Date.now();

		this.logger.debug(
			{
				memoryType,
				contentLength: content.length,
				existingEntitiesCount: existingEntities?.length,
			},
			"Extracting entities from memory content",
		);

		try {
			const prompt = this.buildPrompt(content, memoryType, existingEntities);

			// Try MCP sampling first (if available)
			let responseText: string | null = null;
			let modelUsed: "sampling" | "gemini" = "sampling";

			responseText = await this.tryWithSampling(prompt);

			// Fall back to Gemini if sampling unavailable
			if (!responseText) {
				responseText = await this.extractWithGemini(prompt);
				modelUsed = "gemini";
			}

			const result = this.parseResponse(responseText);

			const took_ms = Date.now() - startTime;

			this.logger.debug(
				{
					entityCount: result.entities.length,
					relationshipCount: result.relationships.length,
					took_ms,
					modelUsed,
				},
				"Entity extraction complete",
			);

			return {
				...result,
				took_ms,
				model_used: modelUsed,
			};
		} catch (error) {
			this.logger.warn({ error }, "Failed to extract entities, returning empty result");

			// Return empty result on error
			return {
				entities: [],
				relationships: [],
				took_ms: Date.now() - startTime,
				model_used: "gemini",
			};
		}
	}

	/**
	 * Try using MCP sampling capability to extract entities.
	 * Returns the response text if successful, null if sampling unavailable.
	 */
	async tryWithSampling(prompt: string): Promise<string | null> {
		try {
			// Check if sampling is available
			const clientCaps = (this.server.server as any).getClientCapabilities?.();
			if (!clientCaps?.sampling) {
				this.logger.debug("MCP sampling not available, will use Gemini fallback");
				return null;
			}

			this.logger.debug("Attempting entity extraction via MCP sampling");

			const response = await this.server.server.createMessage({
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: prompt,
						},
					},
				],
				maxTokens: 1000,
			});

			if (!response || response.content.type !== "text") {
				return null;
			}

			return response.content.text;
		} catch (error) {
			this.logger.debug({ error }, "MCP sampling failed, falling back to Gemini");
			return null;
		}
	}

	/**
	 * Extract entities using Gemini API.
	 * Uses JSON schema response_format for structured output.
	 */
	async extractWithGemini(prompt: string): Promise<string> {
		if (!this.geminiApiKey) {
			throw new Error("GEMINI_API_KEY not configured for entity extraction");
		}

		this.logger.debug("Extracting entities via Gemini");

		// Use Gemini API endpoint
		const response = await fetch(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-goog-api-key": this.geminiApiKey,
				},
				body: JSON.stringify({
					contents: [
						{
							parts: [{ text: prompt }],
						},
					],
					generationConfig: {
						responseMimeType: "application/json",
						responseSchema: ENTITY_EXTRACTION_SCHEMA,
					},
				}),
			},
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Gemini API error: ${response.status} ${errorText}`);
		}

		const data = await response.json();

		// Extract text from Gemini response format
		const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!text) {
			throw new Error("No text in Gemini response");
		}

		return text;
	}

	/**
	 * Build the extraction prompt for LLM.
	 */
	buildPrompt(content: string, memoryType: string, existingEntities?: string[]): string {
		const existingEntitiesSection = existingEntities?.length
			? `
EXISTING ENTITIES (prefer reusing these when applicable):
${existingEntities.map((e) => `- ${e}`).join("\n")}
`
			: "";

		return `You are an entity extraction system. Extract key entities and their relationships from the memory content below.

MEMORY CONTENT:
Type: ${memoryType}
Content: ${content}
${existingEntitiesSection}
ENTITY TYPES:
- tool: Software tools and utilities (e.g., pytest, Docker, Kubernetes, git, npm)
- concept: Abstract ideas (e.g., authentication, caching, testing, validation)
- pattern: Design patterns (e.g., repository pattern, CQRS, event sourcing, MVC)
- file: Source code files (e.g., /src/index.ts, config.json)
- person: People mentioned (e.g., John Doe, @username)
- project: Repositories, packages, services (e.g., engram, next.js, postgres)
- technology: Languages, databases, frameworks (e.g., PostgreSQL, React, Python, TypeScript)

RELATIONSHIP TYPES:
- RELATED_TO: Generic relationship between entities
- DEPENDS_ON: One entity depends on another (e.g., service depends on database)
- IMPLEMENTS: One entity implements another (e.g., class implements pattern)
- PART_OF: One entity is part of another (e.g., file is part of project)

EXTRACTION GUIDELINES:
1. Extract only meaningful entities that provide value for knowledge graph navigation
2. Use canonical names (e.g., "PostgreSQL" not "postgres", "React" not "react.js")
3. Prefer reusing existing entities when the same concept is mentioned
4. Focus on entities central to the memory's meaning
5. Extract relationships only when clear and meaningful
6. Assign confidence scores based on clarity and importance (0.0-1.0)
7. Avoid extracting overly generic terms unless they are central to the memory

Respond with a JSON object containing:
{
  "entities": [
    {
      "name": "canonical entity name",
      "type": "one of: tool, concept, pattern, file, person, project, technology",
      "context": "how this entity appears in the memory",
      "confidence": 0.0-1.0
    }
  ],
  "relationships": [
    {
      "from": "source entity name",
      "to": "target entity name",
      "type": "one of: RELATED_TO, DEPENDS_ON, IMPLEMENTS, PART_OF"
    }
  ]
}`;
	}

	/**
	 * Parse the LLM response into an EntityExtractionResult.
	 */
	parseResponse(responseText: string): {
		entities: ExtractedEntity[];
		relationships: ExtractedRelationship[];
	} {
		try {
			// Try direct JSON parse
			const parsed = JSON.parse(responseText.trim());

			// Validate structure
			if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.relationships)) {
				throw new Error("Invalid response structure: missing entities or relationships arrays");
			}

			// Validate and normalize entities
			const entities: ExtractedEntity[] = parsed.entities.map((e: any) => {
				if (!e.name || !e.type || !e.context || typeof e.confidence !== "number") {
					throw new Error("Invalid entity structure");
				}

				// Validate entity type
				const validTypes = Object.values(EntityType);
				if (!validTypes.includes(e.type)) {
					throw new Error(`Invalid entity type: ${e.type}`);
				}

				// Clamp confidence to [0, 1]
				const confidence = Math.max(0, Math.min(1, e.confidence));

				return {
					name: String(e.name),
					type: e.type as EntityType,
					context: String(e.context),
					confidence,
				};
			});

			// Validate and normalize relationships
			const relationships: ExtractedRelationship[] = parsed.relationships.map((r: any) => {
				if (!r.from || !r.to || !r.type) {
					throw new Error("Invalid relationship structure");
				}

				// Validate relationship type
				const validTypes = Object.values(RelationshipType);
				if (!validTypes.includes(r.type)) {
					throw new Error(`Invalid relationship type: ${r.type}`);
				}

				return {
					from: String(r.from),
					to: String(r.to),
					type: r.type as RelationshipType,
				};
			});

			return { entities, relationships };
		} catch (error) {
			// Try to extract JSON from markdown code block
			const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
			if (codeBlockMatch?.[1]) {
				try {
					return this.parseResponse(codeBlockMatch[1]);
				} catch {
					// Fall through to default
				}
			}

			this.logger.warn(
				{ error, responseText },
				"Failed to parse LLM response, returning empty result",
			);

			// Return empty result on parse failure
			return {
				entities: [],
				relationships: [],
			};
		}
	}
}
