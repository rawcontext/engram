/**
 * Claude Code stream-json wrapper for CI/automation scenarios.
 *
 * @module @rawcontext/engram-mcp/stream
 */

export type { RunWithIngestionOptions } from "./cli";
export { cli, parseArgs, runWithIngestion } from "./cli";
export type {
	RawStreamEvent,
	StreamDelta,
	StreamWrapperEvents,
	StreamWrapperOptions,
} from "./types";
export type { ClaudeCodeStreamWrapperOptions } from "./wrapper";
export { ClaudeCodeStreamWrapper } from "./wrapper";
