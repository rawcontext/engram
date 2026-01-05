/**
 * Integration tests for Rehydrator.
 *
 * Tests VFS state reconstruction from snapshots and diffs using real FalkorDB.
 * Run with: RUN_INTEGRATION_TESTS=1 bun test packages/temporal/tests/integration/rehydrator.integration.spec.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { Rehydrator } from "../../src/rehydrator";
import {
	BITEMPORAL,
	cleanupTestGraphData,
	createTestGraphName,
	createTestId,
	createVFSSnapshotBlob,
	getFalkorDBUrl,
	setupTestGraphData,
	shouldRunIntegrationTests,
	startFalkorDBContainer,
	stopAllContainers,
	TestBlobStore,
	TestFalkorClient,
} from "./fixtures";

// Skip all tests if integration tests are not enabled
const runTests = shouldRunIntegrationTests();

describe.skipIf(!runTests)("Rehydrator Integration", () => {
	let graphClient: TestFalkorClient;
	let blobStore: TestBlobStore;
	let rehydrator: Rehydrator;
	const graphName = createTestGraphName();

	beforeAll(async () => {
		await startFalkorDBContainer();
		const url = getFalkorDBUrl();
		graphClient = new TestFalkorClient(url, graphName);
		blobStore = new TestBlobStore();
		rehydrator = new Rehydrator({
			graphClient,
			blobStore,
		});
	});

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

	describe("Snapshot Rehydration", () => {
		it("should rehydrate VFS from a snapshot", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 5000;

			// Create snapshot with files (JSON format for safe UTF-8 storage)
			const snapshotContent = createVFSSnapshotBlob({
				"/src/index.ts": 'console.log("hello");',
				"/README.md": "# Project",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			// Set up graph data
			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [],
				toolCalls: [],
			});

			// Rehydrate
			const vfs = await rehydrator.rehydrate(sessionId, Date.now());

			// Verify files exist
			expect(vfs.exists("/src/index.ts")).toBe(true);
			expect(vfs.exists("/README.md")).toBe(true);
			expect(vfs.readFile("/src/index.ts")).toBe('console.log("hello");');
			expect(vfs.readFile("/README.md")).toBe("# Project");
		});

		it("should return empty VFS when no snapshot exists", async () => {
			const sessionId = createTestId("session");
			const now = Date.now();

			// Create session without snapshot
			await graphClient.query(
				`CREATE (s:Session {
					id: $sessionId,
					vt_start: $vtStart,
					vt_end: $vtEnd,
					tt_start: $ttStart,
					tt_end: $ttEnd
				})`,
				{
					sessionId,
					vtStart: now - 1000,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttStart: now,
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			// Rehydrate
			const vfs = await rehydrator.rehydrate(sessionId, Date.now());

			// VFS should be empty
			expect(vfs.readDir("/")).toHaveLength(0);
		});

		it("should use latest snapshot before target time", async () => {
			const sessionId = createTestId("session");
			const now = Date.now();

			// Create session
			await graphClient.query(
				`CREATE (s:Session {
					id: $sessionId,
					vt_start: $vtStart,
					vt_end: $vtEnd,
					tt_start: $ttStart,
					tt_end: $ttEnd
				})`,
				{
					sessionId,
					vtStart: now - 10000,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttStart: now,
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			// Create old snapshot (should be used)
			const oldSnapshotContent = createVFSSnapshotBlob({
				"/file.txt": "old content",
			});
			const oldBlobRef = await blobStore.save(oldSnapshotContent);

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
					snapId: createTestId("snap"),
					blobRef: oldBlobRef,
					snapshotTime: now - 5000,
					vtStart: now - 5000,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttStart: now,
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			// Create newer snapshot (should NOT be used for time travel to past)
			const newSnapshotContent = createVFSSnapshotBlob({
				"/file.txt": "new content",
			});
			const newBlobRef = await blobStore.save(newSnapshotContent);

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
					snapId: createTestId("snap"),
					blobRef: newBlobRef,
					snapshotTime: now - 1000, // More recent
					vtStart: now - 1000,
					vtEnd: BITEMPORAL.VT_INFINITY,
					ttStart: now,
					ttEnd: BITEMPORAL.TT_INFINITY,
				},
			);

			// Rehydrate to time before newer snapshot
			const targetTime = now - 3000;
			const vfs = await rehydrator.rehydrate(sessionId, targetTime);

			// Should use the older snapshot
			expect(vfs.readFile("/file.txt")).toBe("old content");
		});
	});

	describe("Diff Application", () => {
		it("should apply diffs after snapshot", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 10000;

			// Create snapshot with initial file
			const snapshotContent = createVFSSnapshotBlob({
				"/src/app.ts": "// initial",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			// Create diff that adds content
			const diffPatch = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,1 +1,2 @@
 // initial
+const app = "hello";
`;

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [
					{
						filePath: "/src/app.ts",
						patchContent: diffPatch,
						vtStart: snapshotTime + 1000,
					},
				],
				toolCalls: [],
			});

			// Rehydrate
			const vfs = await rehydrator.rehydrate(sessionId, Date.now());

			// Verify diff was applied
			const content = vfs.readFile("/src/app.ts");
			expect(content).toContain("// initial");
			expect(content).toContain('const app = "hello"');
		});

		it("should apply multiple diffs in order", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 10000;

			// Create empty snapshot
			const snapshotContent = createVFSSnapshotBlob({
				"/file.txt": "line1",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			// Create multiple diffs
			const diff1 = `--- a/file.txt
+++ b/file.txt
@@ -1,1 +1,2 @@
 line1
+line2
`;
			const diff2 = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,3 @@
 line1
 line2
+line3
`;

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [
					{ filePath: "/file.txt", patchContent: diff1, vtStart: snapshotTime + 1000 },
					{ filePath: "/file.txt", patchContent: diff2, vtStart: snapshotTime + 2000 },
				],
				toolCalls: [],
			});

			// Rehydrate
			const vfs = await rehydrator.rehydrate(sessionId, Date.now());

			// Verify all diffs were applied
			const content = vfs.readFile("/file.txt");
			expect(content).toContain("line1");
			expect(content).toContain("line2");
			expect(content).toContain("line3");
		});

		it("should only apply diffs up to target time", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 10000;

			// Create snapshot
			const snapshotContent = createVFSSnapshotBlob({
				"/file.txt": "initial",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			// Create diff at specific time
			const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,1 +1,1 @@
-initial
+modified
`;

			const diffTime = snapshotTime + 5000;

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [{ filePath: "/file.txt", patchContent: diff, vtStart: diffTime }],
				toolCalls: [],
			});

			// Rehydrate to time BEFORE diff
			const vfs = await rehydrator.rehydrate(sessionId, diffTime - 1000);

			// Diff should NOT be applied
			expect(vfs.readFile("/file.txt")).toBe("initial");
		});

		it("should handle patch failures gracefully", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 10000;

			// Create snapshot with two files
			const snapshotContent = createVFSSnapshotBlob({
				"/file.txt": "completely different content",
				"/other.txt": "line1",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			// Create a bad diff that won't apply (wrong context)
			const badDiff = `--- a/file.txt
+++ b/file.txt
@@ -1,1 +1,2 @@
 nonexistent line
+new line
`;

			// Create a good diff that will apply
			const goodDiff = `--- a/other.txt
+++ b/other.txt
@@ -1,1 +1,2 @@
 line1
+line2
`;

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [
					{ filePath: "/file.txt", patchContent: badDiff, vtStart: snapshotTime + 1000 },
					{ filePath: "/other.txt", patchContent: goodDiff, vtStart: snapshotTime + 2000 },
				],
				toolCalls: [],
			});

			// Should not throw for partial failures (only 1 of 2 patches failed)
			const vfs = await rehydrator.rehydrate(sessionId, Date.now());

			// Original content should remain for failed patch
			expect(vfs.readFile("/file.txt")).toBe("completely different content");
			// Good patch should be applied
			expect(vfs.readFile("/other.txt")).toContain("line1");
			expect(vfs.readFile("/other.txt")).toContain("line2");
		});
	});

	describe("Error Handling", () => {
		it("should handle nonexistent session gracefully", async () => {
			const sessionId = "nonexistent-session-12345";

			// Rehydrate nonexistent session
			const vfs = await rehydrator.rehydrate(sessionId, Date.now());

			// Should return empty VFS
			expect(vfs.readDir("/")).toHaveLength(0);
		});

		it("should throw RehydrationError for corrupted blob", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 5000;

			// Create snapshot with corrupted blob
			const corruptedBlobRef = await blobStore.save("not valid gzip or json");

			// Set up graph data with corrupted snapshot
			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef: corruptedBlobRef,
				snapshotTime,
				diffs: [],
				toolCalls: [],
			});

			// Should throw RehydrationError
			await expect(rehydrator.rehydrate(sessionId, Date.now())).rejects.toThrow(
				/Failed to load VFS snapshot/,
			);
		});
	});
});
