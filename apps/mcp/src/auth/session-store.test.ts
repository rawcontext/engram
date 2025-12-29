import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createTestLogger } from "@engram/common/testing";
import {
	createSessionStore,
	generateSecureSessionId,
	type SessionRecord,
	SessionStore,
} from "./session-store";

// Mock transport
function createMockTransport() {
	return {
		close: mock(),
	};
}

function createMockSessionRecord(
	overrides?: Partial<SessionRecord>,
): SessionRecord & { transport: ReturnType<typeof createMockTransport> } {
	return {
		transport: createMockTransport() as any,
		userId: "user-123",
		clientId: "client-123",
		scopes: ["mcp:tools", "mcp:resources"],
		createdAt: Date.now(),
		lastAccessAt: Date.now(),
		...overrides,
	};
}

describe("SessionStore", () => {
	let store: SessionStore;
	let logger: ReturnType<typeof createTestLogger>;

	beforeEach(() => {
		logger = createTestLogger();
		store = new SessionStore({
			logger,
			sessionTtlMs: 1000, // 1 second for faster tests
			maxSessionsPerUser: 3,
			cleanupIntervalMs: 60000, // Don't run cleanup during tests
		});
	});

	afterEach(() => {
		store.shutdown();
	});

	describe("set", () => {
		it("should store a session", () => {
			const sessionId = "user-123:abc-def";
			const record = createMockSessionRecord();

			store.set(sessionId, record);

			const retrieved = store.get(sessionId);
			expect(retrieved).toBeDefined();
			expect(retrieved?.userId).toBe("user-123");
			expect(retrieved?.clientId).toBe("client-123");
		});

		it("should track sessions by user", () => {
			const sessionId1 = "user-123:session-1";
			const sessionId2 = "user-123:session-2";

			store.set(sessionId1, createMockSessionRecord());
			store.set(sessionId2, createMockSessionRecord());

			const userSessions = store.getSessionsForUser("user-123");
			expect(userSessions.size).toBe(2);
			expect(userSessions.has(sessionId1)).toBe(true);
			expect(userSessions.has(sessionId2)).toBe(true);
		});

		it("should evict oldest session when limit reached", () => {
			// Use times within TTL (1000ms) to prevent expiration
			const now = Date.now();
			const oldestRecord = createMockSessionRecord({
				lastAccessAt: now - 500, // 500ms ago - oldest but not expired
			});
			const newerRecord1 = createMockSessionRecord({
				lastAccessAt: now - 300,
			});
			const newerRecord2 = createMockSessionRecord({
				lastAccessAt: now - 100,
			});
			const newestRecord = createMockSessionRecord({
				lastAccessAt: now,
			});

			store.set("user-123:oldest", oldestRecord);
			store.set("user-123:newer1", newerRecord1);
			store.set("user-123:newer2", newerRecord2);

			// This should evict the oldest session
			store.set("user-123:newest", newestRecord);

			expect(store.get("user-123:oldest")).toBeUndefined();
			expect(store.get("user-123:newer1")).toBeDefined();
			expect(store.get("user-123:newer2")).toBeDefined();
			expect(store.get("user-123:newest")).toBeDefined();
			expect(oldestRecord.transport.close).toHaveBeenCalled();
		});

		it("should log when evicting sessions", () => {
			// Use times within TTL (1000ms)
			const now = Date.now();
			store.set("user-123:s1", createMockSessionRecord({ lastAccessAt: now - 500 }));
			store.set("user-123:s2", createMockSessionRecord({ lastAccessAt: now - 300 }));
			store.set("user-123:s3", createMockSessionRecord({ lastAccessAt: now - 100 }));
			store.set("user-123:s4", createMockSessionRecord({ lastAccessAt: now }));

			expect(logger.info).toHaveBeenCalled();
		});
	});

	describe("get", () => {
		it("should return undefined for non-existent session", () => {
			const result = store.get("non-existent");
			expect(result).toBeUndefined();
		});

		it("should return undefined for expired session", async () => {
			const sessionId = "user-123:expired";
			const record = createMockSessionRecord({
				lastAccessAt: Date.now() - 2000, // Expired (TTL is 1000ms)
			});

			store.set(sessionId, record);

			const result = store.get(sessionId);
			expect(result).toBeUndefined();
		});

		it("should delete expired sessions on access", () => {
			const sessionId = "user-123:expired";
			const record = createMockSessionRecord({
				lastAccessAt: Date.now() - 2000,
			});

			store.set(sessionId, record);
			store.get(sessionId);

			expect(store.size).toBe(0);
		});
	});

	describe("touch", () => {
		it("should update lastAccessAt", async () => {
			const sessionId = "user-123:touch-test";
			const initialTime = Date.now() - 500;
			const record = createMockSessionRecord({
				lastAccessAt: initialTime,
			});

			store.set(sessionId, record);

			// Wait a bit to ensure time difference
			await new Promise((resolve) => setTimeout(resolve, 10));
			store.touch(sessionId);

			const retrieved = store.get(sessionId);
			expect(retrieved?.lastAccessAt).toBeGreaterThan(initialTime);
		});

		it("should do nothing for non-existent session", () => {
			// Should not throw
			store.touch("non-existent");
		});
	});

	describe("delete", () => {
		it("should delete a session", () => {
			const sessionId = "user-123:to-delete";
			const record = createMockSessionRecord();

			store.set(sessionId, record);
			const result = store.delete(sessionId);

			expect(result).toBe(true);
			expect(store.get(sessionId)).toBeUndefined();
		});

		it("should return false for non-existent session", () => {
			const result = store.delete("non-existent");
			expect(result).toBe(false);
		});

		it("should close the transport on delete", () => {
			const sessionId = "user-123:close-transport";
			const record = createMockSessionRecord();

			store.set(sessionId, record);
			store.delete(sessionId);

			expect(record.transport.close).toHaveBeenCalled();
		});

		it("should handle transport close errors gracefully", () => {
			const sessionId = "user-123:error-transport";
			const record = createMockSessionRecord();
			record.transport.close.mockImplementation(() => {
				throw new Error("Close failed");
			});

			store.set(sessionId, record);

			// Should not throw
			const result = store.delete(sessionId);
			expect(result).toBe(true);
			expect(logger.warn).toHaveBeenCalled();
		});

		it("should remove session from user tracking", () => {
			const sessionId = "user-123:track-test";

			store.set(sessionId, createMockSessionRecord());
			store.delete(sessionId);

			const userSessions = store.getSessionsForUser("user-123");
			expect(userSessions.size).toBe(0);
		});
	});

	describe("validateOwner", () => {
		it("should return true for matching owner", () => {
			const sessionId = "user-123:valid-owner";
			store.set(sessionId, createMockSessionRecord({ userId: "user-123" }));

			expect(store.validateOwner(sessionId, "user-123")).toBe(true);
		});

		it("should return false for non-matching owner", () => {
			const sessionId = "user-123:wrong-owner";
			store.set(sessionId, createMockSessionRecord({ userId: "user-123" }));

			expect(store.validateOwner(sessionId, "user-456")).toBe(false);
		});

		it("should return false for non-existent session", () => {
			expect(store.validateOwner("non-existent", "user-123")).toBe(false);
		});

		it("should validate session ID prefix matches user ID", () => {
			// Session ID format is userId:uuid, but if the prefix doesn't match, it should fail
			const sessionId = "user-456:hijacked";
			store.set(sessionId, createMockSessionRecord({ userId: "user-123" }));

			// Even though record.userId is user-123, the session ID prefix is user-456
			expect(store.validateOwner(sessionId, "user-123")).toBe(false);
		});
	});

	describe("getSessionsForUser", () => {
		it("should return all sessions for a user", () => {
			store.set("user-123:s1", createMockSessionRecord());
			store.set("user-123:s2", createMockSessionRecord());
			store.set("user-456:s3", createMockSessionRecord({ userId: "user-456" }));

			const user123Sessions = store.getSessionsForUser("user-123");
			expect(user123Sessions.size).toBe(2);

			const user456Sessions = store.getSessionsForUser("user-456");
			expect(user456Sessions.size).toBe(1);
		});

		it("should return empty map for user with no sessions", () => {
			const result = store.getSessionsForUser("non-existent");
			expect(result.size).toBe(0);
		});

		it("should filter out expired sessions", () => {
			store.set(
				"user-123:fresh",
				createMockSessionRecord({
					lastAccessAt: Date.now(),
				}),
			);
			store.set(
				"user-123:expired",
				createMockSessionRecord({
					lastAccessAt: Date.now() - 2000,
				}),
			);

			const sessions = store.getSessionsForUser("user-123");
			expect(sessions.size).toBe(1);
			expect(sessions.has("user-123:fresh")).toBe(true);
		});
	});

	describe("closeSessionsForUser", () => {
		it("should close all sessions for a user", () => {
			const record1 = createMockSessionRecord();
			const record2 = createMockSessionRecord();

			store.set("user-123:s1", record1);
			store.set("user-123:s2", record2);

			const count = store.closeSessionsForUser("user-123");

			expect(count).toBe(2);
			expect(store.getSessionsForUser("user-123").size).toBe(0);
			expect(record1.transport.close).toHaveBeenCalled();
			expect(record2.transport.close).toHaveBeenCalled();
		});

		it("should return 0 for user with no sessions", () => {
			const count = store.closeSessionsForUser("non-existent");
			expect(count).toBe(0);
		});

		it("should not affect other users", () => {
			store.set("user-123:s1", createMockSessionRecord());
			store.set("user-456:s2", createMockSessionRecord({ userId: "user-456" }));

			store.closeSessionsForUser("user-123");

			expect(store.getSessionsForUser("user-456").size).toBe(1);
		});
	});

	describe("entries", () => {
		it("should iterate over all sessions", () => {
			store.set("user-123:s1", createMockSessionRecord());
			store.set("user-456:s2", createMockSessionRecord({ userId: "user-456" }));

			const entries = [...store.entries()];
			expect(entries.length).toBe(2);
		});
	});

	describe("size", () => {
		it("should return total session count", () => {
			expect(store.size).toBe(0);

			store.set("user-123:s1", createMockSessionRecord());
			expect(store.size).toBe(1);

			store.set("user-123:s2", createMockSessionRecord());
			expect(store.size).toBe(2);

			store.delete("user-123:s1");
			expect(store.size).toBe(1);
		});
	});

	describe("shutdown", () => {
		it("should close all sessions", () => {
			const record1 = createMockSessionRecord();
			const record2 = createMockSessionRecord();

			store.set("user-123:s1", record1);
			store.set("user-123:s2", record2);

			store.shutdown();

			expect(store.size).toBe(0);
			expect(record1.transport.close).toHaveBeenCalled();
			expect(record2.transport.close).toHaveBeenCalled();
		});

		it("should log shutdown", () => {
			store.shutdown();
			expect(logger.info).toHaveBeenCalledWith("Session store shutdown complete");
		});
	});
});

describe("generateSecureSessionId", () => {
	it("should generate session ID in correct format", () => {
		const sessionId = generateSecureSessionId("user-123");
		expect(sessionId).toMatch(/^user-123:[a-f0-9-]{36}$/);
	});

	it("should generate unique session IDs", () => {
		const id1 = generateSecureSessionId("user-123");
		const id2 = generateSecureSessionId("user-123");
		expect(id1).not.toBe(id2);
	});

	it("should bind session to user ID", () => {
		const sessionId = generateSecureSessionId("user-456");
		expect(sessionId.startsWith("user-456:")).toBe(true);
	});
});

describe("createSessionStore", () => {
	it("should create a SessionStore instance", () => {
		const logger = createTestLogger();
		const store = createSessionStore({ logger });

		expect(store).toBeInstanceOf(SessionStore);

		store.shutdown();
	});
});
