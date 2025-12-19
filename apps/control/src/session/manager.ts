import { createNodeLogger, type Logger } from "@engram/logger";
import { createFalkorClient, type FalkorClient, type GraphClient } from "@engram/storage";
import type { ContextAssembler } from "../context/assembler";
import { createContextAssembler } from "../context/assembler";
import { DecisionEngine } from "../engine/decision";
import type { MultiMcpAdapter } from "../tools/mcp_client";
import { createSessionInitializer, SessionInitializer } from "./initializer";

/**
 * Dependencies for SessionManager construction.
 * Supports dependency injection for testability.
 */
export interface SessionManagerDeps {
	/** Context assembler for building agent context. */
	contextAssembler?: ContextAssembler;
	/** MCP adapter for tool access. Required for production use. */
	mcpAdapter: MultiMcpAdapter;
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
	private mcpAdapter: MultiMcpAdapter;
	private logger: Logger;
	private cleanupInterval: NodeJS.Timeout | null = null;

	/**
	 * Create a SessionManager with injectable dependencies.
	 * @param deps - Dependencies including required mcpAdapter.
	 */
	constructor(deps: SessionManagerDeps);
	/** @deprecated Use SessionManagerDeps object instead */
	constructor(
		contextAssembler: ContextAssembler,
		mcpAdapter: MultiMcpAdapter,
		falkor: FalkorClient,
	);
	constructor(
		depsOrAssembler: SessionManagerDeps | ContextAssembler,
		mcpAdapterArg?: MultiMcpAdapter,
		falkorArg?: FalkorClient,
	) {
		if ("mcpAdapter" in depsOrAssembler && mcpAdapterArg === undefined) {
			// New deps object constructor
			const deps = depsOrAssembler as SessionManagerDeps;
			const graphClient = deps.graphClient ?? createFalkorClient();
			this.contextAssembler = deps.contextAssembler ?? createContextAssembler({ graphClient });
			this.mcpAdapter = deps.mcpAdapter;
			this.initializer = deps.sessionInitializer ?? createSessionInitializer({ graphClient });
			this.logger =
				deps.logger ??
				createNodeLogger({
					service: "control-service",
					base: { component: "session-manager" },
				});

			// Start periodic cleanup for stale sessions
			this.startCleanupJob();
		} else {
			// Legacy constructor: (contextAssembler, mcpAdapter, falkor)
			this.contextAssembler = depsOrAssembler as ContextAssembler;
			if (!mcpAdapterArg) throw new Error("mcpAdapter required for legacy constructor");
			if (!falkorArg) throw new Error("falkor required for legacy constructor");
			this.mcpAdapter = mcpAdapterArg;
			this.initializer = new SessionInitializer(falkorArg);
			this.logger = createNodeLogger({
				service: "control-service",
				base: { component: "session-manager" },
			});
		}

		// Start periodic cleanup for stale sessions
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
			const engine = new DecisionEngine(this.contextAssembler, this.mcpAdapter);
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
 * Supports dependency injection for testability.
 *
 * @example
 * // Production usage
 * const manager = createSessionManager({
 *   mcpAdapter: multiAdapter,
 * });
 *
 * @example
 * // Test usage (inject mocks)
 * const manager = createSessionManager({
 *   mcpAdapter: mockMcpAdapter,
 *   graphClient: mockGraphClient,
 *   contextAssembler: mockContextAssembler,
 * });
 */
export function createSessionManager(deps: SessionManagerDeps): SessionManager {
	return new SessionManager(deps);
}
