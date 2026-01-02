// =============================================================================
// Repository Interfaces
// =============================================================================

export type { CommunityRepository } from "./community.repository";
export type { EntityRepository } from "./entity.repository";
export type { FileTouchRepository } from "./file-touch.repository";
export type { MemoryRepository } from "./memory.repository";
export type { ReasoningRepository } from "./reasoning.repository";
export type { SessionRepository } from "./session.repository";
export type { ToolCallRepository } from "./tool-call.repository";
export type { TurnRepository } from "./turn.repository";

// =============================================================================
// Repository Types (DTOs and Entities)
// =============================================================================

export type {
	// Community types
	Community,
	CreateCommunityInput,
	// Entity types
	CreateEntityInput,
	// FileTouch types
	CreateFileTouchInput,
	// Memory types
	CreateMemoryInput,
	// Reasoning types
	CreateReasoningInput,
	// Session types
	CreateSessionInput,
	// ToolCall types
	CreateToolCallInput,
	// Turn types
	CreateTurnInput,
	Entity,
	FileTouch,
	Memory,
	Reasoning,
	Session,
	ToolCall,
	ToolResult,
	Turn,
	UpdateCommunityInput,
	UpdateEntityInput,
	UpdateMemoryInput,
	UpdateSessionInput,
	UpdateTurnInput,
} from "./types";

export {
	CreateCommunityInputSchema,
	CreateEntityInputSchema,
	CreateFileTouchInputSchema,
	CreateMemoryInputSchema,
	CreateReasoningInputSchema,
	CreateSessionInputSchema,
	CreateToolCallInputSchema,
	CreateTurnInputSchema,
	ToolResultSchema,
	UpdateCommunityInputSchema,
	UpdateEntityInputSchema,
	UpdateMemoryInputSchema,
	UpdateSessionInputSchema,
	UpdateTurnInputSchema,
} from "./types";

// =============================================================================
// FalkorDB Implementations
// =============================================================================

export type { TimeTravelOptions } from "./falkor-base";
export { FalkorBaseRepository } from "./falkor-base";
export { FalkorCommunityRepository } from "./falkor-community.repository";
export { FalkorEntityRepository } from "./falkor-entity.repository";
export { FalkorFileTouchRepository } from "./falkor-file-touch.repository";
export { FalkorMemoryRepository } from "./falkor-memory.repository";
export { FalkorReasoningRepository } from "./falkor-reasoning.repository";
export { FalkorSessionRepository } from "./falkor-session.repository";
export { FalkorToolCallRepository } from "./falkor-tool-call.repository";
export { FalkorTurnRepository } from "./falkor-turn.repository";
