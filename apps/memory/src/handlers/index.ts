/**
 * Event Handlers Module
 *
 * This module implements the Strategy pattern for event handling in the
 * memory service. Each event type has a dedicated handler that encapsulates
 * the logic for processing that event type and updating the graph.
 *
 * Architecture:
 * - EventHandler: Interface defining the handler contract
 * - EventHandlerRegistry: Manages handler registration and lookup
 * - Individual handlers: ContentEventHandler, ThoughtEventHandler, etc.
 *
 * Usage:
 * ```typescript
 * import { createDefaultHandlerRegistry, HandlerContext } from './handlers';
 *
 * const registry = createDefaultHandlerRegistry();
 * const handlers = registry.getHandlers(event);
 *
 * for (const handler of handlers) {
 *   await handler.handle(event, turnState, context);
 * }
 * ```
 */

// Individual handlers (for custom registration or testing)
export { ContentEventHandler } from "./content.handler";
export { ControlEventHandler } from "./control.handler";
export { DiffEventHandler } from "./diff.handler";
// Core interfaces
export type {
	EventHandler,
	HandlerContext,
	HandlerResult,
	ReasoningState,
	ToolCallState,
	TurnFinalizedPayload,
	TurnState,
} from "./handler.interface";
// Registry
export { createDefaultHandlerRegistry, EventHandlerRegistry } from "./registry";
export { ThoughtEventHandler } from "./thought.handler";
export { ToolCallEventHandler } from "./tool-call.handler";
export { UsageEventHandler } from "./usage.handler";
