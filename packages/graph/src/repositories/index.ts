// =============================================================================
// Repository Interfaces
// =============================================================================

export type { ReasoningRepository } from "./reasoning.repository";
export type { SessionRepository } from "./session.repository";
export type { ToolCallRepository } from "./tool-call.repository";
export type { TurnRepository } from "./turn.repository";

// =============================================================================
// Repository Types (DTOs and Entities)
// =============================================================================

export type {
	// Reasoning types
	CreateReasoningInput,
	// Session types
	CreateSessionInput,
	// ToolCall types
	CreateToolCallInput,
	// Turn types
	CreateTurnInput,
	Reasoning,
	Session,
	ToolCall,
	ToolResult,
	Turn,
	UpdateSessionInput,
	UpdateTurnInput,
} from "./types";

export {
	CreateReasoningInputSchema,
	CreateSessionInputSchema,
	CreateToolCallInputSchema,
	CreateTurnInputSchema,
	ToolResultSchema,
	UpdateSessionInputSchema,
	UpdateTurnInputSchema,
} from "./types";

// =============================================================================
// FalkorDB Implementations
// =============================================================================

export type { TimeTravelOptions } from "./falkor-base";
export { FalkorBaseRepository } from "./falkor-base";
export { FalkorReasoningRepository } from "./falkor-reasoning.repository";
export { FalkorSessionRepository } from "./falkor-session.repository";
export { FalkorToolCallRepository } from "./falkor-tool-call.repository";
export { FalkorTurnRepository } from "./falkor-turn.repository";
