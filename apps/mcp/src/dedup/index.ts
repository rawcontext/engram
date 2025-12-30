/**
 * Multi-layer deduplication for Claude Code events from multiple sources.
 *
 * @module @rawcontext/engram-mcp/dedup
 */

export type {
	DeduplicationEngineOptions,
	DeduplicationKey,
	EventSource,
} from "./engine";
export {
	computeEventHash,
	DeduplicationEngine,
	fnv1aHash,
} from "./engine";
