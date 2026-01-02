import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Types and interfaces for memory conflict detection
 *
 * Conflict detection identifies relationships between new and existing memories,
 * enabling intelligent deduplication, invalidation, and merging strategies.
 */

/**
 * Relationship types between a new memory and existing memory
 *
 * These relations guide how the system should handle memory conflicts:
 * - CONTRADICTION: Mutually exclusive facts (e.g., "X is true" vs "X is false")
 * - SUPERSEDES: New fact replaces old fact (e.g., updated preference, newer decision)
 * - AUGMENTS: New fact complements old fact (e.g., additional context, refinement)
 * - DUPLICATE: Semantically identical facts (e.g., paraphrased statements)
 * - INDEPENDENT: Facts are unrelated or orthogonal
 */
export enum ConflictRelation {
	/** Facts directly contradict each other - one must be invalidated */
	CONTRADICTION = "contradiction",
	/** New fact replaces old fact - invalidate the old memory */
	SUPERSEDES = "supersedes",
	/** New fact adds to old fact - keep both with a relationship */
	AUGMENTS = "augments",
	/** Facts are essentially the same - skip new memory to avoid duplication */
	DUPLICATE = "duplicate",
	/** Facts are unrelated - safe to keep both independently */
	INDEPENDENT = "independent",
}

/**
 * An existing memory that may conflict with a new memory
 *
 * Candidates are identified through vector similarity search and then
 * analyzed by an LLM to determine the actual relationship type.
 */
export interface ConflictCandidate {
	/** Unique identifier (ULID) of the existing memory */
	memoryId: string;
	/** Full text content of the existing memory */
	content: string;
	/** Memory type (decision, preference, insight, fact, context) */
	type: string;
	/** Valid-time start timestamp (when the fact became true) */
	vt_start: number;
	/** Valid-time end timestamp (when the fact was invalidated, or Infinity) */
	vt_end: number;
	/** Vector similarity score [0, 1] between new and existing memory */
	similarity: number;
}

/**
 * Result of conflict detection analysis for a single candidate
 *
 * Contains the LLM's assessment of the relationship between a new memory
 * and an existing candidate, including recommended action.
 */
export interface ConflictDetectionResult {
	/** The new memory being evaluated */
	newMemory: {
		/** Text content of the new memory */
		content: string;
		/** Memory type of the new memory */
		type: string;
	};
	/** The existing memory candidate being compared */
	candidate: ConflictCandidate;
	/** Type of relationship between new and existing memory */
	relation: ConflictRelation;
	/** Confidence score [0, 1] in the relationship classification */
	confidence: number;
	/** Human-readable explanation of the relationship */
	reasoning: string;
	/**
	 * Recommended action based on the relationship:
	 * - keep_both: Store both memories (INDEPENDENT, AUGMENTS)
	 * - invalidate_old: Set vt_end on old memory (CONTRADICTION, SUPERSEDES)
	 * - skip_new: Don't store the new memory (DUPLICATE)
	 * - merge: Combine into a single updated memory (future feature)
	 */
	suggestedAction: "keep_both" | "invalidate_old" | "skip_new" | "merge";
}

/**
 * JSON schema for conflict detection LLM response
 */
const CONFLICT_DETECTION_SCHEMA = {
	type: "object",
	properties: {
		relation: {
			type: "string",
			enum: ["contradiction", "supersedes", "augments", "duplicate", "independent"],
			description: "Type of relationship between memories",
		},
		confidence: {
			type: "number",
			minimum: 0,
			maximum: 1,
			description: "Confidence score in the classification",
		},
		reasoning: {
			type: "string",
			description: "Human-readable explanation of the relationship",
		},
		suggestedAction: {
			type: "string",
			enum: ["keep_both", "invalidate_old", "skip_new", "merge"],
			description: "Recommended action based on the relationship",
		},
	},
	required: ["relation", "confidence", "reasoning", "suggestedAction"],
	additionalProperties: false,
} as const;

/**
 * Service for detecting conflicts between new and existing memories.
 *
 * Uses LLM classification (via MCP sampling or Gemini) to identify relationships
 * between semantically similar memories, enabling intelligent deduplication,
 * invalidation, and merging.
 */
export class ConflictDetectorService {
	private server: McpServer;
	private logger: Logger;
	private geminiApiKey?: string;

	constructor(server: McpServer, logger: Logger, geminiApiKey?: string) {
		this.server = server;
		this.logger = logger;
		this.geminiApiKey = geminiApiKey || process.env.GEMINI_API_KEY;
	}

	/**
	 * Detect conflicts between a new memory and candidate existing memories.
	 *
	 * For each candidate, classifies the relationship using an LLM and returns
	 * structured results with recommended actions.
	 */
	async detectConflicts(
		newMemory: { content: string; type: string },
		candidates: ConflictCandidate[],
	): Promise<ConflictDetectionResult[]> {
		if (candidates.length === 0) {
			return [];
		}

		this.logger.debug(
			{ newMemoryType: newMemory.type, candidateCount: candidates.length },
			"Detecting conflicts for new memory",
		);

		const results: ConflictDetectionResult[] = [];

		// Process candidates sequentially to avoid overwhelming the LLM
		for (const candidate of candidates) {
			try {
				const prompt = this.buildPrompt(newMemory, candidate);

				// Try MCP sampling first (if available)
				let responseText = await this.tryWithSampling(prompt, this.server);

				// Fall back to Gemini via LiteLLM if sampling unavailable
				if (!responseText) {
					responseText = await this.classifyWithGemini(prompt);
				}

				const result = this.parseResponse(responseText, newMemory, candidate);
				results.push(result);

				this.logger.debug(
					{
						candidateId: candidate.memoryId,
						relation: result.relation,
						confidence: result.confidence,
					},
					"Conflict detection result",
				);
			} catch (error) {
				this.logger.warn(
					{ error, candidateId: candidate.memoryId },
					"Failed to classify conflict, defaulting to INDEPENDENT",
				);

				// Default to INDEPENDENT on error to avoid blocking memory storage
				results.push({
					newMemory,
					candidate,
					relation: ConflictRelation.INDEPENDENT,
					confidence: 0.5,
					reasoning: "Classification failed, defaulting to independent",
					suggestedAction: "keep_both",
				});
			}
		}

		return results;
	}

	/**
	 * Try using MCP sampling capability to classify the relationship.
	 * Returns the response text if successful, null if sampling unavailable.
	 */
	async tryWithSampling(prompt: string, server: McpServer): Promise<string | null> {
		try {
			// Check if sampling is available
			const clientCaps = (server.server as any).getClientCapabilities?.();
			if (!clientCaps?.sampling) {
				this.logger.debug("MCP sampling not available, will use Gemini fallback");
				return null;
			}

			this.logger.debug("Attempting conflict detection via MCP sampling");

			const response = await server.server.createMessage({
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: prompt,
						},
					},
				],
				maxTokens: 500,
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
	 * Classify the relationship using Gemini via LiteLLM.
	 * Uses JSON schema response_format for structured output.
	 */
	async classifyWithGemini(prompt: string): Promise<string> {
		if (!this.geminiApiKey) {
			throw new Error("GEMINI_API_KEY not configured for conflict detection");
		}

		this.logger.debug("Classifying conflict via Gemini with LiteLLM");

		// Use LiteLLM-compatible API endpoint
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
						responseSchema: CONFLICT_DETECTION_SCHEMA,
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
	 * Format a conflict detection result as a human-readable message.
	 * Used for elicitation prompts to help users understand what will change.
	 */
	formatConflictMessage(result: ConflictDetectionResult): string {
		const { candidate, relation, reasoning } = result;
		const oldDate = new Date(candidate.vt_start).toLocaleDateString();
		const relationLabel =
			relation === "supersedes"
				? "supersedes"
				: relation === "contradiction"
					? "contradicts"
					: relation;

		return `The new memory ${relationLabel} an existing memory from ${oldDate}:

**Existing memory (${candidate.type}):**
${candidate.content}

**Reason:** ${reasoning}

If you proceed, the old memory will be marked as no longer valid (invalidated), and the new memory will be stored as the current truth.`;
	}

	/**
	 * Build the classification prompt for LLM.
	 */
	buildPrompt(newMemory: { content: string; type: string }, candidate: ConflictCandidate): string {
		return `You are a memory conflict analyzer. Compare the new memory with an existing memory and classify their relationship.

NEW MEMORY:
Type: ${newMemory.type}
Content: ${newMemory.content}

EXISTING MEMORY:
Type: ${candidate.type}
Content: ${candidate.content}
Created: ${new Date(candidate.vt_start).toISOString()}
Similarity Score: ${candidate.similarity.toFixed(2)}

RELATIONSHIP TYPES:
- contradiction: Facts directly contradict each other (one must be true, the other false)
- supersedes: New fact replaces/updates the old fact (e.g., changed preference, newer decision)
- augments: New fact complements the old fact (additional context, refinement, related information)
- duplicate: Facts are semantically identical or paraphrased
- independent: Facts are unrelated or orthogonal

SUGGESTED ACTIONS:
- keep_both: Store both memories (for independent or augmenting relationships)
- invalidate_old: Mark old memory as no longer valid (for contradictions or supersessions)
- skip_new: Don't store the new memory (for duplicates)
- merge: Combine into one updated memory (future feature)

Analyze the relationship and respond with a JSON object containing:
{
  "relation": "one of: contradiction, supersedes, augments, duplicate, independent",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of the relationship",
  "suggestedAction": "one of: keep_both, invalidate_old, skip_new, merge"
}

Consider:
- Are they about the same topic or concept?
- Do they make contradictory claims?
- Is one more recent or more specific?
- Do they complement each other or duplicate information?`;
	}

	/**
	 * Parse the LLM response into a ConflictDetectionResult.
	 */
	parseResponse(
		responseText: string,
		newMemory: { content: string; type: string },
		candidate: ConflictCandidate,
	): ConflictDetectionResult {
		try {
			// Try direct JSON parse
			const parsed = JSON.parse(responseText.trim());

			// Validate required fields
			if (
				!parsed.relation ||
				typeof parsed.confidence !== "number" ||
				!parsed.reasoning ||
				!parsed.suggestedAction
			) {
				throw new Error("Missing required fields in LLM response");
			}

			// Validate enum values
			const validRelations = Object.values(ConflictRelation);
			if (!validRelations.includes(parsed.relation)) {
				throw new Error(`Invalid relation: ${parsed.relation}`);
			}

			const validActions = ["keep_both", "invalidate_old", "skip_new", "merge"];
			if (!validActions.includes(parsed.suggestedAction)) {
				throw new Error(`Invalid suggestedAction: ${parsed.suggestedAction}`);
			}

			// Clamp confidence to [0, 1]
			const confidence = Math.max(0, Math.min(1, parsed.confidence));

			return {
				newMemory,
				candidate,
				relation: parsed.relation as ConflictRelation,
				confidence,
				reasoning: parsed.reasoning,
				suggestedAction: parsed.suggestedAction,
			};
		} catch (error) {
			// Try to extract JSON from markdown code block
			const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
			if (codeBlockMatch?.[1]) {
				try {
					return this.parseResponse(codeBlockMatch[1], newMemory, candidate);
				} catch {
					// Fall through to default
				}
			}

			this.logger.warn({ error, responseText }, "Failed to parse LLM response, using default");

			// Return safe default
			return {
				newMemory,
				candidate,
				relation: ConflictRelation.INDEPENDENT,
				confidence: 0.5,
				reasoning: "Failed to parse LLM response",
				suggestedAction: "keep_both",
			};
		}
	}
}
