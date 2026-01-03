/**
 * CommunityDetector Job Handler
 *
 * Detects communities in the entity graph using label propagation algorithm.
 * Subscribes to engram.jobs.community-detection NATS subject.
 *
 * Flow:
 * 1. Load entity graph from FalkorDB for project/org
 *    Query: MATCH (e:Entity)-[r:RELATED_TO|DEPENDS_ON]->(e2:Entity) WHERE e.tt_end = MAX_DATE
 * 2. Build adjacency list for label propagation
 * 3. Run LPA algorithm
 * 4. For each community with 3+ members:
 *    - Check for existing community by member overlap (>50% = same community)
 *    - Create new or update existing Community node
 *    - Create MEMBER_OF edges for entity members
 * 5. Publish summarization jobs for updated communities
 *
 * Performance:
 * - Designed for 10K entities with ~100K edges
 * - Uses efficient graph traversal with FalkorDB
 * - Batched community updates to minimize transactions
 */

import type { FalkorCommunityRepository } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { FalkorClient, QueryParams } from "@engram/storage";
import { type Graph, labelPropagation } from "../algorithms/label-propagation";
import { BaseJobConsumer } from "./base";

// =============================================================================
// Constants
// =============================================================================

/** MAX_DATE for bitemporal queries (year 9999) */
const MAX_DATE = 253402300799999;

/** Minimum community size to persist */
const MIN_COMMUNITY_SIZE = 3;

/** Overlap threshold for matching existing communities (50%) */
const OVERLAP_THRESHOLD = 0.5;

// =============================================================================
// Types
// =============================================================================

/**
 * Job message schema for community detection jobs.
 */
export interface CommunityDetectionJob {
	/** Project identifier for filtering entities */
	project: string;

	/** Organization ID for tenant isolation */
	orgId: string;

	/** Trigger source: cron schedule, threshold trigger, or manual request */
	triggeredBy: "cron" | "threshold" | "manual";
}

/**
 * Entity edge record from FalkorDB graph query.
 */
interface EntityEdgeRecord {
	fromId: string;
	toId: string;
	type: string;
}

/**
 * Summary of a detected community.
 */
interface DetectedCommunity {
	label: string;
	memberIds: string[];
	size: number;
}

/**
 * Result of community detection run.
 */
interface DetectionResult {
	communitiesDetected: number;
	communitiesCreated: number;
	communitiesUpdated: number;
	entitiesProcessed: number;
	edgesProcessed: number;
	durationMs: number;
}

// =============================================================================
// CommunityDetector Job Consumer
// =============================================================================

/**
 * Job consumer for community detection using label propagation.
 *
 * Loads the entity graph, runs LPA, and persists detected communities
 * with MEMBER_OF edges to FalkorDB.
 *
 * @example
 * ```typescript
 * import { createNodeLogger } from "@engram/logger";
 * import { FalkorClient } from "@engram/storage";
 * import { FalkorCommunityRepository } from "@engram/graph";
 *
 * const logger = createNodeLogger({ service: "worker" });
 * const falkor = new FalkorClient(process.env.FALKOR_URL);
 * await falkor.connect();
 *
 * const communityRepo = new FalkorCommunityRepository(falkor, logger);
 * const consumer = new CommunityDetectorConsumer(logger, falkor, communityRepo);
 * await consumer.subscribe();
 * ```
 */
export class CommunityDetectorConsumer extends BaseJobConsumer<CommunityDetectionJob> {
	readonly subject = "engram.jobs.community-detection";
	readonly consumerName = "community-detector-worker";

	private falkor: FalkorClient;
	private communityRepo: FalkorCommunityRepository;

	constructor(
		logger: Logger,
		falkor: FalkorClient,
		communityRepo: FalkorCommunityRepository,
		natsUrl?: string,
	) {
		super(logger, natsUrl);
		this.falkor = falkor;
		this.communityRepo = communityRepo;
	}

	/**
	 * Process a community detection job.
	 *
	 * @param job - The community detection job parameters
	 */
	async process(job: CommunityDetectionJob): Promise<void> {
		const startTime = Date.now();

		this.logger.info(
			{
				project: job.project,
				orgId: job.orgId,
				triggeredBy: job.triggeredBy,
			},
			"Starting community detection job",
		);

		// Step 1: Load entity graph
		const edges = await this.loadEntityGraph(job.project);

		if (edges.length === 0) {
			this.logger.info({ project: job.project }, "No entity edges found, skipping detection");
			return;
		}

		// Step 2: Build adjacency list for LPA
		const graph = this.buildGraph(edges);

		this.logger.info(
			{
				nodeCount: graph.nodes.size,
				edgeCount: edges.length,
			},
			"Built entity graph for community detection",
		);

		// Step 3: Run label propagation
		const communities = labelPropagation(graph, {
			minCommunitySize: MIN_COMMUNITY_SIZE,
		});

		const detectedCommunities: DetectedCommunity[] = Object.entries(communities).map(
			([label, memberIds]) => ({
				label,
				memberIds,
				size: memberIds.length,
			}),
		);

		this.logger.info({ communityCount: detectedCommunities.length }, "Label propagation completed");

		// Step 4: Persist communities
		let created = 0;
		let updated = 0;

		for (const detected of detectedCommunities) {
			const result = await this.persistCommunity(detected, job.project, job.orgId);
			if (result === "created") {
				created++;
			} else {
				updated++;
			}
		}

		// Log summary
		const result: DetectionResult = {
			communitiesDetected: detectedCommunities.length,
			communitiesCreated: created,
			communitiesUpdated: updated,
			entitiesProcessed: graph.nodes.size,
			edgesProcessed: edges.length,
			durationMs: Date.now() - startTime,
		};

		this.logger.info(
			{
				...result,
				project: job.project,
				orgId: job.orgId,
			},
			"Community detection job completed",
		);
	}

	/**
	 * Load entity relationships from FalkorDB.
	 *
	 * @param project - Project filter for entities
	 * @returns Array of entity edge records
	 */
	private async loadEntityGraph(project: string): Promise<EntityEdgeRecord[]> {
		const cypher = `
			MATCH (e:Entity)-[r:RELATED_TO|DEPENDS_ON|IMPLEMENTS|PART_OF]->(e2:Entity)
			WHERE e.tt_end = $maxDate
				AND e2.tt_end = $maxDate
				AND e.project = $project
			RETURN e.id AS fromId, e2.id AS toId, type(r) AS type
		`;

		const params: QueryParams = {
			maxDate: MAX_DATE,
			project,
		};

		return this.falkor.query<EntityEdgeRecord>(cypher, params);
	}

	/**
	 * Build adjacency list graph from edge records.
	 *
	 * @param edges - Edge records from FalkorDB
	 * @returns Graph structure for LPA
	 */
	private buildGraph(edges: EntityEdgeRecord[]): Graph {
		const nodes = new Map<string, Set<string>>();

		for (const edge of edges) {
			// Add fromId -> toId
			if (!nodes.has(edge.fromId)) {
				nodes.set(edge.fromId, new Set());
			}
			nodes.get(edge.fromId)?.add(edge.toId);

			// Add toId -> fromId (undirected graph for community detection)
			if (!nodes.has(edge.toId)) {
				nodes.set(edge.toId, new Set());
			}
			nodes.get(edge.toId)?.add(edge.fromId);
		}

		return { nodes };
	}

	/**
	 * Persist a detected community to FalkorDB.
	 *
	 * Checks for existing communities with >50% member overlap.
	 * Updates existing community or creates new one.
	 *
	 * @param detected - The detected community
	 * @param project - Project identifier
	 * @param orgId - Organization ID
	 * @returns "created" or "updated"
	 */
	private async persistCommunity(
		detected: DetectedCommunity,
		project: string,
		orgId: string,
	): Promise<"created" | "updated"> {
		// Check for existing community with member overlap
		const overlaps = await this.communityRepo.findExistingByMemberOverlap(
			detected.memberIds,
			Math.floor(detected.size * OVERLAP_THRESHOLD),
		);

		if (overlaps.length > 0) {
			// Found existing community - update it
			const existing = overlaps[0];
			const overlapRatio = existing.overlapCount / detected.size;

			if (overlapRatio >= OVERLAP_THRESHOLD) {
				// Update existing community
				await this.communityRepo.update(existing.community.id, {
					memberCount: detected.size,
					keywords: [], // Will be filled by summarizer
				});

				// Update MEMBER_OF edges
				await this.updateMemberEdges(existing.community.id, detected.memberIds);

				this.logger.debug(
					{
						communityId: existing.community.id,
						memberCount: detected.size,
						overlapRatio,
					},
					"Updated existing community",
				);

				// Publish summarization job for updated community
				await this.publishSummarizationJob(existing.community.id, project, orgId);

				return "updated";
			}
		}

		// Create new community
		const community = await this.communityRepo.create({
			name: `Community ${detected.label.slice(0, 8)}`,
			summary: "", // Will be filled by summarizer
			keywords: [],
			memberCount: detected.size,
			memoryCount: 0,
			project,
			orgId,
		});

		// Create MEMBER_OF edges
		await this.createMemberEdges(community.id, detected.memberIds);

		this.logger.debug(
			{
				communityId: community.id,
				memberCount: detected.size,
			},
			"Created new community",
		);

		// Publish summarization job for new community
		await this.publishSummarizationJob(community.id, project, orgId);

		return "created";
	}

	/**
	 * Create MEMBER_OF edges between entities and a community.
	 *
	 * @param communityId - The community ID
	 * @param memberIds - Array of entity IDs
	 */
	private async createMemberEdges(communityId: string, memberIds: string[]): Promise<void> {
		const now = Date.now();

		const cypher = `
			UNWIND $memberIds AS entityId
			MATCH (e:Entity {id: entityId}), (c:Community {id: $communityId})
			WHERE e.tt_end = $maxDate AND c.tt_end = $maxDate
			CREATE (e)-[:MEMBER_OF {
				vt_start: $now,
				vt_end: $maxDate,
				tt_start: $now,
				tt_end: $maxDate
			}]->(c)
		`;

		await this.falkor.query(cypher, {
			memberIds,
			communityId,
			maxDate: MAX_DATE,
			now,
		});
	}

	/**
	 * Update MEMBER_OF edges for an existing community.
	 *
	 * Removes stale edges and creates new ones for current members.
	 *
	 * @param communityId - The community ID
	 * @param memberIds - Current member entity IDs
	 */
	private async updateMemberEdges(communityId: string, memberIds: string[]): Promise<void> {
		const now = Date.now();

		// Close existing MEMBER_OF edges
		const closeEdgesCypher = `
			MATCH (e:Entity)-[r:MEMBER_OF]->(c:Community {id: $communityId})
			WHERE r.tt_end = $maxDate
			SET r.tt_end = $now
		`;

		await this.falkor.query(closeEdgesCypher, {
			communityId,
			maxDate: MAX_DATE,
			now,
		});

		// Create new edges
		await this.createMemberEdges(communityId, memberIds);
	}

	/**
	 * Publish a summarization job for a community.
	 *
	 * The summarizer will generate name, summary, and keywords for the community.
	 *
	 * @param communityId - The community to summarize
	 * @param project - Project identifier
	 * @param orgId - Organization ID
	 */
	private async publishSummarizationJob(
		communityId: string,
		project: string,
		orgId: string,
	): Promise<void> {
		const summarizationSubject = "engram.jobs.summarization";

		await this.publishJob(summarizationSubject, {
			communityId,
			project,
			orgId,
		});

		this.logger.debug(
			{
				communityId,
				project,
				orgId,
				targetSubject: summarizationSubject,
			},
			"Published summarization job",
		);
	}
}
