/**
 * Secure Session Store
 *
 * Manages MCP sessions with security features:
 * - Session IDs bound to user identity
 * - Session ownership validation
 * - Automatic session expiration
 * - Per-user session limits
 *
 * @see https://modelcontextprotocol.io/specification/draft/basic/security_best_practices
 */

import type { Logger } from "@engram/logger";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * Session record with security metadata
 */
export interface SessionRecord {
	/** The MCP transport for this session */
	transport: StreamableHTTPServerTransport;
	/** User ID that owns this session */
	userId: string;
	/** OAuth client ID that created this session */
	clientId: string;
	/** Scopes granted to this session */
	scopes: string[];
	/** Organization ID (ULID) for tenant isolation */
	orgId?: string;
	/** Organization slug for graph naming */
	orgSlug?: string;
	/** When the session was created (Unix epoch ms) */
	createdAt: number;
	/** When the session was last accessed (Unix epoch ms) */
	lastAccessAt: number;
}

export interface SessionStoreOptions {
	/** Logger instance */
	logger: Logger;
	/** Session TTL in milliseconds (default: 3600000 = 1 hour) */
	sessionTtlMs?: number;
	/** Maximum sessions per user (default: 10) */
	maxSessionsPerUser?: number;
	/** Cleanup interval in milliseconds (default: 60000 = 1 minute) */
	cleanupIntervalMs?: number;
}

/**
 * Secure session store for MCP HTTP transport
 *
 * Security features:
 * 1. Session IDs are formatted as `userId:uuid` to bind to user identity
 * 2. Validates session ownership on each access
 * 3. Automatically expires inactive sessions
 * 4. Limits sessions per user to prevent resource exhaustion
 */
export class SessionStore {
	private readonly sessions: Map<string, SessionRecord> = new Map();
	private readonly userSessions: Map<string, Set<string>> = new Map();
	private readonly logger: Logger;
	private readonly sessionTtlMs: number;
	private readonly maxSessionsPerUser: number;
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(options: SessionStoreOptions) {
		this.logger = options.logger;
		this.sessionTtlMs = options.sessionTtlMs ?? 3600000; // 1 hour default
		this.maxSessionsPerUser = options.maxSessionsPerUser ?? 10;

		// Start cleanup timer
		const cleanupIntervalMs = options.cleanupIntervalMs ?? 60000; // 1 minute
		this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
	}

	/**
	 * Store a new session
	 */
	set(sessionId: string, record: SessionRecord): void {
		const { userId } = record;

		// Check session limit for this user
		const userSessionIds = this.userSessions.get(userId) ?? new Set();
		if (userSessionIds.size >= this.maxSessionsPerUser) {
			// Remove oldest session for this user
			const oldestSessionId = this.findOldestSession(userSessionIds);
			if (oldestSessionId) {
				this.logger.info(
					{ sessionId: oldestSessionId, userId },
					"Evicting oldest session due to limit",
				);
				this.delete(oldestSessionId);
			}
		}

		// Store the session
		this.sessions.set(sessionId, record);

		// Track session by user
		let userSessionSet = this.userSessions.get(userId);
		if (!userSessionSet) {
			userSessionSet = new Set();
			this.userSessions.set(userId, userSessionSet);
		}
		userSessionSet.add(sessionId);

		this.logger.debug(
			{
				sessionId,
				userId,
				clientId: record.clientId,
				userSessionCount: this.userSessions.get(userId)?.size,
			},
			"Session stored",
		);
	}

	/**
	 * Get a session by ID
	 */
	get(sessionId: string): SessionRecord | undefined {
		const session = this.sessions.get(sessionId);

		if (!session) {
			return undefined;
		}

		// Check if session has expired
		if (this.isExpired(session)) {
			this.logger.debug({ sessionId }, "Session expired");
			this.delete(sessionId);
			return undefined;
		}

		return session;
	}

	/**
	 * Update the last access time for a session
	 */
	touch(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.lastAccessAt = Date.now();
		}
	}

	/**
	 * Delete a session
	 */
	delete(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}

		// Close the transport
		try {
			session.transport.close();
		} catch (error) {
			this.logger.warn({ error, sessionId }, "Error closing transport");
		}

		// Remove from user tracking
		const userSessionIds = this.userSessions.get(session.userId);
		if (userSessionIds) {
			userSessionIds.delete(sessionId);
			if (userSessionIds.size === 0) {
				this.userSessions.delete(session.userId);
			}
		}

		// Remove from sessions map
		this.sessions.delete(sessionId);

		this.logger.debug({ sessionId, userId: session.userId }, "Session deleted");

		return true;
	}

	/**
	 * Validate that a session belongs to a specific user
	 *
	 * This prevents session hijacking by ensuring the authenticated user
	 * matches the session owner.
	 */
	validateOwner(sessionId: string, userId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}

		// Session ID format: userId:uuid
		const [sessionUserId] = sessionId.split(":");

		// Both the session ID prefix and record must match
		return sessionUserId === userId && session.userId === userId;
	}

	/**
	 * Get all sessions for a user
	 */
	getSessionsForUser(userId: string): Map<string, SessionRecord> {
		const userSessionIds = this.userSessions.get(userId);
		if (!userSessionIds) {
			return new Map();
		}

		const result = new Map<string, SessionRecord>();
		for (const sessionId of userSessionIds) {
			const session = this.sessions.get(sessionId);
			if (session && !this.isExpired(session)) {
				result.set(sessionId, session);
			}
		}

		return result;
	}

	/**
	 * Close all sessions for a user (e.g., on logout or token revocation)
	 */
	closeSessionsForUser(userId: string): number {
		const userSessionIds = this.userSessions.get(userId);
		if (!userSessionIds) {
			return 0;
		}

		const sessionIds = [...userSessionIds];
		for (const sessionId of sessionIds) {
			this.delete(sessionId);
		}

		this.logger.info({ userId, count: sessionIds.length }, "Closed all sessions for user");

		return sessionIds.length;
	}

	/**
	 * Get all sessions (for iteration)
	 */
	entries(): IterableIterator<[string, SessionRecord]> {
		return this.sessions.entries();
	}

	/**
	 * Get total session count
	 */
	get size(): number {
		return this.sessions.size;
	}

	/**
	 * Stop the cleanup timer and close all sessions
	 */
	shutdown(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}

		// Close all sessions
		for (const [sessionId] of this.sessions) {
			this.delete(sessionId);
		}

		this.logger.info("Session store shutdown complete");
	}

	/**
	 * Check if a session has expired
	 */
	private isExpired(session: SessionRecord): boolean {
		return Date.now() - session.lastAccessAt > this.sessionTtlMs;
	}

	/**
	 * Find the oldest session in a set
	 */
	private findOldestSession(sessionIds: Set<string>): string | null {
		let oldest: { id: string; lastAccessAt: number } | null = null;

		for (const sessionId of sessionIds) {
			const session = this.sessions.get(sessionId);
			if (session) {
				if (!oldest || session.lastAccessAt < oldest.lastAccessAt) {
					oldest = { id: sessionId, lastAccessAt: session.lastAccessAt };
				}
			}
		}

		return oldest?.id ?? null;
	}

	/**
	 * Clean up expired sessions
	 */
	private cleanup(): void {
		const now = Date.now();
		let expiredCount = 0;

		for (const [sessionId, session] of this.sessions) {
			if (now - session.lastAccessAt > this.sessionTtlMs) {
				this.delete(sessionId);
				expiredCount++;
			}
		}

		if (expiredCount > 0) {
			this.logger.debug(
				{ expiredCount, remaining: this.sessions.size },
				"Session cleanup completed",
			);
		}
	}
}

/**
 * Create a session store
 */
export function createSessionStore(options: SessionStoreOptions): SessionStore {
	return new SessionStore(options);
}

/**
 * Generate a secure session ID bound to a user
 *
 * Format: userId:uuid
 * This binds the session to the user's identity, preventing session hijacking.
 */
export function generateSecureSessionId(userId: string): string {
	return `${userId}:${crypto.randomUUID()}`;
}
