import { createNodeLogger, type Logger } from "@engram/logger";
import { createFalkorClient, type FalkorClient, type GraphClient } from "@engram/storage";

/**
 * Dependencies for SessionInitializer construction.
 * Supports dependency injection for testability.
 */
export interface SessionInitializerDeps {
	/** Graph client for session persistence. Defaults to FalkorClient. */
	graphClient?: GraphClient;
	/** Logger instance. Defaults to createNodeLogger. */
	logger?: Logger;
}

export class SessionInitializer {
	private graphClient: GraphClient;
	private logger: Logger;

	/**
	 * Create a SessionInitializer with injectable dependencies.
	 * @param deps - Optional dependencies. Defaults are used when not provided.
	 */
	constructor(deps?: SessionInitializerDeps);
	/** @deprecated Use SessionInitializerDeps object instead */
	constructor(falkor: FalkorClient);
	constructor(depsOrFalkor?: SessionInitializerDeps | FalkorClient) {
		if (depsOrFalkor === undefined) {
			// No args: use defaults
			this.graphClient = createFalkorClient();
			this.logger = createNodeLogger({
				service: "control-service",
				base: { component: "session-initializer" },
			});
		} else if ("query" in depsOrFalkor && typeof depsOrFalkor.query === "function") {
			// Legacy constructor: FalkorClient directly
			this.graphClient = depsOrFalkor as GraphClient;
			this.logger = createNodeLogger({
				service: "control-service",
				base: { component: "session-initializer" },
			});
		} else {
			// New deps object constructor
			const deps = depsOrFalkor as SessionInitializerDeps;
			this.graphClient = deps.graphClient ?? createFalkorClient();
			this.logger =
				deps.logger ??
				createNodeLogger({
					service: "control-service",
					base: { component: "session-initializer" },
				});
		}
	}

	/**
	 * Ensures a Session node exists in the graph.
	 * If it doesn't exist, it is created with the current timestamp.
	 */
	async ensureSession(sessionId: string): Promise<void> {
		const checkQuery = `MATCH (s:Session {id: $id}) RETURN s`;
		const result = await this.graphClient.query(checkQuery, { id: sessionId });

		if (Array.isArray(result) && result.length > 0) {
			// Session exists
			return;
		}

		const now = new Date().toISOString();
		const nowMs = Date.now();
		const maxDate = 253402300799000; // Max bitemporal date (year 9999)
		const createQuery = `
      CREATE (s:Session {
        id: $id,
        created_at: $now,
        updated_at: $now,
        status: 'active',
        vt_start: $nowMs,
        vt_end: $maxDate,
        tt_start: $nowMs,
        tt_end: $maxDate
      })
      RETURN s
    `;

		await this.graphClient.query(createQuery, { id: sessionId, now, nowMs, maxDate });
		this.logger.info({ sessionId }, "Created new Session");
	}
}

/**
 * Factory function for creating SessionInitializer instances.
 * Supports dependency injection for testability.
 *
 * @example
 * // Production usage (uses defaults)
 * const initializer = createSessionInitializer();
 *
 * @example
 * // Test usage (inject mocks)
 * const initializer = createSessionInitializer({
 *   graphClient: mockGraphClient,
 *   logger: mockLogger,
 * });
 */
export function createSessionInitializer(deps?: SessionInitializerDeps): SessionInitializer {
	return new SessionInitializer(deps);
}
