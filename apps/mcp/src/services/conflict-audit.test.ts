import { describe, expect, it, mock } from "bun:test";
import type { Logger } from "@engram/logger";
import { ConflictAuditService } from "./conflict-audit";

// Create a mock logger that captures calls
function createMockLogger() {
	const calls: { level: string; data: unknown; message?: string }[] = [];

	const mockChild = {
		info: mock((data: unknown, message?: string) => {
			calls.push({ level: "info", data, message });
		}),
		debug: mock((data: unknown, message?: string) => {
			calls.push({ level: "debug", data, message });
		}),
		warn: mock((data: unknown, message?: string) => {
			calls.push({ level: "warn", data, message });
		}),
		error: mock((data: unknown, message?: string) => {
			calls.push({ level: "error", data, message });
		}),
		child: mock(() => mockChild),
	};

	const mockLogger = {
		...mockChild,
		calls,
	} as unknown as Logger & { calls: typeof calls };

	return mockLogger;
}

describe("ConflictAuditService", () => {
	const newMemory = {
		id: "mem_new_123",
		content: "User prefers dark mode in VS Code",
		type: "preference",
	};

	const conflictingMemory = {
		id: "mem_old_456",
		content: "User prefers light mode in VS Code",
		type: "preference",
	};

	function createMockCloudClient(queryResponse: unknown = []) {
		return {
			query: mock(async () => queryResponse),
		};
	}

	describe("logConflictDecision", () => {
		it("should log a conflict decision with full context", () => {
			const logger = createMockLogger();
			const service = new ConflictAuditService(logger, {
				sessionId: "session_123",
				project: "my-project",
				orgId: "org_456",
			});

			const entry = service.logConflictDecision({
				newMemory,
				conflictingMemory,
				relation: "supersedes",
				confidence: 0.92,
				reasoning: "New preference replaces outdated setting",
				suggestedAction: "invalidate_old",
				decisionSource: "user_confirmed",
				outcome: "invalidate_old",
				elicitationAvailable: true,
			});

			expect(entry.id).toBeDefined();
			expect(entry.timestamp).toBeInstanceOf(Date);
			expect(entry.sessionId).toBe("session_123");
			expect(entry.project).toBe("my-project");
			expect(entry.orgId).toBe("org_456");
			expect(entry.newMemoryId).toBe("mem_new_123");
			expect(entry.newMemoryPreview).toContain("dark mode");
			expect(entry.conflictingMemoryId).toBe("mem_old_456");
			expect(entry.relation).toBe("supersedes");
			expect(entry.confidence).toBe(0.92);
			expect(entry.decisionSource).toBe("user_confirmed");
			expect(entry.outcome).toBe("invalidate_old");
			expect(entry.success).toBe(true);
		});

		it("should truncate long content in previews", () => {
			const logger = createMockLogger();
			const service = new ConflictAuditService(logger);

			const longContent = "A".repeat(200);
			const entry = service.logConflictDecision({
				newMemory: { content: longContent, type: "fact" },
				conflictingMemory: { id: "old", content: longContent, type: "fact" },
				relation: "duplicate",
				confidence: 0.99,
				reasoning: "Exact match",
				suggestedAction: "skip_new",
				decisionSource: "duplicate_detected",
				outcome: "skip_new",
				elicitationAvailable: false,
			});

			expect(entry.newMemoryPreview.length).toBeLessThanOrEqual(103); // 100 + "..."
			expect(entry.newMemoryPreview).toEndWith("...");
		});
	});

	describe("logUserConfirmed", () => {
		it("should set correct decision source and outcome", () => {
			const logger = createMockLogger();
			const service = new ConflictAuditService(logger);

			const entry = service.logUserConfirmed({
				newMemory,
				conflictingMemory,
				relation: "supersedes",
				confidence: 0.85,
				reasoning: "User confirmed the update",
				suggestedAction: "invalidate_old",
				elicitationAvailable: true,
			});

			expect(entry.decisionSource).toBe("user_confirmed");
			expect(entry.outcome).toBe("invalidate_old");
		});
	});

	describe("logUserDeclined", () => {
		it("should set correct decision source and outcome", () => {
			const logger = createMockLogger();
			const service = new ConflictAuditService(logger);

			const entry = service.logUserDeclined({
				newMemory,
				conflictingMemory,
				relation: "contradiction",
				confidence: 0.78,
				reasoning: "User wants to keep both",
				suggestedAction: "invalidate_old",
				elicitationAvailable: true,
			});

			expect(entry.decisionSource).toBe("user_declined");
			expect(entry.outcome).toBe("keep_both");
		});
	});

	describe("logAutoApplied", () => {
		it("should mark elicitation as unavailable", () => {
			const logger = createMockLogger();
			const service = new ConflictAuditService(logger);

			const entry = service.logAutoApplied({
				newMemory,
				conflictingMemory,
				relation: "supersedes",
				confidence: 0.91,
				reasoning: "Auto-applied due to no elicitation",
				suggestedAction: "invalidate_old",
				outcome: "invalidate_old",
			});

			expect(entry.decisionSource).toBe("auto_applied");
			expect(entry.elicitationAvailable).toBe(false);
		});
	});

	describe("logDuplicateDetected", () => {
		it("should set correct values for duplicate detection", () => {
			const logger = createMockLogger();
			const service = new ConflictAuditService(logger);

			const entry = service.logDuplicateDetected({
				newMemory,
				conflictingMemory,
				relation: "duplicate",
				confidence: 0.98,
				reasoning: "Content is semantically identical",
				elicitationAvailable: true,
			});

			expect(entry.decisionSource).toBe("duplicate_detected");
			expect(entry.outcome).toBe("skip_new");
			expect(entry.suggestedAction).toBe("skip_new");
		});
	});

	describe("logClassificationFailed", () => {
		it("should log failure with error details", () => {
			const logger = createMockLogger();
			const service = new ConflictAuditService(logger);

			const entry = service.logClassificationFailed(
				newMemory,
				conflictingMemory,
				"LLM timeout after 30s",
			);

			expect(entry.decisionSource).toBe("classification_failed");
			expect(entry.outcome).toBe("keep_both");
			expect(entry.relation).toBe("independent");
			expect(entry.confidence).toBe(0.5);
			expect(entry.success).toBe(false);
			expect(entry.errorMessage).toBe("LLM timeout after 30s");
			expect(entry.reasoning).toContain("Classification failed");
		});
	});

	describe("setContext", () => {
		it("should update context for subsequent entries", () => {
			const logger = createMockLogger();
			const service = new ConflictAuditService(logger);

			// First entry without context
			const entry1 = service.logDuplicateDetected({
				newMemory,
				conflictingMemory,
				relation: "duplicate",
				confidence: 0.99,
				reasoning: "Match",
				elicitationAvailable: false,
			});

			expect(entry1.sessionId).toBeUndefined();
			expect(entry1.project).toBeUndefined();

			// Update context
			service.setContext({
				sessionId: "session_new",
				project: "new-project",
				orgId: "org_new",
			});

			// Second entry with context
			const entry2 = service.logDuplicateDetected({
				newMemory,
				conflictingMemory,
				relation: "duplicate",
				confidence: 0.99,
				reasoning: "Match",
				elicitationAvailable: false,
			});

			expect(entry2.sessionId).toBe("session_new");
			expect(entry2.project).toBe("new-project");
			expect(entry2.orgId).toBe("org_new");
		});
	});

	describe("graph persistence", () => {
		it("should persist to graph when cloud client is available", async () => {
			const logger = createMockLogger();
			const cloudClient = createMockCloudClient();
			const service = new ConflictAuditService(
				logger,
				{
					sessionId: "session_123",
					project: "test-project",
					orgId: "org_123",
					orgSlug: "test-org",
				},
				cloudClient as any,
			);

			service.logUserConfirmed({
				newMemory,
				conflictingMemory,
				relation: "supersedes",
				confidence: 0.85,
				reasoning: "User confirmed",
				suggestedAction: "invalidate_old",
				elicitationAvailable: true,
			});

			// Wait for async graph persistence
			await new Promise((r) => setTimeout(r, 50));

			expect(cloudClient.query).toHaveBeenCalled();
		});

		it("should skip graph persistence when no cloud client", () => {
			const logger = createMockLogger();
			const service = new ConflictAuditService(logger);

			service.logUserConfirmed({
				newMemory,
				conflictingMemory,
				relation: "supersedes",
				confidence: 0.85,
				reasoning: "User confirmed",
				suggestedAction: "invalidate_old",
				elicitationAvailable: true,
			});

			// Check that debug log was called about skipping persistence
			const debugCalls = logger.calls.filter((c) => c.level === "debug");
			expect(debugCalls.some((c) => String(c.message).includes("skipping graph"))).toBe(true);
		});

		it("should handle graph persistence failure gracefully", async () => {
			const logger = createMockLogger();
			const cloudClient = {
				query: mock(async () => {
					throw new Error("Graph write failed");
				}),
			};
			const service = new ConflictAuditService(
				logger,
				{ sessionId: "session_123", project: "test-project" },
				cloudClient as any,
			);

			// Should not throw
			service.logUserConfirmed({
				newMemory,
				conflictingMemory,
				relation: "supersedes",
				confidence: 0.85,
				reasoning: "User confirmed",
				suggestedAction: "invalidate_old",
				elicitationAvailable: true,
			});

			// Wait for async graph persistence to fail
			await new Promise((r) => setTimeout(r, 50));

			// Check that warn log was called about failure
			const warnCalls = logger.calls.filter((c) => c.level === "warn");
			expect(warnCalls.some((c) => String(c.message).includes("Failed to persist"))).toBe(true);
		});
	});

	describe("model mapping", () => {
		it("should map user_confirmed to mcp-elicitation", () => {
			const logger = createMockLogger();
			const cloudClient = createMockCloudClient();
			const service = new ConflictAuditService(logger, {}, cloudClient as any);

			service.logUserConfirmed({
				newMemory,
				conflictingMemory,
				relation: "supersedes",
				confidence: 0.85,
				reasoning: "User confirmed",
				suggestedAction: "invalidate_old",
				elicitationAvailable: true,
			});

			// Check the query was called with mcp-elicitation model
			expect(cloudClient.query).toHaveBeenCalledWith(
				expect.stringContaining("ConflictDecision"),
				expect.objectContaining({ modelUsed: "mcp-elicitation" }),
				undefined,
			);
		});

		it("should map user_declined to mcp-elicitation", () => {
			const logger = createMockLogger();
			const cloudClient = createMockCloudClient();
			const service = new ConflictAuditService(logger, {}, cloudClient as any);

			service.logUserDeclined({
				newMemory,
				conflictingMemory,
				relation: "contradiction",
				confidence: 0.78,
				reasoning: "User declined",
				suggestedAction: "invalidate_old",
				elicitationAvailable: true,
			});

			expect(cloudClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ modelUsed: "mcp-elicitation" }),
				undefined,
			);
		});

		it("should map auto_applied to gemini model", () => {
			const logger = createMockLogger();
			const cloudClient = createMockCloudClient();
			const service = new ConflictAuditService(logger, {}, cloudClient as any);

			service.logAutoApplied({
				newMemory,
				conflictingMemory,
				relation: "supersedes",
				confidence: 0.91,
				reasoning: "Auto-applied",
				suggestedAction: "invalidate_old",
				outcome: "invalidate_old",
			});

			expect(cloudClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ modelUsed: "gemini-3-flash-preview" }),
				undefined,
			);
		});

		it("should map duplicate_detected to gemini model", () => {
			const logger = createMockLogger();
			const cloudClient = createMockCloudClient();
			const service = new ConflictAuditService(logger, {}, cloudClient as any);

			service.logDuplicateDetected({
				newMemory,
				conflictingMemory,
				relation: "duplicate",
				confidence: 0.98,
				reasoning: "Duplicate",
				elicitationAvailable: true,
			});

			expect(cloudClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ modelUsed: "gemini-3-flash-preview" }),
				undefined,
			);
		});

		it("should map classification_failed appropriately", () => {
			const logger = createMockLogger();
			const cloudClient = createMockCloudClient();
			const service = new ConflictAuditService(logger, {}, cloudClient as any);

			service.logClassificationFailed(newMemory, conflictingMemory, "Timeout");

			expect(cloudClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ modelUsed: "classification-failed" }),
				undefined,
			);
		});
	});

	describe("outcome mapping", () => {
		it("should map keep_both outcome", () => {
			const logger = createMockLogger();
			const cloudClient = createMockCloudClient();
			const service = new ConflictAuditService(logger, {}, cloudClient as any);

			service.logUserDeclined({
				newMemory,
				conflictingMemory,
				relation: "contradiction",
				confidence: 0.78,
				reasoning: "Keep both",
				suggestedAction: "invalidate_old",
				elicitationAvailable: true,
			});

			expect(cloudClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ actionTaken: "keep_both" }),
				undefined,
			);
		});

		it("should map skip_new outcome", () => {
			const logger = createMockLogger();
			const cloudClient = createMockCloudClient();
			const service = new ConflictAuditService(logger, {}, cloudClient as any);

			service.logDuplicateDetected({
				newMemory,
				conflictingMemory,
				relation: "duplicate",
				confidence: 0.98,
				reasoning: "Skip new",
				elicitationAvailable: true,
			});

			expect(cloudClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ actionTaken: "skip_new" }),
				undefined,
			);
		});
	});
});
