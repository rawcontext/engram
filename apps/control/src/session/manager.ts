import { createNodeLogger, type Logger } from "@engram/logger";
import { createFalkorClient, type GraphClient } from "@engram/storage";
import type { ContextAssembler } from "../context/assembler";
import { createContextAssembler } from "../context/assembler";
import { DecisionEngine, type ToolAdapter } from "../engine/decision";
import { createSessionInitializer, SessionInitializer } from "./initializer";

/**
 * Dependencies for SessionManager construction.
 */
export interface SessionManagerDeps {
	/** Context assembler for building agent context. */
	contextAssembler?: ContextAssembler;
	/** Tool adapter for tool access (ToolRouter). */
	toolAdapter: ToolAdapter;
	/** Graph client for session persistence. Defaults to FalkorClient. */
	graphClient?: GraphClient;
	/** Session initializer. Defaults to new SessionInitializer. */
	sessionInitializer?: SessionInitializer;
	/** Logger instance. Defaults to createNodeLogger. */
	logger?: Logger;
}

// Session engine TTL: 1 hour of inactivity
const SESSION_ENGINE_TTL_MS = 60 * 60 * 1000;

interface SessionEntry {
	engine: DecisionEngine;
	lastAccess: number;
}

export class SessionManager {
	private sessions = new Map<string, SessionEntry>();
	private initializer: SessionInitializer;
	private contextAssembler: ContextAssembler;
	private toolAdapter: ToolAdapter;
	private logger: Logger;
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(deps: SessionManagerDeps) {
		const graphClient = deps.graphClient ?? createFalkorClient();
		this.contextAssembler = deps.contextAssembler ?? createContextAssembler({ graphClient });
		this.toolAdapter = deps.toolAdapter;
		this.initializer = deps.sessionInitializer ?? createSessionInitializer({ graphClient });
		this.logger =
			deps.logger ??
			createNodeLogger({
				service: "control-service",
				base: { component: "session-manager" },
			});

		this.startCleanupJob();
	}

	/**
	 * Start periodic cleanup job to remove stale session engines.
	 */
	private startCleanupJob(): void {
		if (this.cleanupInterval) return;

		this.cleanupInterval = setInterval(
			() => {
				const now = Date.now();
				for (const [sessionId, entry] of this.sessions) {
					if (now - entry.lastAccess > SESSION_ENGINE_TTL_MS) {
						this.logger.info({ sessionId }, "Cleaning up stale session engine");
						entry.engine.stop();
						this.sessions.delete(sessionId);
					}
				}
			},
			5 * 60 * 1000,
		); // Check every 5 minutes
	}

	/**
	 * Stop cleanup job and clear all sessions - call on shutdown.
	 */
	shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		for (const [_sessionId, entry] of this.sessions) {
			entry.engine.stop();
		}
		this.sessions.clear();
	}

	async handleInput(sessionId: string, input: string) {
		// 1. Ensure Session Exists in Graph
		await this.initializer.ensureSession(sessionId);

		// 2. Get or Create Engine (Actor)
		const now = Date.now();
		let entry = this.sessions.get(sessionId);
		if (!entry) {
			this.logger.info({ sessionId }, "Spawning new DecisionEngine");
			const engine = new DecisionEngine({
				contextAssembler: this.contextAssembler,
				toolAdapter: this.toolAdapter,
			});
			engine.start();
			entry = { engine, lastAccess: now };
			this.sessions.set(sessionId, entry);
		} else {
			entry.lastAccess = now; // Update last access time
		}

		// 3. Dispatch Input
		// Note: DecisionEngine.handleInput takes sessionId again, which is fine
		await entry.engine.handleInput(sessionId, input);
	}
}

/**
 * Factory function for creating SessionManager instances.
 *
 * @example
 * const manager = createSessionManager({
 *   toolAdapter: toolRouter,
 * });
 */
export function createSessionManager(deps: SessionManagerDeps): SessionManager {
	return new SessionManager(deps);
}
