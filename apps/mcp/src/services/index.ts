export { CloudEntityRepository } from "./cloud-entity-repository";
export { EngramCloudClient, type EngramCloudClientOptions } from "./cloud";
export {
	type AuditContext,
	ConflictAuditService,
	type LogConflictDecisionParams,
} from "./conflict-audit";
export {
	type ConflictCandidate,
	type ConflictDetectionResult,
	ConflictRelation,
} from "./conflict-detector";
export {
	EntityEmbeddingService,
	type EntityInput,
} from "./entity-embedding";
export {
	type EntityExtractionResult,
	EntityExtractorService,
	EntityType,
	type ExtractedEntity,
	type ExtractedRelationship,
	RelationshipType,
} from "./entity-extractor";
export {
	type EntityResolutionResult,
	type EntityResolverConfig,
	EntityResolverService,
} from "./entity-resolver";
export {
	type GraphExpandedResult,
	type GraphExpansionOptions,
	GraphExpansionService,
} from "./graph-expansion";
export type {
	ContextItem,
	CreateMemoryInput,
	IEngramClient,
	IGraphClient,
	IMemoryRetriever,
	IMemoryStore,
	RecallFilters,
	RecallResult,
	RerankTier,
} from "./interfaces";
