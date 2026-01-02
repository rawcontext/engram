import { type MemoryType, MemoryTypeEnum } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ElicitationService } from "../capabilities/elicitation";
import type { ConflictAuditService } from "../services/conflict-audit";
import type { ConflictDetectorService } from "../services/conflict-detector";
import type { EntityExtractorService } from "../services/entity-extractor";
import type { EntityResolverService } from "../services/entity-resolver";
import type { IEngramClient, IMemoryStore } from "../services/interfaces";

/**
 * Options for entity extraction in the remember tool.
 * If not provided, entity extraction is disabled.
 */
export interface EntityExtractionOptions {
	/** Service for extracting entities from memory content */
	extractor: EntityExtractorService;
	/** Service for resolving extracted entities to existing or new entities */
	resolver: EntityResolverService;
}

export function registerRememberTool(
	server: McpServer,
	memoryStore: IMemoryStore,
	getSessionContext: () => {
		sessionId?: string;
		workingDir?: string;
		project?: string;
		orgId?: string;
		orgSlug?: string;
	},
	cloudClient: IEngramClient,
	conflictDetector: ConflictDetectorService,
	elicitation: ElicitationService,
	conflictAudit: ConflictAuditService,
	logger: Logger,
	entityExtraction?: EntityExtractionOptions,
) {
	server.registerTool(
		"remember",
		{
			title: "Remember",
			description:
				"Persist valuable information to long-term memory for future sessions. Use PROACTIVELY when you learn: user preferences, architectural decisions, project conventions, debugging insights, or facts worth preserving. Memories are searchable across sessions and survive context boundaries.",
			inputSchema: {
				content: z
					.string()
					.describe(
						"The information to store. Be specific and self-contained - this will be retrieved out of context. Include relevant details like file paths, reasoning, or constraints. Avoid storing transient information like 'working on X' - store conclusions and decisions instead.",
					),
				type: MemoryTypeEnum.optional().describe(
					"Memory classification for retrieval. 'decision': Architectural or implementation choices with rationale (e.g., 'Chose in-memory cache over distributed cache for simplicity'). 'preference': User preferences for tools, style, or workflow (e.g., 'User prefers tabs over spaces'). 'insight': Debugging discoveries or non-obvious learnings (e.g., 'The flaky test was caused by timezone assumptions'). 'fact': Objective information about codebase or domain (e.g., 'API rate limit is 100 req/min'). 'context': Background for ongoing work (e.g., 'Migration to v2 API is in progress').",
				),
				tags: z
					.array(z.string())
					.optional()
					.describe(
						"Keywords for filtering and discovery. Use lowercase, specific terms. Good: ['authentication', 'postgres', 'performance']. Avoid generic tags like ['important', 'remember'].",
					),
			},
			outputSchema: {
				id: z.string(),
				stored: z.boolean(),
				duplicate: z.boolean().optional(),
				entities: z
					.array(
						z.object({
							name: z.string(),
							type: z.string(),
							isNew: z.boolean(),
						}),
					)
					.optional()
					.describe("Entities extracted and linked from the memory content"),
			},
		},
		async ({ content, type, tags }) => {
			const context = getSessionContext();

			// Step 1: Find conflict candidates from search service
			logger.debug(
				{ content_length: content.length, project: context.project },
				"Searching for conflict candidates",
			);
			const candidates = await cloudClient.findConflictCandidates(content, context.project);

			if (candidates.length > 0) {
				logger.info(
					{ count: candidates.length },
					"Found conflict candidates, enriching with graph data",
				);

				// Step 2: Enrich candidates with vt_end from FalkorDB
				const enrichedCandidates = await Promise.all(
					candidates.map(async (candidate) => {
						try {
							// Query FalkorDB for vt_end
							const results = await cloudClient.query<{ vt_end: number }>(
								"MATCH (m:Memory {id: $id}) WHERE m.tt_end > timestamp() RETURN m.vt_end as vt_end",
								{ id: candidate.id },
								context.orgId && context.orgSlug
									? { orgId: context.orgId, orgSlug: context.orgSlug }
									: undefined,
							);

							const vt_end = results[0]?.vt_end ?? Number.MAX_SAFE_INTEGER;

							return {
								memoryId: candidate.id,
								content: candidate.content,
								type: candidate.type,
								vt_start: candidate.vt_start,
								vt_end,
								similarity: candidate.score,
							};
						} catch (error) {
							logger.warn(
								{ error, candidateId: candidate.id },
								"Failed to enrich candidate, using default vt_end",
							);
							return {
								memoryId: candidate.id,
								content: candidate.content,
								type: candidate.type,
								vt_start: candidate.vt_start,
								vt_end: Number.MAX_SAFE_INTEGER,
								similarity: candidate.score,
							};
						}
					}),
				);

				// Step 3: Detect conflicts using ConflictDetectorService
				logger.debug({ count: enrichedCandidates.length }, "Running conflict detection");
				const conflicts = await conflictDetector.detectConflicts(
					{ content, type: type ?? "context" },
					enrichedCandidates,
				);

				// Step 4: Process conflicts
				// Track memories to invalidate (pending user confirmation if elicitation available)
				const memoriesToInvalidate: string[] = [];

				// Common audit params for all conflicts
				const newMemoryForAudit = { content, type: type ?? "context" };

				for (const conflict of conflicts) {
					logger.info(
						{
							candidateId: conflict.candidate.memoryId,
							relation: conflict.relation,
							confidence: conflict.confidence,
							action: conflict.suggestedAction,
						},
						"Conflict detected",
					);

					const conflictingMemoryForAudit = {
						id: conflict.candidate.memoryId,
						content: conflict.candidate.content,
						type: conflict.candidate.type,
					};

					// Handle SUPERSEDES and CONTRADICTION by invalidating old memory
					if (
						conflict.suggestedAction === "invalidate_old" &&
						(conflict.relation === "supersedes" || conflict.relation === "contradiction")
					) {
						// If elicitation is available, ask user for confirmation
						if (elicitation.enabled) {
							const message = conflictDetector.formatConflictMessage(conflict);
							const result = await elicitation.confirm(message, {
								title: "Confirm Memory Update",
								confirmLabel: "Update and Invalidate Old",
								cancelLabel: "Create Without Invalidating",
							});

							if (result.accepted && result.content?.confirmed) {
								logger.info(
									{ oldMemoryId: conflict.candidate.memoryId, reason: conflict.relation },
									"User confirmed invalidation",
								);
								memoriesToInvalidate.push(conflict.candidate.memoryId);

								// Audit: User confirmed invalidation
								conflictAudit.logUserConfirmed({
									newMemory: newMemoryForAudit,
									conflictingMemory: conflictingMemoryForAudit,
									relation: conflict.relation,
									confidence: conflict.confidence,
									reasoning: conflict.reasoning,
									suggestedAction: conflict.suggestedAction,
									elicitationAvailable: true,
								});
							} else {
								logger.info(
									{ oldMemoryId: conflict.candidate.memoryId },
									"User declined invalidation, keeping both memories",
								);

								// Audit: User declined invalidation
								conflictAudit.logUserDeclined({
									newMemory: newMemoryForAudit,
									conflictingMemory: conflictingMemoryForAudit,
									relation: conflict.relation,
									confidence: conflict.confidence,
									reasoning: conflict.reasoning,
									suggestedAction: conflict.suggestedAction,
									elicitationAvailable: true,
								});
							}
						} else {
							// No elicitation available - auto-invalidate (original behavior)
							logger.info(
								{ oldMemoryId: conflict.candidate.memoryId, reason: conflict.relation },
								"Auto-invalidating old memory (no elicitation available)",
							);
							memoriesToInvalidate.push(conflict.candidate.memoryId);

							// Audit: Auto-applied invalidation
							conflictAudit.logAutoApplied({
								newMemory: newMemoryForAudit,
								conflictingMemory: conflictingMemoryForAudit,
								relation: conflict.relation,
								confidence: conflict.confidence,
								reasoning: conflict.reasoning,
								suggestedAction: conflict.suggestedAction,
								outcome: "invalidate_old",
							});
						}
					}

					// Handle DUPLICATE by skipping new memory
					if (conflict.suggestedAction === "skip_new" && conflict.relation === "duplicate") {
						logger.info({ duplicateOf: conflict.candidate.memoryId }, "Skipping duplicate memory");

						// Audit: Duplicate detected
						conflictAudit.logDuplicateDetected({
							newMemory: newMemoryForAudit,
							conflictingMemory: conflictingMemoryForAudit,
							relation: conflict.relation,
							confidence: conflict.confidence,
							reasoning: conflict.reasoning,
							elicitationAvailable: elicitation.enabled,
						});

						const output = {
							id: conflict.candidate.memoryId,
							stored: false,
							duplicate: true,
						};

						return {
							content: [
								{
									type: "text" as const,
									text: JSON.stringify(output),
								},
							],
							structuredContent: output,
						};
					}
				}

				// Step 4b: Invalidate confirmed memories before creating new one
				for (const memoryId of memoriesToInvalidate) {
					try {
						await cloudClient.invalidateMemory(
							memoryId,
							context.orgId && context.orgSlug
								? { orgId: context.orgId, orgSlug: context.orgSlug }
								: undefined,
						);
						logger.info({ memoryId }, "Memory invalidated successfully");
					} catch (error) {
						logger.warn({ error, memoryId }, "Failed to invalidate memory");
					}
				}
			}

			// Step 5: Create the memory (API will handle invalidation logic)
			const memory = await memoryStore.createMemory({
				content,
				type: type as MemoryType | undefined,
				tags,
				project: context.project,
				workingDir: context.workingDir,
				sourceSessionId: context.sessionId,
				source: "user",
				tenant:
					context.orgId && context.orgSlug
						? { orgId: context.orgId, orgSlug: context.orgSlug }
						: undefined,
			});

			// Step 6: Extract and link entities (if entity extraction is enabled)
			let extractedEntities: Array<{ name: string; type: string; isNew: boolean }> | undefined;

			if (entityExtraction) {
				try {
					logger.debug({ memoryId: memory.id }, "Starting entity extraction");

					// Extract entities from memory content
					const extractionResult = await entityExtraction.extractor.extract(
						content,
						type ?? "context",
					);

					if (extractionResult.entities.length > 0) {
						logger.info(
							{
								memoryId: memory.id,
								entityCount: extractionResult.entities.length,
								relationshipCount: extractionResult.relationships.length,
								took_ms: extractionResult.took_ms,
								model: extractionResult.model_used,
							},
							"Entities extracted from memory",
						);

						// Resolve entities (match to existing or create new)
						const resolutionResults = await entityExtraction.resolver.resolveBatch(
							extractionResult.entities,
							context.project,
						);

						// Build output and create MENTIONS edges
						extractedEntities = [];

						for (const result of resolutionResults) {
							extractedEntities.push({
								name: result.entity.name,
								type: result.entity.type,
								isNew: result.isNew,
							});

							// Create MENTIONS edge from memory to entity
							// Find the original extracted entity to get context
							const extractedEntity = extractionResult.entities.find(
								(e) =>
									e.name.toLowerCase() === result.entity.name.toLowerCase() ||
									result.entity.aliases.some((a) => a.toLowerCase() === e.name.toLowerCase()),
							);

							try {
								await cloudClient.query(
									`MATCH (m:Memory {id: $memoryId}), (e:Entity {id: $entityId})
									 WHERE m.tt_end > timestamp() AND e.tt_end > timestamp()
									 CREATE (m)-[:MENTIONS {context: $context, vt_start: timestamp(), vt_end: 9223372036854775807, tt_start: timestamp(), tt_end: 9223372036854775807}]->(e)`,
									{
										memoryId: memory.id,
										entityId: result.entity.id,
										context: extractedEntity?.context ?? "",
									},
									context.orgId && context.orgSlug
										? { orgId: context.orgId, orgSlug: context.orgSlug }
										: undefined,
								);
							} catch (edgeError) {
								logger.warn(
									{ error: edgeError, memoryId: memory.id, entityId: result.entity.id },
									"Failed to create MENTIONS edge",
								);
							}
						}

						// Create relationships between entities
						for (const relationship of extractionResult.relationships) {
							const fromResult = resolutionResults.find(
								(r) => r.entity.name.toLowerCase() === relationship.from.toLowerCase(),
							);
							const toResult = resolutionResults.find(
								(r) => r.entity.name.toLowerCase() === relationship.to.toLowerCase(),
							);

							if (fromResult && toResult) {
								try {
									await cloudClient.query(
										`MATCH (e1:Entity {id: $fromId}), (e2:Entity {id: $toId})
										 WHERE e1.tt_end > timestamp() AND e2.tt_end > timestamp()
										 MERGE (e1)-[r:${relationship.type}]->(e2)
										 ON CREATE SET r.vt_start = timestamp(), r.vt_end = 9223372036854775807, r.tt_start = timestamp(), r.tt_end = 9223372036854775807`,
										{
											fromId: fromResult.entity.id,
											toId: toResult.entity.id,
										},
										context.orgId && context.orgSlug
											? { orgId: context.orgId, orgSlug: context.orgSlug }
											: undefined,
									);
								} catch (relError) {
									logger.warn(
										{
											error: relError,
											fromEntity: fromResult.entity.name,
											toEntity: toResult.entity.name,
											relType: relationship.type,
										},
										"Failed to create entity relationship",
									);
								}
							}
						}

						logger.info(
							{
								memoryId: memory.id,
								newEntities: resolutionResults.filter((r) => r.isNew).length,
								matchedEntities: resolutionResults.filter((r) => !r.isNew).length,
							},
							"Entity extraction and linking complete",
						);
					} else {
						logger.debug({ memoryId: memory.id }, "No entities extracted from memory");
					}
				} catch (extractionError) {
					// Entity extraction errors should not fail the remember operation
					logger.warn(
						{ error: extractionError, memoryId: memory.id },
						"Entity extraction failed, memory stored without entities",
					);
				}
			}

			const output = {
				id: memory.id,
				stored: true,
				duplicate: false,
				entities: extractedEntities,
			};

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(output),
					},
				],
				structuredContent: output,
			};
		},
	);
}
