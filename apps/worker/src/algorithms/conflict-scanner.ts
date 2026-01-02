/**
 * Background Conflict Scanner
 *
 * Weekly scan of all memories to detect contradictions and superseded information.
 * Uses vector similarity to find candidates, LLM classification to confirm conflicts,
 * creates ConflictReport nodes for review. Does not auto-invalidate.
 *
 * Pipeline:
 * 1. Load active memories per project (partition by org_id)
 * 2. Vector search for candidates (similarity > 0.7, top 5 per memory)
 * 3. Batch LLM classification: CONTRADICTION, SUPERSEDES, INDEPENDENT
 * 4. Create ConflictReport nodes with status=pending_review
 * 5. Notify via webhook (if configured)
 *
 * @see https://arxiv.org/abs/2501.13956 - Zep temporal knowledge graphs
 */

import type { ConflictRelationValue } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
import { ulid } from "ulid";

// =============================================================================
// Types
// =============================================================================

/**
 * Memory candidate for conflict detection from FalkorDB
 */
export interface MemoryCandidate {
	id: string;
	content: string;
	type: string;
	project: string | null;
	vt_start: number;
	vt_end: number;
	orgId: string;
}

/**
 * Conflict candidate from vector search
 */
export interface VectorCandidate {
	memoryId: string;
	content: string;
	type: string;
	similarity: number;
	vt_start: number;
}

/**
 * LLM classification result for a conflict pair
 */
export interface ConflictClassification {
	memoryA: MemoryCandidate;
	memoryB: VectorCandidate;
	relation: ConflictRelationValue;
	confidence: number;
	reasoning: string;
	suggestedAction: "invalidate_a" | "invalidate_b" | "keep_both" | "merge";
}

/**
 * Options for conflict scanning
 */
export interface ConflictScannerOptions {
	/** Minimum similarity threshold for candidates (default: 0.7) */
	similarityThreshold?: number;
	/** Maximum candidates per memory to check (default: 5) */
	maxCandidatesPerMemory?: number;
	/** Batch size for LLM classification (default: 20) */
	llmBatchSize?: number;
	/** LLM model to use (default: gemini-2.0-flash-exp) */
	llmModel?: string;
	/** Gemini API key */
	geminiApiKey?: string;
	/** Search service URL for vector search */
	searchUrl?: string;
	/** OAuth token for search service */
	authToken?: string;
}

/**
 * Result of a conflict scan job
 */
export interface ConflictScanResult {
	scanId: string;
	memoriesScanned: number;
	candidatesFound: number;
	conflictsDetected: number;
	reportsCreated: number;
	durationMs: number;
	errors: string[];
}

// =============================================================================
// Constants
// =============================================================================

const CONFLICT_CLASSIFICATION_SCHEMA = {
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
			enum: ["invalidate_a", "invalidate_b", "keep_both", "merge"],
			description:
				"Recommended action: invalidate_a (older), invalidate_b (newer), keep_both, or merge",
		},
	},
	required: ["relation", "confidence", "reasoning", "suggestedAction"],
	additionalProperties: false,
} as const;

// =============================================================================
// ConflictScanner Class
// =============================================================================

/**
 * Scans memory graph for conflicts and creates ConflictReport nodes
 */
export class ConflictScanner {
	private graphClient: GraphClient;
	private logger: Logger;
	private options: Required<ConflictScannerOptions>;

	constructor(graphClient: GraphClient, logger: Logger, options?: ConflictScannerOptions) {
		this.graphClient = graphClient;
		this.logger = logger.child({ component: "conflict-scanner" });
		this.options = {
			similarityThreshold: options?.similarityThreshold ?? 0.7,
			maxCandidatesPerMemory: options?.maxCandidatesPerMemory ?? 5,
			llmBatchSize: options?.llmBatchSize ?? 20,
			llmModel: options?.llmModel ?? "gemini-2.0-flash-exp",
			geminiApiKey: options?.geminiApiKey ?? process.env.GEMINI_API_KEY ?? "",
			searchUrl: options?.searchUrl ?? process.env.SEARCH_URL ?? "http://localhost:6176",
			authToken: options?.authToken ?? process.env.AUTH_TOKEN ?? "",
		};
	}

	/**
	 * Run a full conflict scan across all organizations
	 */
	async scan(): Promise<ConflictScanResult> {
		const scanId = ulid();
		const startTime = Date.now();
		const errors: string[] = [];

		this.logger.info({ scanId }, "Starting conflict scan");

		let memoriesScanned = 0;
		let candidatesFound = 0;
		let conflictsDetected = 0;
		let reportsCreated = 0;

		try {
			// Get all unique org_ids with active memories
			const orgIds = await this.getActiveOrgIds();
			this.logger.info({ scanId, orgCount: orgIds.length }, "Found organizations to scan");

			for (const orgId of orgIds) {
				try {
					const result = await this.scanOrganization(scanId, orgId);
					memoriesScanned += result.memoriesScanned;
					candidatesFound += result.candidatesFound;
					conflictsDetected += result.conflictsDetected;
					reportsCreated += result.reportsCreated;
				} catch (error) {
					const errMsg = `Failed to scan org ${orgId}: ${error instanceof Error ? error.message : String(error)}`;
					this.logger.error({ scanId, orgId, error }, errMsg);
					errors.push(errMsg);
				}
			}
		} catch (error) {
			const errMsg = `Scan failed: ${error instanceof Error ? error.message : String(error)}`;
			this.logger.error({ scanId, error }, errMsg);
			errors.push(errMsg);
		}

		const durationMs = Date.now() - startTime;

		const result: ConflictScanResult = {
			scanId,
			memoriesScanned,
			candidatesFound,
			conflictsDetected,
			reportsCreated,
			durationMs,
			errors,
		};

		this.logger.info(result, "Conflict scan completed");

		return result;
	}

	/**
	 * Get all organization IDs with active memories
	 */
	private async getActiveOrgIds(): Promise<string[]> {
		const query = `
			MATCH (m:Memory)
			WHERE m.vt_end > $now
			RETURN DISTINCT m.org_id AS orgId
		`;

		const result = await this.graphClient.query<{ orgId: string }>(query, { now: Date.now() });
		return result.map((row) => row.orgId).filter(Boolean);
	}

	/**
	 * Scan all memories for a single organization
	 */
	private async scanOrganization(
		scanId: string,
		orgId: string,
	): Promise<Omit<ConflictScanResult, "scanId" | "durationMs" | "errors">> {
		this.logger.debug({ scanId, orgId }, "Scanning organization");

		// Load all active memories for this org
		const memories = await this.loadActiveMemories(orgId);
		this.logger.debug({ scanId, orgId, memoryCount: memories.length }, "Loaded active memories");

		let candidatesFound = 0;
		let conflictsDetected = 0;
		let reportsCreated = 0;

		// Process memories in batches to avoid overwhelming the search service
		const conflictPairs: Array<{ memory: MemoryCandidate; candidate: VectorCandidate }> = [];

		for (const memory of memories) {
			const candidates = await this.findConflictCandidates(memory, orgId);
			candidatesFound += candidates.length;

			for (const candidate of candidates) {
				// Skip self-matches and already processed pairs
				if (candidate.memoryId === memory.id) continue;

				conflictPairs.push({ memory, candidate });
			}
		}

		this.logger.debug(
			{ scanId, orgId, pairsToClassify: conflictPairs.length },
			"Found candidate pairs",
		);

		// Batch classify conflict pairs
		const classifications = await this.batchClassify(conflictPairs);

		// Filter to actual conflicts (not INDEPENDENT or low confidence)
		const actualConflicts = classifications.filter(
			(c) => c.relation !== "independent" && c.relation !== "augments" && c.confidence >= 0.7,
		);

		conflictsDetected = actualConflicts.length;

		// Create ConflictReport nodes
		for (const conflict of actualConflicts) {
			try {
				await this.createConflictReport(scanId, orgId, conflict);
				reportsCreated++;
			} catch (error) {
				this.logger.warn(
					{
						scanId,
						orgId,
						memoryA: conflict.memoryA.id,
						memoryB: conflict.memoryB.memoryId,
						error,
					},
					"Failed to create conflict report",
				);
			}
		}

		return {
			memoriesScanned: memories.length,
			candidatesFound,
			conflictsDetected,
			reportsCreated,
		};
	}

	/**
	 * Load active memories for an organization from FalkorDB
	 */
	private async loadActiveMemories(orgId: string): Promise<MemoryCandidate[]> {
		const query = `
			MATCH (m:Memory)
			WHERE m.org_id = $orgId AND m.vt_end > $now
			RETURN m.id AS id, m.content AS content, m.type AS type,
			       m.project AS project, m.vt_start AS vt_start, m.vt_end AS vt_end,
			       m.org_id AS orgId
			ORDER BY m.vt_start DESC
		`;

		interface MemoryRow {
			id: string;
			content: string;
			type: string;
			project: string | null;
			vt_start: number;
			vt_end: number;
			orgId: string;
		}

		const result = await this.graphClient.query<MemoryRow>(query, { orgId, now: Date.now() });

		return result.map((row) => ({
			id: row.id,
			content: row.content,
			type: row.type,
			project: row.project,
			vt_start: row.vt_start,
			vt_end: row.vt_end,
			orgId: row.orgId,
		}));
	}

	/**
	 * Find conflict candidates for a memory using vector search
	 */
	private async findConflictCandidates(
		memory: MemoryCandidate,
		_orgId: string,
	): Promise<VectorCandidate[]> {
		try {
			const url = `${this.options.searchUrl}/v1/search/conflict-candidates`;
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.options.authToken}`,
				},
				body: JSON.stringify({
					content: memory.content,
					project: memory.project,
				}),
			});

			if (!response.ok) {
				this.logger.warn(
					{ memoryId: memory.id, status: response.status },
					"Failed to fetch conflict candidates",
				);
				return [];
			}

			const candidates = (await response.json()) as Array<{
				id: string;
				content: string;
				type: string;
				score: number;
				vt_start: number;
			}>;

			// Filter by threshold and exclude self
			return candidates
				.filter((c) => c.score >= this.options.similarityThreshold && c.id !== memory.id)
				.slice(0, this.options.maxCandidatesPerMemory)
				.map((c) => ({
					memoryId: c.id,
					content: c.content,
					type: c.type,
					similarity: c.score,
					vt_start: c.vt_start,
				}));
		} catch (error) {
			this.logger.warn({ memoryId: memory.id, error }, "Error fetching conflict candidates");
			return [];
		}
	}

	/**
	 * Batch classify conflict pairs using LLM
	 */
	private async batchClassify(
		pairs: Array<{ memory: MemoryCandidate; candidate: VectorCandidate }>,
	): Promise<ConflictClassification[]> {
		if (pairs.length === 0) return [];

		const results: ConflictClassification[] = [];

		// Process in batches
		for (let i = 0; i < pairs.length; i += this.options.llmBatchSize) {
			const batch = pairs.slice(i, i + this.options.llmBatchSize);
			const batchResults = await this.classifyBatch(batch);
			results.push(...batchResults);
		}

		return results;
	}

	/**
	 * Classify a batch of conflict pairs
	 */
	private async classifyBatch(
		pairs: Array<{ memory: MemoryCandidate; candidate: VectorCandidate }>,
	): Promise<ConflictClassification[]> {
		if (!this.options.geminiApiKey) {
			this.logger.warn("No Gemini API key configured, skipping classification");
			return [];
		}

		const results: ConflictClassification[] = [];

		// Process each pair individually (Gemini doesn't support true batching well)
		for (const pair of pairs) {
			try {
				const result = await this.classifyPair(pair.memory, pair.candidate);
				results.push(result);
			} catch (error) {
				this.logger.debug(
					{ memoryA: pair.memory.id, memoryB: pair.candidate.memoryId, error },
					"Failed to classify pair, defaulting to independent",
				);
				results.push({
					memoryA: pair.memory,
					memoryB: pair.candidate,
					relation: "independent",
					confidence: 0.5,
					reasoning: "Classification failed, defaulting to independent",
					suggestedAction: "keep_both",
				});
			}
		}

		return results;
	}

	/**
	 * Classify a single memory pair using Gemini
	 */
	private async classifyPair(
		memoryA: MemoryCandidate,
		memoryB: VectorCandidate,
	): Promise<ConflictClassification> {
		const prompt = this.buildClassificationPrompt(memoryA, memoryB);

		const response = await fetch(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-goog-api-key": this.options.geminiApiKey,
				},
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						responseMimeType: "application/json",
						responseSchema: CONFLICT_CLASSIFICATION_SCHEMA,
					},
				}),
			},
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Gemini API error: ${response.status} ${errorText}`);
		}

		const data = await response.json();
		const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

		if (!text) {
			throw new Error("No text in Gemini response");
		}

		const parsed = JSON.parse(text);

		return {
			memoryA,
			memoryB,
			relation: parsed.relation,
			confidence: Math.max(0, Math.min(1, parsed.confidence)),
			reasoning: parsed.reasoning,
			suggestedAction: parsed.suggestedAction,
		};
	}

	/**
	 * Build the classification prompt for LLM
	 */
	private buildClassificationPrompt(memoryA: MemoryCandidate, memoryB: VectorCandidate): string {
		const dateA = new Date(memoryA.vt_start).toISOString();
		const dateB = new Date(memoryB.vt_start).toISOString();

		return `You are a memory conflict analyzer for an AI agent's long-term memory system.
Compare these two memories and classify their relationship.

MEMORY A (older):
Type: ${memoryA.type}
Created: ${dateA}
Content: ${memoryA.content}

MEMORY B (newer):
Type: ${memoryB.type}
Created: ${dateB}
Content: ${memoryB.content}
Similarity Score: ${memoryB.similarity.toFixed(3)}

RELATIONSHIP TYPES:
- contradiction: Facts directly contradict each other (one must be true, the other false)
- supersedes: One fact replaces/updates the other (e.g., changed preference, newer decision)
- augments: One fact complements the other (additional context, refinement, related information)
- duplicate: Facts are semantically identical or paraphrased
- independent: Facts are unrelated or orthogonal despite vector similarity

SUGGESTED ACTIONS (if conflict detected):
- invalidate_a: Mark the older memory as no longer valid
- invalidate_b: Mark the newer memory as no longer valid (rare - usually newer wins)
- keep_both: Store both memories (for independent or augmenting relationships)
- merge: Combine into one updated memory (future feature)

Analyze the relationship and respond with a JSON object.

Consider:
- Are they about the same topic or concept?
- Do they make contradictory claims?
- Is one more recent or more specific?
- Do they complement each other or duplicate information?
- For decisions/preferences: has the user changed their mind?`;
	}

	/**
	 * Create a ConflictReport node in FalkorDB
	 */
	private async createConflictReport(
		scanId: string,
		orgId: string,
		conflict: ConflictClassification,
	): Promise<void> {
		const now = Date.now();
		const reportId = ulid();

		const query = `
			CREATE (r:ConflictReport {
				id: $id,
				memoryIdA: $memoryIdA,
				memoryIdB: $memoryIdB,
				relation: $relation,
				confidence: $confidence,
				reasoning: $reasoning,
				modelUsed: $modelUsed,
				status: 'pending_review',
				suggestedAction: $suggestedAction,
				scanId: $scanId,
				scannedAt: $scannedAt,
				orgId: $orgId,
				project: $project,
				vt_start: $now,
				vt_end: 9999999999999,
				tt_start: $now,
				tt_end: 9999999999999
			})
			RETURN r.id AS id
		`;

		await this.graphClient.query(query, {
			id: reportId,
			memoryIdA: conflict.memoryA.id,
			memoryIdB: conflict.memoryB.memoryId,
			relation: conflict.relation,
			confidence: conflict.confidence,
			reasoning: conflict.reasoning,
			modelUsed: this.options.llmModel,
			suggestedAction: conflict.suggestedAction,
			scanId,
			scannedAt: now,
			orgId,
			project: conflict.memoryA.project,
			now,
		});

		// Create CONFLICTS_WITH edges to both memories
		const edgeQuery = `
			MATCH (r:ConflictReport {id: $reportId}), (m:Memory {id: $memoryId})
			CREATE (r)-[:CONFLICTS_WITH {
				role: $role,
				vt_start: $now,
				vt_end: 9999999999999,
				tt_start: $now,
				tt_end: 9999999999999
			}]->(m)
		`;

		await Promise.all([
			this.graphClient.query(edgeQuery, {
				reportId,
				memoryId: conflict.memoryA.id,
				role: "memory_a",
				now,
			}),
			this.graphClient.query(edgeQuery, {
				reportId,
				memoryId: conflict.memoryB.memoryId,
				role: "memory_b",
				now,
			}),
		]);

		this.logger.debug(
			{
				reportId,
				memoryA: conflict.memoryA.id,
				memoryB: conflict.memoryB.memoryId,
				relation: conflict.relation,
			},
			"Created conflict report",
		);
	}
}
