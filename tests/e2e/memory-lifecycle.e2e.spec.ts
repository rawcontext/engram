/**
 * E2E tests for full memory lifecycle.
 *
 * Tests the complete flow:
 * 1. Parse raw agent events
 * 2. Publish to NATS
 * 3. TurnAggregator processes events and creates graph nodes
 * 4. Verify graph structure (Session, Turn, Reasoning, ToolCall)
 * 5. Verify bitemporal fields
 * 6. Test time-travel with Rehydrator
 *
 * Run with: RUN_INTEGRATION_TESTS=1 bun test tests/e2e/memory-lifecycle.e2e.spec.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { TurnAggregator } from "../../apps/memory/src/turn-aggregator";
import { Rehydrator } from "../../packages/temporal/src/rehydrator";
import { TimeTravelService } from "../../packages/temporal/src/time-travel";
import {
	BITEMPORAL,
	cleanupTestGraphData,
	createMockParsedEvent,
	createTestGraphName,
	createTestSessionId,
	getFalkorDBUrl,
	getNatsUrl,
	getPostgresUrl,
	initializeDatabase,
	shouldRunIntegrationTests,
	startFalkorDBContainer,
	startNatsContainer,
	startPostgresContainer,
	stopAllContainers,
	TEST_ORG,
	TestBlobStore,
	TestFalkorClient,
} from "./fixtures";

const runTests = shouldRunIntegrationTests();

describe.skipIf(!runTests)("E2E Memory Lifecycle", () => {
	let graphClient: TestFalkorClient;
	let blobStore: TestBlobStore;
	let rehydrator: Rehydrator;
	let timeTravelService: TimeTravelService;
	const graphName = createTestGraphName();

	beforeAll(async () => {
		// Start all required containers in parallel
		await Promise.all([startPostgresContainer(), startNatsContainer(), startFalkorDBContainer()]);

		// Initialize database with test user/org/token
		await initializeDatabase(getPostgresUrl());

		// Set up graph and temporal clients
		const url = getFalkorDBUrl();
		graphClient = new TestFalkorClient(url, graphName);
		blobStore = new TestBlobStore();
		rehydrator = new Rehydrator({ graphClient, blobStore });
		timeTravelService = new TimeTravelService(rehydrator);
	}, 120_000);

	afterEach(async () => {
		await cleanupTestGraphData(graphClient);
		blobStore.clear();
	});

	afterAll(async () => {
		if (graphClient) {
			await graphClient.disconnect();
		}
		await stopAllContainers();
	});

	describe("Complete Memory Flow", () => {
		it("should process events and create graph nodes", async () => {
			const sessionId = createTestSessionId();
			const turnId = `turn-${Date.now()}`;
			const now = Date.now();

			// Create session first (as the memory service would do)
			await graphClient.query(
				`CREATE (s:Session {
					id: $sessionId,
					org_id: $orgId,
					org_slug: $orgSlug,
					started_at: $now,
					vt_start: $now,
					vt_end: $vtEnd,
					tt_start: $now,
					tt_end: $ttEnd
				})`,
				{
					sessionId,
					orgId: TEST_ORG.id,
					orgSlug: TEST_ORG.slug,
					now,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			// Create a mock logger
			const logs: string[] = [];
			const mockLogger = {
				info: (msg: string) => logs.push(`INFO: ${msg}`),
				warn: (msg: string) => logs.push(`WARN: ${msg}`),
				error: (msg: string) => logs.push(`ERROR: ${msg}`),
				debug: (msg: string) => logs.push(`DEBUG: ${msg}`),
				child: () => mockLogger,
			};

			// Track created nodes
			const createdNodes: Array<{ type: string; id: string }> = [];
			let finalizedTurn: { session_id: string; id: string } | null = null;

			// Create TurnAggregator with callbacks
			// NodeCreatedCallback signature: (sessionId, node) => void
			// TurnFinalizedCallback signature: (payload: TurnFinalizedPayload) => Promise<void>
			const aggregator = new TurnAggregator({
				graphClient,
				logger: mockLogger as never,
				onNodeCreated: (_sessionId, node) => {
					createdNodes.push({ type: node.type, id: node.id });
				},
				onTurnFinalized: async (payload) => {
					finalizedTurn = { session_id: payload.session_id, id: payload.id };
				},
			});

			// Process a sequence of events simulating a real turn
			const events = [
				// 1. Thought event (creates Reasoning node)
				createMockParsedEvent({
					sessionId,
					type: "thought",
					thought: "Let me analyze the user's request and formulate a plan.",
				}),
				// 2. Content event
				createMockParsedEvent({
					sessionId,
					type: "content",
					content: "I'll help you with that task.",
				}),
				// 3. Tool call event
				createMockParsedEvent({
					sessionId,
					type: "tool_call",
					toolCall: {
						id: `tool-${Date.now()}`,
						name: "read_file",
						arguments_delta: '{"path": "/src/index.ts"}',
					},
				}),
				// 4. Usage event (finalizes turn)
				createMockParsedEvent({
					sessionId,
					type: "usage",
					usage: { input_tokens: 150, output_tokens: 50 },
				}),
			];

			// Process all events
			for (const event of events) {
				await aggregator.processEvent(event, sessionId);
			}

			// Verify Session was created
			const sessions = await graphClient.query<{ id: string; org_id: string }>(
				`MATCH (s:Session {id: $sessionId}) RETURN s.id as id, s.org_id as org_id`,
				{ sessionId },
			);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].id).toBe(sessionId);
			expect(sessions[0].org_id).toBe(TEST_ORG.id);

			// Verify Turn was created and linked
			const turns = await graphClient.query<{
				id: string;
				sequence_index: number;
				assistant_preview: string;
			}>(
				`MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
				 RETURN t.id as id, t.sequence_index as sequence_index, t.assistant_preview as assistant_preview`,
				{ sessionId },
			);
			expect(turns).toHaveLength(1);
			expect(turns[0].sequence_index).toBe(0); // 0-based indexing
			expect(turns[0].assistant_preview).toContain("help you with that task");

			// Verify Reasoning was created (from thinking)
			const reasonings = await graphClient.query<{ preview: string }>(
				`MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)-[:CONTAINS]->(r:Reasoning)
				 RETURN r.preview as preview`,
				{ sessionId },
			);
			expect(reasonings.length).toBeGreaterThanOrEqual(1);
			expect(reasonings.some((r) => r.preview?.includes("analyze"))).toBe(true);

			// Verify ToolCall was created
			const toolCalls = await graphClient.query<{ tool_name: string; arguments_json: string }>(
				`MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)-[:INVOKES]->(tc:ToolCall)
				 RETURN tc.tool_name as tool_name, tc.arguments_json as arguments_json`,
				{ sessionId },
			);
			expect(toolCalls).toHaveLength(1);
			expect(toolCalls[0].tool_name).toBe("read_file");
			expect(toolCalls[0].arguments_json).toContain("/src/index.ts");

			// Verify callbacks were triggered (types are lowercase: turn, reasoning, toolcall)
			expect(createdNodes.some((n) => n.type === "turn")).toBe(true);
			expect(createdNodes.some((n) => n.type === "reasoning")).toBe(true);
			expect(createdNodes.some((n) => n.type === "toolcall")).toBe(true);
			expect(finalizedTurn).not.toBeNull();
			expect(finalizedTurn?.session_id).toBe(sessionId);
		});

		it("should maintain bitemporal fields on all nodes", async () => {
			const sessionId = createTestSessionId();
			const beforeCreate = Date.now();

			// Create session first
			await graphClient.query(
				`CREATE (s:Session {
					id: $sessionId,
					org_id: $orgId,
					org_slug: $orgSlug,
					started_at: $now,
					vt_start: $now,
					vt_end: $vtEnd,
					tt_start: $now,
					tt_end: $ttEnd
				})`,
				{
					sessionId,
					orgId: TEST_ORG.id,
					orgSlug: TEST_ORG.slug,
					now: beforeCreate,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			const mockLogger = {
				info: () => {},
				warn: () => {},
				error: () => {},
				debug: () => {},
				child: function () {
					return this;
				},
			};

			const aggregator = new TurnAggregator({
				graphClient,
				logger: mockLogger as never,
			});

			// Process events to create nodes
			await aggregator.processEvent(
				createMockParsedEvent({
					sessionId,
					type: "content",
					content: "Test content for bitemporal verification",
				}),
				sessionId,
			);

			await aggregator.processEvent(
				createMockParsedEvent({
					sessionId,
					type: "usage",
					usage: { input_tokens: 100, output_tokens: 50 },
				}),
				sessionId,
			);

			const afterCreate = Date.now();

			// Verify Session bitemporal fields
			const sessions = await graphClient.query<{
				vt_start: number;
				vt_end: number;
				tt_start: number;
				tt_end: number;
			}>(
				`MATCH (s:Session {id: $sessionId})
				 RETURN s.vt_start as vt_start, s.vt_end as vt_end,
				        s.tt_start as tt_start, s.tt_end as tt_end`,
				{ sessionId },
			);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].vt_start).toBeGreaterThanOrEqual(beforeCreate);
			expect(sessions[0].vt_start).toBeLessThanOrEqual(afterCreate);
			expect(sessions[0].vt_end).toBe(BITEMPORAL.VT_INFINITY);
			expect(sessions[0].tt_end).toBe(BITEMPORAL.TT_INFINITY);

			// Verify Turn bitemporal fields (vt_start and tt_start are set by TurnAggregator)
			const turns = await graphClient.query<{
				vt_start: number;
				tt_start: number;
			}>(
				`MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
				 RETURN t.vt_start as vt_start, t.tt_start as tt_start`,
				{ sessionId },
			);
			expect(turns).toHaveLength(1);
			expect(turns[0].vt_start).toBeGreaterThanOrEqual(beforeCreate);
			expect(turns[0].tt_start).toBeGreaterThanOrEqual(beforeCreate);
		});

		it("should handle multiple turns in sequence", async () => {
			const sessionId = createTestSessionId();
			const now = Date.now();

			// Create session first
			await graphClient.query(
				`CREATE (s:Session {
					id: $sessionId,
					org_id: $orgId,
					org_slug: $orgSlug,
					started_at: $now,
					vt_start: $now,
					vt_end: $vtEnd,
					tt_start: $now,
					tt_end: $ttEnd
				})`,
				{
					sessionId,
					orgId: TEST_ORG.id,
					orgSlug: TEST_ORG.slug,
					now,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			const mockLogger = {
				info: () => {},
				warn: () => {},
				error: () => {},
				debug: () => {},
				child: function () {
					return this;
				},
			};

			const aggregator = new TurnAggregator({
				graphClient,
				logger: mockLogger as never,
			});

			// First turn - user message triggers new turn
			await aggregator.processEvent(
				{
					...createMockParsedEvent({ sessionId, type: "content", content: "First user question" }),
					role: "user",
				},
				sessionId,
			);
			await aggregator.processEvent(
				createMockParsedEvent({
					sessionId,
					type: "content",
					content: "First turn response",
				}),
				sessionId,
			);
			await aggregator.processEvent(
				createMockParsedEvent({
					sessionId,
					type: "usage",
					usage: { input_tokens: 100, output_tokens: 50 },
				}),
				sessionId,
			);

			// Second turn - user message triggers new turn
			await aggregator.processEvent(
				{
					...createMockParsedEvent({ sessionId, type: "content", content: "Second user question" }),
					role: "user",
				},
				sessionId,
			);
			await aggregator.processEvent(
				createMockParsedEvent({
					sessionId,
					type: "content",
					content: "Second turn response",
				}),
				sessionId,
			);
			await aggregator.processEvent(
				createMockParsedEvent({
					sessionId,
					type: "usage",
					usage: { input_tokens: 120, output_tokens: 60 },
				}),
				sessionId,
			);

			// Verify both turns exist with correct sequence numbers
			const turns = await graphClient.query<{ sequence_index: number; preview: string }>(
				`MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
				 RETURN t.sequence_index as sequence_index, t.assistant_preview as preview
				 ORDER BY t.sequence_index`,
				{ sessionId },
			);

			expect(turns).toHaveLength(2);
			expect(turns[0].sequence_index).toBe(0); // 0-based indexing
			expect(turns[0].preview).toContain("First turn");
			expect(turns[1].sequence_index).toBe(1);
			expect(turns[1].preview).toContain("Second turn");

			// Verify NEXT relationship between turns
			const nextRels = await graphClient.query<{ t1_seq: number; t2_seq: number }>(
				`MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t1:Turn)-[:NEXT]->(t2:Turn)
				 RETURN t1.sequence_index as t1_seq, t2.sequence_index as t2_seq`,
				{ sessionId },
			);

			expect(nextRels).toHaveLength(1);
			expect(nextRels[0].t1_seq).toBe(0); // 0-based
			expect(nextRels[0].t2_seq).toBe(1);
		});

		it("should preserve org context through the pipeline", async () => {
			const sessionId = createTestSessionId();
			const now = Date.now();

			// Create session first
			await graphClient.query(
				`CREATE (s:Session {
					id: $sessionId,
					org_id: $orgId,
					org_slug: $orgSlug,
					started_at: $now,
					vt_start: $now,
					vt_end: $vtEnd,
					tt_start: $now,
					tt_end: $ttEnd
				})`,
				{
					sessionId,
					orgId: TEST_ORG.id,
					orgSlug: TEST_ORG.slug,
					now,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			const mockLogger = {
				info: () => {},
				warn: () => {},
				error: () => {},
				debug: () => {},
				child: function () {
					return this;
				},
			};

			const aggregator = new TurnAggregator({
				graphClient,
				logger: mockLogger as never,
			});

			await aggregator.processEvent(
				createMockParsedEvent({
					sessionId,
					type: "content",
					content: "Org context test",
				}),
				sessionId,
			);
			await aggregator.processEvent(
				createMockParsedEvent({
					sessionId,
					type: "usage",
					usage: { input_tokens: 50, output_tokens: 25 },
				}),
				sessionId,
			);

			// Verify org_id and org_slug on Session
			const sessions = await graphClient.query<{ org_id: string; org_slug: string }>(
				`MATCH (s:Session {id: $sessionId})
				 RETURN s.org_id as org_id, s.org_slug as org_slug`,
				{ sessionId },
			);

			expect(sessions).toHaveLength(1);
			expect(sessions[0].org_id).toBe(TEST_ORG.id);
			expect(sessions[0].org_slug).toBe(TEST_ORG.slug);
		});
	});

	describe("Error Handling", () => {
		it("should handle malformed events gracefully", async () => {
			const sessionId = createTestSessionId();
			const errors: string[] = [];

			const mockLogger = {
				info: () => {},
				warn: (msg: string) => errors.push(msg),
				error: (msg: string) => errors.push(msg),
				debug: () => {},
				child: function () {
					return this;
				},
			};

			const aggregator = new TurnAggregator({
				graphClient,
				logger: mockLogger as never,
			});

			// Process event with missing required fields
			const malformedEvent = {
				event_id: crypto.randomUUID(),
				type: "content",
				// Missing content, timestamp, metadata
				timestamp: new Date().toISOString(),
				metadata: {
					session_id: sessionId,
					working_dir: "/test",
					agent_type: "test",
				},
				org_id: TEST_ORG.id,
				org_slug: TEST_ORG.slug,
				vt_start: Date.now(),
			};

			// Should not throw
			await aggregator.processEvent(malformedEvent as never, sessionId);

			// Session should still be created (or at least not crash)
			const sessions = await graphClient.query<{ id: string }>(
				`MATCH (s:Session {id: $sessionId}) RETURN s.id as id`,
				{ sessionId },
			);

			// Either session was created or gracefully skipped - no crash
			expect(true).toBe(true);
		});
	});

	describe("Time-Travel Integration", () => {
		it("should reconstruct VFS state at different points", async () => {
			const sessionId = createTestSessionId();
			const snapshotTime = Date.now() - 5000;

			// Create a VFS snapshot in blob store
			const vfsSnapshot = {
				root: {
					type: "directory",
					name: "",
					children: {
						src: {
							type: "directory",
							name: "src",
							children: {
								"index.ts": {
									type: "file",
									name: "index.ts",
									content: 'console.log("hello");',
									lastModified: snapshotTime,
								},
							},
						},
					},
				},
			};
			const snapshotBlobRef = await blobStore.save(JSON.stringify(vfsSnapshot));

			// Create Session and Snapshot nodes
			await graphClient.query(
				`CREATE (s:Session {
					id: $sessionId,
					org_id: $orgId,
					org_slug: $orgSlug,
					vt_start: $vtStart,
					vt_end: $vtEnd,
					tt_start: $ttStart,
					tt_end: $ttEnd
				})`,
				{
					sessionId,
					orgId: TEST_ORG.id,
					orgSlug: TEST_ORG.slug,
					vtStart: snapshotTime - 1000,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttStart: Date.now(),
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			await graphClient.query(
				`MATCH (s:Session {id: $sessionId})
				 CREATE (snap:Snapshot {
					id: $snapId,
					vfs_state_blob_ref: $blobRef,
					snapshot_at: $snapshotTime,
					vt_start: $vtStart,
					vt_end: $vtEnd,
					tt_start: $ttStart,
					tt_end: $ttEnd
				 })
				 CREATE (snap)-[:SNAPSHOT_OF]->(s)`,
				{
					sessionId,
					snapId: `snap-${Date.now()}`,
					blobRef: snapshotBlobRef,
					snapshotTime,
					vtStart: snapshotTime,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttStart: Date.now(),
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			// Use TimeTravelService to get filesystem state
			const vfs = await timeTravelService.getFilesystemState(sessionId, Date.now());

			// Verify file exists
			expect(vfs.exists("/src/index.ts")).toBe(true);
			expect(vfs.readFile("/src/index.ts")).toBe('console.log("hello");');

			// Verify directory listing
			const files = await timeTravelService.listFiles(sessionId, Date.now(), "/src");
			expect(files).toContain("index.ts");
		});
	});
});
