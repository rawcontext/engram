import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { MemoryNode } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ElicitationService } from "../capabilities/elicitation";
import { ConflictAuditService } from "../services/conflict-audit";
import { ConflictDetectorService } from "../services/conflict-detector";
import type { IEngramClient, IMemoryStore, RecallResult } from "../services/interfaces";
import { registerRecallTool } from "./recall";
import { registerRememberTool } from "./remember";

/**
 * Integration tests for end-to-end conflict detection flow
 *
 * Tests the complete conflict detection pipeline:
 * 1. Create memory → detect conflicts → elicitation → invalidation
 * 2. Recall returns only valid memories by default
 * 3. includeInvalidated flag returns all memories
 * 4. Elicitation confirmation/rejection flow
 */
describe("Conflict Detection Integration", () => {
	let mockServer: McpServer;
	let mockLogger: Logger;
	let mockMemoryStore: IMemoryStore;
	let mockCloudClient: IEngramClient;
	let conflictDetector: ConflictDetectorService;
	let elicitation: ElicitationService;
	let conflictAudit: ConflictAuditService;

	// Tool handlers captured from registerTool calls
	let rememberHandler: (args: any) => Promise<any>;
	let recallHandler: (args: any) => Promise<any>;

	// Mutable memory storage for tests
	let memoryStorage: Map<string, MemoryNode>;
	let invalidatedMemories: Set<string>;

	const createMockMemory = (
		id: string,
		content: string,
		type: string = "preference",
		vt_start: number = Date.now(),
		vt_end: number = Number.MAX_SAFE_INTEGER,
	): MemoryNode => ({
		id,
		content,
		type: type as any,
		tags: [],
		project: "test-project",
		source: "user",
		vt_start,
		vt_end,
		tt_start: vt_start,
		tt_end: Number.MAX_SAFE_INTEGER,
	});

	beforeEach(() => {
		// Reset storage
		memoryStorage = new Map();
		invalidatedMemories = new Set();

		// Mock MCP server that captures tool registrations
		const registeredTools: Map<string, { handler: (args: any) => Promise<any> }> = new Map();

		mockServer = {
			registerTool: mock((name: string, _schema: any, handler: (args: any) => Promise<any>) => {
				registeredTools.set(name, { handler });
			}),
			server: {
				getClientCapabilities: mock(() => ({ sampling: false })),
				createMessage: mock(() => Promise.resolve(null)),
				elicitInput: mock(() =>
					Promise.resolve({
						action: "accept",
						content: { confirmed: true },
					}),
				),
			},
		} as unknown as McpServer;

		// Mock logger
		mockLogger = {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
			child: mock(() => mockLogger),
		} as unknown as Logger;

		// Mock memory store
		mockMemoryStore = {
			createMemory: mock(async (input: any) => {
				const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
				const memory = createMockMemory(id, input.content, input.type, Date.now());
				memoryStorage.set(id, memory);
				return memory;
			}),
			getMemory: mock(async (id: string) => memoryStorage.get(id) || null),
			listMemories: mock(async () => Array.from(memoryStorage.values())),
			deleteMemory: mock(async () => true),
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
		} as IMemoryStore;

		// Mock cloud client
		mockCloudClient = {
			findConflictCandidates: mock(async (_content: string) => {
				// Return all stored memories as potential candidates
				const candidates: any[] = [];
				for (const [id, memory] of memoryStorage) {
					candidates.push({
						id,
						content: memory.content,
						type: memory.type,
						score: 0.85,
						vt_start: memory.vt_start,
					});
				}
				return candidates;
			}),
			invalidateMemory: mock(async (memoryId: string) => {
				invalidatedMemories.add(memoryId);
				const memory = memoryStorage.get(memoryId);
				if (memory) {
					memory.vt_end = Date.now();
				}
			}),
			query: mock(async (cypher: string, params: any) => {
				// Mock vt_end query for conflict enrichment
				if (cypher.includes("vt_end") && params?.id) {
					const memory = memoryStorage.get(params.id);
					return [{ vt_end: memory?.vt_end ?? Number.MAX_SAFE_INTEGER }];
				}
				return [];
			}),
			createMemory: mock(async (input: any) => mockMemoryStore.createMemory(input)),
			recall: mock(async (_query: string, limit: number, filters: any) => {
				const results: RecallResult[] = [];
				const now = Date.now();

				for (const [id, memory] of memoryStorage) {
					const isInvalidated = memory.vt_end < Number.MAX_SAFE_INTEGER && memory.vt_end < now;

					// Skip invalidated memories unless includeInvalidated is true (vtEndAfter = 0)
					if (filters?.vtEndAfter !== 0 && isInvalidated) {
						continue;
					}

					results.push({
						id: memory.id,
						content: memory.content,
						score: 0.9 - results.length * 0.1,
						type: memory.type,
						created_at: new Date(memory.vt_start).toISOString(),
						invalidated: isInvalidated,
						invalidatedAt: isInvalidated ? memory.vt_end : undefined,
						replacedBy: null,
					});
				}

				return results.slice(0, limit);
			}),
			getMemory: mock(async (id: string) => memoryStorage.get(id) || null),
			listMemories: mock(async () => Array.from(memoryStorage.values())),
			deleteMemory: mock(async () => true),
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			getContext: mock(async () => []),
		} as unknown as IEngramClient;

		// Create real services with mocks
		conflictDetector = new ConflictDetectorService(mockServer, mockLogger, "test-api-key");
		elicitation = new ElicitationService(mockServer, mockLogger);
		conflictAudit = new ConflictAuditService(mockLogger);

		// Register tools
		registerRememberTool(
			mockServer,
			mockMemoryStore,
			() => ({ sessionId: "test-session", project: "test-project" }),
			mockCloudClient,
			conflictDetector,
			elicitation,
			conflictAudit,
			mockLogger,
		);

		registerRecallTool(
			mockServer,
			mockCloudClient,
			() => ({ project: "test-project" }),
			elicitation,
		);

		// Capture handlers
		const rememberReg = (mockServer.registerTool as any).mock.calls.find(
			(c: any[]) => c[0] === "remember",
		);
		const recallReg = (mockServer.registerTool as any).mock.calls.find(
			(c: any[]) => c[0] === "recall",
		);

		rememberHandler = rememberReg?.[2];
		recallHandler = recallReg?.[2];
	});

	afterEach(() => {
		mock.restore();
	});

	describe("Preference conflict scenario: dark mode → light mode", () => {
		it("should invalidate old preference when user confirms via elicitation", async () => {
			// Enable elicitation
			elicitation.enable();

			// Mock Gemini to return SUPERSEDES for preference conflict
			const mockFetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							candidates: [
								{
									content: {
										parts: [
											{
												text: JSON.stringify({
													relation: "supersedes",
													confidence: 0.95,
													reasoning: "User changed theme preference from dark to light mode",
													suggestedAction: "invalidate_old",
												}),
											},
										],
									},
								},
							],
						}),
				}),
			);
			global.fetch = mockFetch as any;

			// Mock elicitation confirmation
			(mockServer.server as any).elicitInput = mock(() =>
				Promise.resolve({
					action: "accept",
					content: { confirmed: true },
				}),
			);

			// Step 1: Create first memory "prefers dark mode"
			const darkModeResult = await rememberHandler({
				content: "User prefers dark mode for the IDE",
				type: "preference",
			});

			expect(darkModeResult.structuredContent.stored).toBe(true);
			const darkModeId = darkModeResult.structuredContent.id;
			expect(memoryStorage.has(darkModeId)).toBe(true);

			// Step 2: Create second memory "prefers light mode" - should detect conflict
			const lightModeResult = await rememberHandler({
				content: "User prefers light mode for the IDE",
				type: "preference",
			});

			expect(lightModeResult.structuredContent.stored).toBe(true);
			expect(lightModeResult.structuredContent.duplicate).toBe(false);

			// Step 3: Verify the old memory was invalidated
			expect(invalidatedMemories.has(darkModeId)).toBe(true);
			const darkModeMemory = memoryStorage.get(darkModeId);
			expect(darkModeMemory?.vt_end).toBeLessThan(Number.MAX_SAFE_INTEGER);
		});

		it("should keep both memories when user declines invalidation", async () => {
			// Enable elicitation
			elicitation.enable();

			// Mock Gemini to return SUPERSEDES
			const mockFetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							candidates: [
								{
									content: {
										parts: [
											{
												text: JSON.stringify({
													relation: "supersedes",
													confidence: 0.9,
													reasoning: "Theme preference update",
													suggestedAction: "invalidate_old",
												}),
											},
										],
									},
								},
							],
						}),
				}),
			);
			global.fetch = mockFetch as any;

			// Mock elicitation REJECTION
			(mockServer.server as any).elicitInput = mock(() =>
				Promise.resolve({
					action: "cancel",
					content: { confirmed: false },
				}),
			);

			// Create first memory
			const darkModeResult = await rememberHandler({
				content: "User prefers dark mode",
				type: "preference",
			});
			const darkModeId = darkModeResult.structuredContent.id;

			// Create second conflicting memory - user declines invalidation
			await rememberHandler({
				content: "User prefers light mode",
				type: "preference",
			});

			// Both memories should be valid (not invalidated)
			expect(invalidatedMemories.has(darkModeId)).toBe(false);
			const darkModeMemory = memoryStorage.get(darkModeId);
			expect(darkModeMemory?.vt_end).toBe(Number.MAX_SAFE_INTEGER);
		});

		it("should auto-invalidate when elicitation is not available", async () => {
			// Do NOT enable elicitation (simulates client without elicitation capability)

			// Mock Gemini to return SUPERSEDES
			const mockFetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							candidates: [
								{
									content: {
										parts: [
											{
												text: JSON.stringify({
													relation: "supersedes",
													confidence: 0.95,
													reasoning: "Theme preference update",
													suggestedAction: "invalidate_old",
												}),
											},
										],
									},
								},
							],
						}),
				}),
			);
			global.fetch = mockFetch as any;

			// Create first memory
			const darkModeResult = await rememberHandler({
				content: "User prefers dark mode",
				type: "preference",
			});
			const darkModeId = darkModeResult.structuredContent.id;

			// Create second conflicting memory - should auto-invalidate old one
			await rememberHandler({
				content: "User prefers light mode",
				type: "preference",
			});

			// Old memory should be invalidated without asking
			expect(invalidatedMemories.has(darkModeId)).toBe(true);
		});
	});

	describe("Recall filtering by validity", () => {
		beforeEach(async () => {
			// Pre-populate with memories: one valid, one invalidated
			const validMemory = createMockMemory("valid-mem", "Current preference: tabs", "preference");

			const invalidatedMemory = createMockMemory(
				"invalid-mem",
				"Old preference: spaces",
				"preference",
				Date.now() - 86400000, // Created yesterday
				Date.now() - 1000, // Invalidated 1 second ago
			);

			memoryStorage.set("valid-mem", validMemory);
			memoryStorage.set("invalid-mem", invalidatedMemory);
		});

		it("should return only valid memories by default (includeInvalidated: false)", async () => {
			const result = await recallHandler({
				query: "preferences",
				limit: 10,
				includeInvalidated: false,
			});

			const memories = result.structuredContent.memories;
			expect(memories).toHaveLength(1);
			expect(memories[0].id).toBe("valid-mem");
			expect(memories[0].invalidated).toBeFalsy();
		});

		it("should return all memories when includeInvalidated: true", async () => {
			const result = await recallHandler({
				query: "preferences",
				limit: 10,
				includeInvalidated: true,
			});

			const memories = result.structuredContent.memories;
			expect(memories).toHaveLength(2);

			// Check that invalidated memory is marked
			const invalidMem = memories.find((m: RecallResult) => m.id === "invalid-mem");
			expect(invalidMem).toBeDefined();
			expect(invalidMem?.invalidated).toBe(true);
			expect(invalidMem?.invalidatedAt).toBeDefined();
		});

		it("should format invalidated memories with strikethrough", async () => {
			const result = await recallHandler({
				query: "preferences",
				limit: 10,
				includeInvalidated: true,
			});

			const invalidMem = result.structuredContent.memories.find(
				(m: RecallResult) => m.id === "invalid-mem",
			);
			expect(invalidMem?.content).toContain("~~");
			expect(invalidMem?.content).toContain("Old preference: spaces");
		});
	});

	describe("Duplicate detection", () => {
		it("should skip duplicate memories and return existing ID", async () => {
			// Mock Gemini to return DUPLICATE
			const mockFetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							candidates: [
								{
									content: {
										parts: [
											{
												text: JSON.stringify({
													relation: "duplicate",
													confidence: 0.98,
													reasoning: "Semantically identical content",
													suggestedAction: "skip_new",
												}),
											},
										],
									},
								},
							],
						}),
				}),
			);
			global.fetch = mockFetch as any;

			// Create first memory
			const firstResult = await rememberHandler({
				content: "Always use TypeScript for new projects",
				type: "decision",
			});
			const firstId = firstResult.structuredContent.id;

			// Try to create duplicate
			const duplicateResult = await rememberHandler({
				content: "Use TypeScript for all new projects",
				type: "decision",
			});

			// Should not store new memory, return existing ID
			expect(duplicateResult.structuredContent.stored).toBe(false);
			expect(duplicateResult.structuredContent.duplicate).toBe(true);
			expect(duplicateResult.structuredContent.id).toBe(firstId);
		});
	});

	describe("Contradiction detection", () => {
		it("should invalidate contradicting memory", async () => {
			elicitation.enable();

			// Mock Gemini to return CONTRADICTION
			const mockFetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							candidates: [
								{
									content: {
										parts: [
											{
												text: JSON.stringify({
													relation: "contradiction",
													confidence: 0.97,
													reasoning: "Enabled vs disabled are mutually exclusive",
													suggestedAction: "invalidate_old",
												}),
											},
										],
									},
								},
							],
						}),
				}),
			);
			global.fetch = mockFetch as any;

			// Mock elicitation confirmation
			(mockServer.server as any).elicitInput = mock(() =>
				Promise.resolve({
					action: "accept",
					content: { confirmed: true },
				}),
			);

			// Create first memory
			const disabledResult = await rememberHandler({
				content: "Feature X is disabled by default",
				type: "fact",
			});
			const disabledId = disabledResult.structuredContent.id;

			// Create contradicting memory
			await rememberHandler({
				content: "Feature X is enabled by default",
				type: "fact",
			});

			// Old contradicting memory should be invalidated
			expect(invalidatedMemories.has(disabledId)).toBe(true);
		});
	});

	describe("Independent memories", () => {
		it("should keep both independent memories", async () => {
			// Mock Gemini to return INDEPENDENT
			const mockFetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							candidates: [
								{
									content: {
										parts: [
											{
												text: JSON.stringify({
													relation: "independent",
													confidence: 0.95,
													reasoning: "Facts are about unrelated topics",
													suggestedAction: "keep_both",
												}),
											},
										],
									},
								},
							],
						}),
				}),
			);
			global.fetch = mockFetch as any;

			// Create first memory
			const colorResult = await rememberHandler({
				content: "User's favorite color is blue",
				type: "preference",
			});
			const colorId = colorResult.structuredContent.id;

			// Create unrelated memory
			const foodResult = await rememberHandler({
				content: "User prefers Italian food",
				type: "preference",
			});

			// Both should be stored and valid
			expect(colorResult.structuredContent.stored).toBe(true);
			expect(foodResult.structuredContent.stored).toBe(true);
			expect(invalidatedMemories.has(colorId)).toBe(false);
		});
	});

	describe("Augmenting memories", () => {
		it("should keep both augmenting memories (complementary info)", async () => {
			// Mock Gemini to return AUGMENTS
			const mockFetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							candidates: [
								{
									content: {
										parts: [
											{
												text: JSON.stringify({
													relation: "augments",
													confidence: 0.88,
													reasoning: "New info complements existing database fact",
													suggestedAction: "keep_both",
												}),
											},
										],
									},
								},
							],
						}),
				}),
			);
			global.fetch = mockFetch as any;

			// Create first memory
			const dbResult = await rememberHandler({
				content: "Database is PostgreSQL 14",
				type: "fact",
			});
			const dbId = dbResult.structuredContent.id;

			// Create augmenting memory
			const poolResult = await rememberHandler({
				content: "Database connection pool max size is 20",
				type: "fact",
			});

			// Both should be stored and valid
			expect(dbResult.structuredContent.stored).toBe(true);
			expect(poolResult.structuredContent.stored).toBe(true);
			expect(invalidatedMemories.has(dbId)).toBe(false);
		});
	});
});
