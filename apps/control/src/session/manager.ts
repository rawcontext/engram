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

export class SessionManager {
	private sessions = new Map<string, DecisionEngine>();
	private initializer: SessionInitializer;
	private contextAssembler: ContextAssembler;
	private mcpAdapter: MultiMcpAdapter;
	private logger: Logger;

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
		} else {
			// Legacy constructor: (contextAssembler, mcpAdapter, falkor)
			this.contextAssembler = depsOrAssembler as ContextAssembler;
			this.mcpAdapter = mcpAdapterArg!;
			this.initializer = new SessionInitializer(falkorArg!);
			this.logger = createNodeLogger({
				service: "control-service",
				base: { component: "session-manager" },
			});
		}
	}

	async handleInput(sessionId: string, input: string) {
		// 1. Ensure Session Exists in Graph
		await this.initializer.ensureSession(sessionId);

		// 2. Get or Create Engine (Actor)
		let engine = this.sessions.get(sessionId);
		if (!engine) {
			this.logger.info({ sessionId }, "Spawning new DecisionEngine");
			engine = new DecisionEngine(this.contextAssembler, this.mcpAdapter);
			engine.start();
			this.sessions.set(sessionId, engine);
		}

		// 3. Dispatch Input
		// Note: DecisionEngine.handleInput takes sessionId again, which is fine
		await engine.handleInput(sessionId, input);
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
