import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ElicitationService } from "../capabilities/elicitation";
import type { ConflictAuditService } from "../services/conflict-audit";
import type { ConflictDetectorService } from "../services/conflict-detector";
import type { EntityExtractorService } from "../services/entity-extractor";
import type { EntityResolverService } from "../services/entity-resolver";
import type { IEngramClient, IMemoryStore } from "../services/interfaces";
import { type EntityExtractionOptions, registerRememberTool } from "./remember";

describe("registerRememberTool", () => {
	let mockServer: McpServer;
	let mockMemoryStore: IMemoryStore;
	let mockCloudClient: IEngramClient;
	let mockConflictDetector: ConflictDetectorService;
	let mockElicitation: ElicitationService;
	let mockConflictAudit: ConflictAuditService;
	let mockLogger: any;
	let registeredHandler: (args: {
		content: string;
		type?: string;
		tags?: string[];
	}) => Promise<unknown>;

	const defaultContext = {
		sessionId: "session-123",
		workingDir: "/projects/test",
		project: "test-project",
	};

	beforeEach(() => {
		mockServer = {
			registerTool: mock((name, options, handler) => {
				registeredHandler = handler;
			}),
		} as unknown as McpServer;

		mockMemoryStore = {
			createMemory: mock(async (params) => ({
				id: `mem-${Date.now()}`,
				content: params.content,
				type: params.type ?? "context",
				tags: params.tags ?? [],
				project: params.project,
			})),
		} as unknown as IMemoryStore;

		mockCloudClient = {
			findConflictCandidates: mock(async () => []),
			query: mock(async () => []),
			invalidateMemory: mock(async () => {}),
		} as unknown as IEngramClient;

		mockConflictDetector = {
			detectConflicts: mock(async () => []),
			formatConflictMessage: mock(() => "Conflict message"),
		} as unknown as ConflictDetectorService;

		mockElicitation = {
			enabled: false,
			confirm: mock(async () => ({ accepted: false })),
		} as unknown as ElicitationService;

		mockConflictAudit = {
			logUserConfirmed: mock(() => {}),
			logUserDeclined: mock(() => {}),
			logAutoApplied: mock(() => {}),
			logDuplicateDetected: mock(() => {}),
		} as unknown as ConflictAuditService;

		mockLogger = {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		};
	});

	describe("registration", () => {
		it("should register the remember tool with correct name", () => {
			registerRememberTool(
				mockServer,
				mockMemoryStore,
				() => defaultContext,
				mockCloudClient,
				mockConflictDetector,
				mockElicitation,
				mockConflictAudit,
				mockLogger,
			);

			expect(mockServer.registerTool).toHaveBeenCalledWith(
				"remember",
				expect.objectContaining({
					title: "Remember",
					description: expect.stringContaining("Persist valuable information"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("handler", () => {
		beforeEach(() => {
			registerRememberTool(
				mockServer,
				mockMemoryStore,
				() => defaultContext,
				mockCloudClient,
				mockConflictDetector,
				mockElicitation,
				mockConflictAudit,
				mockLogger,
			);
		});

		it("should create a memory with content", async () => {
			const result = (await registeredHandler({
				content: "Test memory content",
			})) as any;

			expect(mockMemoryStore.createMemory).toHaveBeenCalledWith(
				expect.objectContaining({
					content: "Test memory content",
					project: "test-project",
					workingDir: "/projects/test",
					sourceSessionId: "session-123",
					source: "user",
				}),
			);

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.stored).toBe(true);
			expect(parsed.duplicate).toBe(false);
		});

		it("should pass type and tags to memory store", async () => {
			await registeredHandler({
				content: "Decision about caching",
				type: "decision",
				tags: ["cache", "performance"],
			});

			expect(mockMemoryStore.createMemory).toHaveBeenCalledWith(
				expect.objectContaining({
					content: "Decision about caching",
					type: "decision",
					tags: ["cache", "performance"],
				}),
			);
		});

		it("should search for conflict candidates", async () => {
			await registeredHandler({
				content: "Some content",
			});

			expect(mockCloudClient.findConflictCandidates).toHaveBeenCalledWith(
				"Some content",
				"test-project",
			);
		});
	});

	describe("conflict detection", () => {
		beforeEach(() => {
			registerRememberTool(
				mockServer,
				mockMemoryStore,
				() => defaultContext,
				mockCloudClient,
				mockConflictDetector,
				mockElicitation,
				mockConflictAudit,
				mockLogger,
			);
		});

		it("should detect conflicts when candidates found", async () => {
			spyOn(mockCloudClient, "findConflictCandidates").mockResolvedValue([
				{
					id: "mem-old",
					content: "Old memory",
					type: "decision",
					score: 0.9,
					vt_start: Date.now() - 86400000,
				},
			]);
			spyOn(mockCloudClient, "query").mockResolvedValue([{ vt_end: Number.MAX_SAFE_INTEGER }]);

			await registeredHandler({ content: "New conflicting memory" });

			expect(mockConflictDetector.detectConflicts).toHaveBeenCalledWith(
				{ content: "New conflicting memory", type: "context" },
				expect.arrayContaining([
					expect.objectContaining({
						memoryId: "mem-old",
						content: "Old memory",
					}),
				]),
			);
		});

		it("should handle duplicate detection", async () => {
			spyOn(mockCloudClient, "findConflictCandidates").mockResolvedValue([
				{
					id: "mem-duplicate",
					content: "Exact same content",
					type: "fact",
					score: 0.99,
					vt_start: Date.now() - 1000,
				},
			]);
			spyOn(mockCloudClient, "query").mockResolvedValue([{ vt_end: Number.MAX_SAFE_INTEGER }]);
			spyOn(mockConflictDetector, "detectConflicts").mockResolvedValue([
				{
					candidate: {
						memoryId: "mem-duplicate",
						content: "Exact same content",
						type: "fact",
						vt_start: Date.now() - 1000,
						vt_end: Number.MAX_SAFE_INTEGER,
						similarity: 0.99,
					},
					relation: "duplicate",
					confidence: 0.99,
					suggestedAction: "skip_new",
					reasoning: "Identical content",
				},
			]);

			const result = (await registeredHandler({ content: "Exact same content" })) as any;
			const parsed = JSON.parse(result.content[0].text);

			expect(parsed.stored).toBe(false);
			expect(parsed.duplicate).toBe(true);
			expect(parsed.id).toBe("mem-duplicate");
			expect(mockConflictAudit.logDuplicateDetected).toHaveBeenCalled();
		});

		it("should auto-invalidate superseding memory when elicitation disabled", async () => {
			spyOn(mockCloudClient, "findConflictCandidates").mockResolvedValue([
				{
					id: "mem-old",
					content: "Old version",
					type: "decision",
					score: 0.85,
					vt_start: Date.now() - 86400000,
				},
			]);
			spyOn(mockCloudClient, "query").mockResolvedValue([{ vt_end: Number.MAX_SAFE_INTEGER }]);
			spyOn(mockConflictDetector, "detectConflicts").mockResolvedValue([
				{
					candidate: {
						memoryId: "mem-old",
						content: "Old version",
						type: "decision",
						vt_start: Date.now() - 86400000,
						vt_end: Number.MAX_SAFE_INTEGER,
						similarity: 0.85,
					},
					relation: "supersedes",
					confidence: 0.8,
					suggestedAction: "invalidate_old",
					reasoning: "New version supersedes old",
				},
			]);

			await registeredHandler({ content: "New version" });

			expect(mockCloudClient.invalidateMemory).toHaveBeenCalledWith("mem-old", undefined);
			expect(mockConflictAudit.logAutoApplied).toHaveBeenCalled();
		});

		it("should ask for confirmation when elicitation enabled", async () => {
			(mockElicitation as any).enabled = true;
			spyOn(mockElicitation, "confirm").mockResolvedValue({
				accepted: true,
				content: { confirmed: true },
			});

			spyOn(mockCloudClient, "findConflictCandidates").mockResolvedValue([
				{
					id: "mem-old",
					content: "Old version",
					type: "decision",
					score: 0.85,
					vt_start: Date.now() - 86400000,
				},
			]);
			spyOn(mockCloudClient, "query").mockResolvedValue([{ vt_end: Number.MAX_SAFE_INTEGER }]);
			spyOn(mockConflictDetector, "detectConflicts").mockResolvedValue([
				{
					candidate: {
						memoryId: "mem-old",
						content: "Old version",
						type: "decision",
						vt_start: Date.now() - 86400000,
						vt_end: Number.MAX_SAFE_INTEGER,
						similarity: 0.85,
					},
					relation: "supersedes",
					confidence: 0.8,
					suggestedAction: "invalidate_old",
					reasoning: "New version supersedes old",
				},
			]);

			await registeredHandler({ content: "New version" });

			expect(mockElicitation.confirm).toHaveBeenCalled();
			expect(mockCloudClient.invalidateMemory).toHaveBeenCalledWith("mem-old", undefined);
			expect(mockConflictAudit.logUserConfirmed).toHaveBeenCalled();
		});

		it("should keep both memories when user declines invalidation", async () => {
			(mockElicitation as any).enabled = true;
			spyOn(mockElicitation, "confirm").mockResolvedValue({
				accepted: false,
				content: { confirmed: false },
			});

			spyOn(mockCloudClient, "findConflictCandidates").mockResolvedValue([
				{
					id: "mem-old",
					content: "Old version",
					type: "decision",
					score: 0.85,
					vt_start: Date.now() - 86400000,
				},
			]);
			spyOn(mockCloudClient, "query").mockResolvedValue([{ vt_end: Number.MAX_SAFE_INTEGER }]);
			spyOn(mockConflictDetector, "detectConflicts").mockResolvedValue([
				{
					candidate: {
						memoryId: "mem-old",
						content: "Old version",
						type: "decision",
						vt_start: Date.now() - 86400000,
						vt_end: Number.MAX_SAFE_INTEGER,
						similarity: 0.85,
					},
					relation: "contradiction",
					confidence: 0.75,
					suggestedAction: "invalidate_old",
					reasoning: "Contradicting info",
				},
			]);

			await registeredHandler({ content: "New contradicting version" });

			expect(mockCloudClient.invalidateMemory).not.toHaveBeenCalled();
			expect(mockConflictAudit.logUserDeclined).toHaveBeenCalled();
		});

		it("should handle enrichment failure gracefully", async () => {
			spyOn(mockCloudClient, "findConflictCandidates").mockResolvedValue([
				{
					id: "mem-old",
					content: "Old memory",
					type: "fact",
					score: 0.9,
					vt_start: Date.now() - 1000,
				},
			]);
			spyOn(mockCloudClient, "query").mockRejectedValue(new Error("Graph query failed"));

			// Should not throw
			const result = (await registeredHandler({ content: "New memory" })) as any;
			const parsed = JSON.parse(result.content[0].text);

			expect(parsed.stored).toBe(true);
			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	describe("entity extraction", () => {
		let mockExtractor: EntityExtractorService;
		let mockResolver: EntityResolverService;
		let entityExtraction: EntityExtractionOptions;

		beforeEach(() => {
			mockExtractor = {
				extract: mock(async () => ({
					entities: [],
					relationships: [],
					took_ms: 100,
					model_used: "test-model",
				})),
			} as unknown as EntityExtractorService;

			mockResolver = {
				resolveBatch: mock(async () => []),
			} as unknown as EntityResolverService;

			entityExtraction = {
				extractor: mockExtractor,
				resolver: mockResolver,
			};

			registerRememberTool(
				mockServer,
				mockMemoryStore,
				() => defaultContext,
				mockCloudClient,
				mockConflictDetector,
				mockElicitation,
				mockConflictAudit,
				mockLogger,
				entityExtraction,
			);
		});

		it("should extract entities when enabled", async () => {
			spyOn(mockExtractor, "extract").mockResolvedValue({
				entities: [{ name: "PostgreSQL", type: "technology", context: "database choice" }],
				relationships: [],
				took_ms: 150,
				model_used: "gpt-4",
			});
			spyOn(mockResolver, "resolveBatch").mockResolvedValue([
				{
					entity: { id: "entity-1", name: "PostgreSQL", type: "technology", aliases: [] },
					isNew: true,
				},
			]);

			const result = (await registeredHandler({
				content: "We decided to use PostgreSQL for the database",
				type: "decision",
			})) as any;

			expect(mockExtractor.extract).toHaveBeenCalledWith(
				"We decided to use PostgreSQL for the database",
				"decision",
			);

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.entities).toHaveLength(1);
			expect(parsed.entities[0].name).toBe("PostgreSQL");
			expect(parsed.entities[0].isNew).toBe(true);
		});

		it("should create MENTIONS edges for extracted entities", async () => {
			spyOn(mockExtractor, "extract").mockResolvedValue({
				entities: [{ name: "Redis", type: "technology", context: "caching layer" }],
				relationships: [],
				took_ms: 100,
				model_used: "gpt-4",
			});
			spyOn(mockResolver, "resolveBatch").mockResolvedValue([
				{
					entity: { id: "entity-redis", name: "Redis", type: "technology", aliases: [] },
					isNew: false,
				},
			]);

			await registeredHandler({
				content: "Redis is used for caching",
			});

			expect(mockCloudClient.query).toHaveBeenCalledWith(
				expect.stringContaining("CREATE (m)-[:MENTIONS"),
				expect.objectContaining({
					entityId: "entity-redis",
					context: "caching layer",
				}),
				undefined,
			);
		});

		it("should handle entity extraction failure gracefully", async () => {
			spyOn(mockExtractor, "extract").mockRejectedValue(new Error("Extraction failed"));

			// Should not throw
			const result = (await registeredHandler({
				content: "Content with entities",
			})) as any;

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.stored).toBe(true);
			expect(parsed.entities).toBeUndefined();
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it("should create relationships between entities", async () => {
			spyOn(mockExtractor, "extract").mockResolvedValue({
				entities: [
					{ name: "User", type: "entity", context: "user model" },
					{ name: "Session", type: "entity", context: "session model" },
				],
				relationships: [{ from: "User", to: "Session", type: "HAS_MANY" }],
				took_ms: 200,
				model_used: "gpt-4",
			});
			spyOn(mockResolver, "resolveBatch").mockResolvedValue([
				{
					entity: { id: "entity-user", name: "User", type: "entity", aliases: [] },
					isNew: true,
				},
				{
					entity: { id: "entity-session", name: "Session", type: "entity", aliases: [] },
					isNew: true,
				},
			]);

			await registeredHandler({
				content: "User has many sessions",
			});

			// Verify relationship creation query was called
			expect(mockCloudClient.query).toHaveBeenCalledWith(
				expect.stringContaining("MERGE (e1)-[r:HAS_MANY]->(e2)"),
				expect.objectContaining({
					fromId: "entity-user",
					toId: "entity-session",
				}),
				undefined,
			);
		});
	});

	describe("tenant context", () => {
		it("should pass tenant info when orgId and orgSlug present", async () => {
			const contextWithOrg = {
				...defaultContext,
				orgId: "org-123",
				orgSlug: "acme-corp",
			};

			registerRememberTool(
				mockServer,
				mockMemoryStore,
				() => contextWithOrg,
				mockCloudClient,
				mockConflictDetector,
				mockElicitation,
				mockConflictAudit,
				mockLogger,
			);

			await registeredHandler({ content: "Tenant memory" });

			expect(mockMemoryStore.createMemory).toHaveBeenCalledWith(
				expect.objectContaining({
					tenant: { orgId: "org-123", orgSlug: "acme-corp" },
				}),
			);
		});
	});
});
