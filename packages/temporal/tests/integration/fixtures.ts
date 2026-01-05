/**
 * Integration test fixtures for Temporal package.
 *
 * Sets up FalkorDB with graph data for testing time-travel operations.
 */

import type { BlobStore, GraphClient } from "@engram/storage";
import { FalkorDB, type Graph } from "falkordb";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

// Container instances (session-scoped)
let falkordbContainer: StartedTestContainer | null = null;
let usingDevContainers = false;

/**
 * Check if integration tests should run.
 */
export function shouldRunIntegrationTests(): boolean {
	return process.env.RUN_INTEGRATION_TESTS === "1";
}

/**
 * Check if we should use testcontainers or existing dev containers.
 */
export function shouldUseTestcontainers(): boolean {
	return process.env.USE_TESTCONTAINERS === "1";
}

// =============================================================================
// FalkorDB Fixtures
// =============================================================================

export async function startFalkorDBContainer(): Promise<StartedTestContainer | null> {
	if (falkordbContainer) {
		return falkordbContainer;
	}

	if (!shouldUseTestcontainers()) {
		usingDevContainers = true;
		console.log("Using existing dev FalkorDB container at localhost:6179");
		return null;
	}

	falkordbContainer = await new GenericContainer("falkordb/falkordb:latest")
		.withExposedPorts(6379)
		.withWaitStrategy(Wait.forListeningPorts())
		.withStartupTimeout(60_000)
		.start();

	return falkordbContainer;
}

export function getFalkorDBUrl(): string {
	if (usingDevContainers || !shouldUseTestcontainers()) {
		return "redis://localhost:6179";
	}
	if (!falkordbContainer) {
		throw new Error("FalkorDB container not started");
	}
	const host = falkordbContainer.getHost();
	const port = falkordbContainer.getMappedPort(6379);
	return `redis://${host}:${port}`;
}

export async function stopAllContainers(): Promise<void> {
	if (!shouldUseTestcontainers()) {
		console.log("Using dev containers - nothing to stop");
		return;
	}

	if (falkordbContainer) {
		await falkordbContainer.stop();
		falkordbContainer = null;
	}
}

/**
 * Test-specific FalkorDB client implementing GraphClient interface.
 */
export class TestFalkorClient implements GraphClient {
	private db: FalkorDB | null = null;
	private graph: Graph | null = null;
	private connected = false;
	private url: string;
	private graphName: string;

	constructor(url: string, graphName: string) {
		this.url = url;
		this.graphName = graphName;
	}

	async connect(): Promise<void> {
		if (this.connected && this.db) return;

		const urlObj = new URL(this.url);
		this.db = await FalkorDB.connect({
			username: urlObj.username,
			password: urlObj.password,
			socket: {
				host: urlObj.hostname,
				port: Number(urlObj.port) || 6379,
			},
		});
		this.graph = this.db.selectGraph(this.graphName);
		this.connected = true;
	}

	isConnected(): boolean {
		return this.connected && this.db !== null;
	}

	async query<T = Record<string, unknown>>(
		cypher: string,
		params: Record<string, unknown> = {},
	): Promise<T[]> {
		if (!this.graph) await this.connect();
		if (!this.graph) throw new Error("Graph connection failed");
		const result = await this.graph.query(cypher, { params });
		return result.data as T[];
	}

	async disconnect(): Promise<void> {
		try {
			if (this.db) {
				await this.db.close();
			}
		} finally {
			this.db = null;
			this.graph = null;
			this.connected = false;
		}
	}
}

// =============================================================================
// Blob Store Fixtures
// =============================================================================

/**
 * In-memory blob store for testing.
 * Stores binary data as base64 to preserve integrity.
 */
export class TestBlobStore implements BlobStore {
	private blobs: Map<string, Buffer> = new Map();

	async save(content: string | Buffer): Promise<string> {
		const buffer = typeof content === "string" ? Buffer.from(content) : content;
		const hasher = new Bun.CryptoHasher("sha256");
		hasher.update(buffer);
		const hash = hasher.digest("hex");
		const uri = `test://${hash}`;
		this.blobs.set(uri, buffer);
		return uri;
	}

	async load(uri: string): Promise<string> {
		const buffer = this.blobs.get(uri);
		if (!buffer) {
			throw new Error(`Blob not found: ${uri}`);
		}
		// Return as string for compatibility with BlobStore interface
		// The rehydrator will handle gzipped vs JSON detection
		return buffer.toString("utf-8");
	}

	async loadBuffer(uri: string): Promise<Buffer> {
		const buffer = this.blobs.get(uri);
		if (!buffer) {
			throw new Error(`Blob not found: ${uri}`);
		}
		return buffer;
	}

	clear(): void {
		this.blobs.clear();
	}

	set(uri: string, content: string | Buffer): void {
		const buffer = typeof content === "string" ? Buffer.from(content) : content;
		this.blobs.set(uri, buffer);
	}
}

// =============================================================================
// Test Data Helpers
// =============================================================================

/**
 * Generate a unique test ID.
 */
export function createTestId(prefix = "test"): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a unique graph name for test isolation.
 */
export function createTestGraphName(): string {
	return `test_temporal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Bitemporal timestamp constants.
 */
export const BITEMPORAL = {
	/** Transaction time end value for current/valid records */
	TT_INFINITY: 253402300799000, // Year 9999
	/** Valid time end for records that never expire */
	VT_INFINITY: 253402300799000,
};

/**
 * Create a VFS snapshot blob content as JSON.
 * Returns JSON string (not gzipped) for safe UTF-8 storage in test blob stores.
 *
 * The structure matches VFS DirectoryNode format:
 * { root: { type: "directory", name: "", children: { ... } } }
 */
export function createVFSSnapshotBlob(files: Record<string, string>): string {
	const now = Date.now();

	// Create proper VFS DirectoryNode structure
	interface DirNode {
		type: "directory";
		name: string;
		children: Record<string, DirNode | FileNode>;
	}
	interface FileNode {
		type: "file";
		name: string;
		content: string;
		lastModified: number;
	}

	const root: DirNode = { type: "directory", name: "", children: {} };

	for (const [filePath, content] of Object.entries(files)) {
		const parts = filePath.split("/").filter(Boolean);
		let current: DirNode = root;

		// Create directory structure
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			if (!current.children[part]) {
				current.children[part] = { type: "directory", name: part, children: {} };
			}
			current = current.children[part] as DirNode;
		}

		// Add file node
		const fileName = parts[parts.length - 1];
		current.children[fileName] = {
			type: "file",
			name: fileName,
			content,
			lastModified: now,
		};
	}

	// Return JSON that rehydrator's fallback path can use
	const snapshot = { root };
	return JSON.stringify(snapshot);
}

/**
 * Create a simple unified diff patch.
 */
export function createUnifiedDiff(
	filePath: string,
	oldContent: string,
	newContent: string,
): string {
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");

	let diff = `--- a/${filePath}\n+++ b/${filePath}\n`;
	diff += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

	for (const line of oldLines) {
		diff += `-${line}\n`;
	}
	for (const line of newLines) {
		diff += `+${line}\n`;
	}

	return diff;
}

/**
 * Test fixture for setting up graph data.
 */
export interface TestGraphData {
	sessionId: string;
	snapshotBlobRef: string;
	snapshotTime: number;
	diffs: Array<{
		filePath: string;
		patchContent: string;
		vtStart: number;
	}>;
	toolCalls: Array<{
		id: string;
		name: string;
		arguments: string;
		result: string;
		vtStart: number;
	}>;
}

/**
 * Set up test graph data in FalkorDB.
 */
export async function setupTestGraphData(
	graphClient: GraphClient,
	data: TestGraphData,
): Promise<void> {
	const { sessionId, snapshotBlobRef, snapshotTime, diffs, toolCalls } = data;
	const now = Date.now();

	// Create Session node
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
			vtStart: snapshotTime - 1000,
			vtEnd: BITEMPORAL.VT_INFINITY,
			ttStart: now,
			ttEnd: BITEMPORAL.TT_INFINITY,
		},
	);

	// Create Snapshot node linked to Session
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
			blobRef: snapshotBlobRef,
			snapshotTime,
			vtStart: snapshotTime,
			vtEnd: BITEMPORAL.VT_INFINITY,
			ttStart: now,
			ttEnd: BITEMPORAL.TT_INFINITY,
		},
	);

	// Create initial Thought node linked to Session
	const thoughtId = createTestId("thought");
	await graphClient.query(
		`MATCH (s:Session {id: $sessionId})
		 CREATE (t:Thought {
			id: $thoughtId,
			vt_start: $vtStart,
			vt_end: $vtEnd,
			tt_start: $ttStart,
			tt_end: $ttEnd
		 })
		 CREATE (s)-[:TRIGGERS]->(t)`,
		{
			sessionId,
			thoughtId,
			vtStart: snapshotTime,
			vtEnd: BITEMPORAL.VT_INFINITY,
			ttStart: now,
			ttEnd: BITEMPORAL.TT_INFINITY,
		},
	);

	// Create DiffHunk nodes linked through ToolCalls
	for (let i = 0; i < diffs.length; i++) {
		const diff = diffs[i];
		const toolCallId = createTestId("tc");

		await graphClient.query(
			`MATCH (t:Thought {id: $thoughtId})
			 CREATE (tc:ToolCall {
				id: $toolCallId,
				name: 'write_file',
				vt_start: $vtStart,
				vt_end: $vtEnd,
				tt_start: $ttStart,
				tt_end: $ttEnd
			 })
			 CREATE (t)-[:YIELDS]->(tc)
			 CREATE (d:DiffHunk {
				id: $diffId,
				file_path: $filePath,
				patch_content: $patchContent,
				vt_start: $diffVtStart,
				vt_end: $vtEnd,
				tt_start: $ttStart,
				tt_end: $ttEnd
			 })
			 CREATE (tc)-[:YIELDS]->(d)`,
			{
				thoughtId,
				toolCallId,
				diffId: createTestId("diff"),
				filePath: diff.filePath,
				patchContent: diff.patchContent,
				diffVtStart: diff.vtStart,
				vtStart: diff.vtStart,
				vtEnd: BITEMPORAL.VT_INFINITY,
				ttStart: now,
				ttEnd: BITEMPORAL.TT_INFINITY,
			},
		);
	}

	// Create ToolCall nodes for replay testing
	for (const tc of toolCalls) {
		await graphClient.query(
			`MATCH (t:Thought {id: $thoughtId})
			 CREATE (tc:ToolCall {
				id: $toolCallId,
				name: $name,
				arguments: $arguments,
				result: $result,
				vt_start: $vtStart,
				vt_end: $vtEnd,
				tt_start: $ttStart,
				tt_end: $ttEnd
			 })
			 CREATE (t)-[:YIELDS]->(tc)`,
			{
				thoughtId,
				toolCallId: tc.id,
				name: tc.name,
				arguments: tc.arguments,
				result: tc.result,
				vtStart: tc.vtStart,
				vtEnd: BITEMPORAL.VT_INFINITY,
				ttStart: now,
				ttEnd: BITEMPORAL.TT_INFINITY,
			},
		);
	}
}

/**
 * Clean up test graph data.
 */
export async function cleanupTestGraphData(graphClient: GraphClient): Promise<void> {
	await graphClient.query("MATCH (n) DETACH DELETE n");
}
