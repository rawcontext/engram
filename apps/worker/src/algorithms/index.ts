/**
 * Graph algorithms for community detection, analysis, and conflict scanning
 */

export {
	type ConflictClassification,
	ConflictScanner,
	type ConflictScannerOptions,
	type ConflictScanResult,
	type MemoryCandidate,
	type VectorCandidate,
} from "./conflict-scanner";
export {
	type Communities,
	type Graph,
	getCommunityForNode,
	graphFromEdges,
	type LabelPropagationOptions,
	labelPropagation,
	mergeCommunities,
} from "./label-propagation";
