import type { ParsedStreamEvent } from "@engram/events";
import { ContentEventHandler } from "./content.handler";
import { ControlEventHandler } from "./control.handler";
import { DiffEventHandler } from "./diff.handler";
import type { EventHandler } from "./handler.interface";
import { ThoughtEventHandler } from "./thought.handler";
import { ToolCallEventHandler } from "./tool-call.handler";
import { UsageEventHandler } from "./usage.handler";

/**
 * EventHandlerRegistry manages event handlers using the Strategy pattern.
 * Handlers are evaluated in registration order to determine which can
 * process a given event.
 */
export class EventHandlerRegistry {
	private handlers: EventHandler[] = [];

	/**
	 * Register a handler with the registry.
	 * Handlers are evaluated in registration order.
	 *
	 * @param handler - The event handler to register
	 */
	register(handler: EventHandler): void {
		this.handlers.push(handler);
	}

	/**
	 * Find the first handler that can process the given event.
	 *
	 * @param event - The event to find a handler for
	 * @returns The first matching handler, or undefined if none match
	 */
	getHandler(event: ParsedStreamEvent): EventHandler | undefined {
		return this.handlers.find((h) => h.canHandle(event));
	}

	/**
	 * Find all handlers that can process the given event.
	 * Useful when multiple handlers should process the same event.
	 *
	 * @param event - The event to find handlers for
	 * @returns Array of matching handlers
	 */
	getHandlers(event: ParsedStreamEvent): EventHandler[] {
		return this.handlers.filter((h) => h.canHandle(event));
	}

	/**
	 * Get the count of registered handlers.
	 */
	get handlerCount(): number {
		return this.handlers.length;
	}

	/**
	 * Get the event types covered by registered handlers.
	 */
	get eventTypes(): string[] {
		return [...new Set(this.handlers.map((h) => h.eventType))];
	}
}

/**
 * Create a registry with all default event handlers pre-registered.
 * Registration order determines evaluation priority.
 *
 * @returns A fully configured EventHandlerRegistry
 */
export function createDefaultHandlerRegistry(): EventHandlerRegistry {
	const registry = new EventHandlerRegistry();

	// Register handlers in evaluation priority order
	// Content first as it's the most common event type
	registry.register(new ContentEventHandler());
	registry.register(new ThoughtEventHandler());
	registry.register(new ToolCallEventHandler());
	registry.register(new DiffEventHandler());
	registry.register(new UsageEventHandler());
	registry.register(new ControlEventHandler());

	return registry;
}
