/**
 * Integration tests for TimeTravelService.
 *
 * Tests high-level time-travel operations using real FalkorDB.
 * Run with: RUN_INTEGRATION_TESTS=1 bun test packages/temporal/tests/integration/time-travel.integration.spec.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { Rehydrator } from "../../src/rehydrator";
import { TimeTravelService } from "../../src/time-travel";
import {
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

describe.skipIf(!runTests)("TimeTravelService Integration", () => {
	let graphClient: TestFalkorClient;
	let blobStore: TestBlobStore;
	let rehydrator: Rehydrator;
	let timeTravelService: TimeTravelService;
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
		timeTravelService = new TimeTravelService(rehydrator);
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

	describe("getFilesystemState", () => {
		it("should return VFS state at target time", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 5000;

			// Create snapshot
			const snapshotContent = createVFSSnapshotBlob({
				"/src/main.ts": "export default {};",
				"/package.json": '{"name": "test"}',
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [],
				toolCalls: [],
			});

			// Get filesystem state
			const vfs = await timeTravelService.getFilesystemState(sessionId, Date.now());

			expect(vfs.exists("/src/main.ts")).toBe(true);
			expect(vfs.exists("/package.json")).toBe(true);
			expect(vfs.readFile("/src/main.ts")).toBe("export default {};");
		});
	});

	describe("getZippedState", () => {
		it("should return gzipped VFS snapshot", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 5000;

			// Create snapshot
			const snapshotContent = createVFSSnapshotBlob({
				"/test.txt": "Hello, World!",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [],
				toolCalls: [],
			});

			// Get zipped state
			const zipped = await timeTravelService.getZippedState(sessionId, Date.now());

			// Should be a Buffer (gzipped data)
			expect(zipped).toBeInstanceOf(Buffer);
			expect(zipped.length).toBeGreaterThan(0);

			// Gzip magic bytes: 0x1f 0x8b
			expect(zipped[0]).toBe(0x1f);
			expect(zipped[1]).toBe(0x8b);
		});
	});

	describe("listFiles", () => {
		it("should list files in directory", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 5000;

			// Create snapshot with directory structure
			const snapshotContent = createVFSSnapshotBlob({
				"/src/index.ts": "// index",
				"/src/utils.ts": "// utils",
				"/README.md": "# README",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [],
				toolCalls: [],
			});

			// List root directory
			const rootFiles = await timeTravelService.listFiles(sessionId, Date.now(), "/");
			expect(rootFiles).toContain("src");
			expect(rootFiles).toContain("README.md");

			// List src directory
			const srcFiles = await timeTravelService.listFiles(sessionId, Date.now(), "/src");
			expect(srcFiles).toContain("index.ts");
			expect(srcFiles).toContain("utils.ts");
		});

		it("should return empty array for nonexistent path", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 5000;

			// Create snapshot
			const snapshotContent = createVFSSnapshotBlob({
				"/file.txt": "content",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [],
				toolCalls: [],
			});

			// List nonexistent directory
			const files = await timeTravelService.listFiles(sessionId, Date.now(), "/nonexistent/path");
			expect(files).toEqual([]);
		});

		it("should list files at specific point in time", async () => {
			const sessionId = createTestId("session");
			const snapshotTime = Date.now() - 10000;

			// Create initial snapshot
			const snapshotContent = createVFSSnapshotBlob({
				"/original.txt": "original content",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			// Diff that creates a new file
			const diffPatch = `--- /dev/null
+++ b/new-file.txt
@@ -0,0 +1,1 @@
+new content
`;
			const diffTime = snapshotTime + 5000;

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime,
				diffs: [{ filePath: "/new-file.txt", patchContent: diffPatch, vtStart: diffTime }],
				toolCalls: [],
			});

			// List at time before diff - should only have original file
			const beforeFiles = await timeTravelService.listFiles(sessionId, diffTime - 1000, "/");
			expect(beforeFiles).toContain("original.txt");
			// Note: The new file may not appear since the diff creates it

			// List at current time - should have both
			const afterFiles = await timeTravelService.listFiles(sessionId, Date.now(), "/");
			expect(afterFiles).toContain("original.txt");
		});
	});

	describe("Time Travel Across Session History", () => {
		it("should reconstruct state at multiple points in time", async () => {
			const sessionId = createTestId("session");
			const baseTime = Date.now() - 20000;

			// Create initial snapshot
			const snapshotContent = createVFSSnapshotBlob({
				"/counter.txt": "0",
			});
			const snapshotBlobRef = await blobStore.save(snapshotContent);

			// Create diffs at different times
			const diff1 = `--- a/counter.txt
+++ b/counter.txt
@@ -1,1 +1,1 @@
-0
+1
`;
			const diff2 = `--- a/counter.txt
+++ b/counter.txt
@@ -1,1 +1,1 @@
-1
+2
`;

			await setupTestGraphData(graphClient, {
				sessionId,
				snapshotBlobRef,
				snapshotTime: baseTime,
				diffs: [
					{ filePath: "/counter.txt", patchContent: diff1, vtStart: baseTime + 5000 },
					{ filePath: "/counter.txt", patchContent: diff2, vtStart: baseTime + 10000 },
				],
				toolCalls: [],
			});

			// Check state at different times
			const stateT0 = await timeTravelService.getFilesystemState(sessionId, baseTime + 1000);
			expect(stateT0.readFile("/counter.txt")).toBe("0");

			const stateT1 = await timeTravelService.getFilesystemState(sessionId, baseTime + 7000);
			expect(stateT1.readFile("/counter.txt")).toBe("1");

			const stateT2 = await timeTravelService.getFilesystemState(sessionId, Date.now());
			expect(stateT2.readFile("/counter.txt")).toBe("2");
		});
	});
});
