import { RehydrationError } from "@engram/common";
import {
	type BlobStore,
	createBlobStore,
	createFalkorClient,
	type FalkorClient,
	type GraphClient,
} from "@engram/storage";
import { PatchManager, VirtualFileSystem } from "@engram/vfs";

/**
 * Dependencies for Rehydrator construction.
 * Supports dependency injection for testability.
 */
export interface RehydratorDeps {
	/** Graph client for querying session state. Defaults to FalkorClient. */
	graphClient?: GraphClient;
	/** Blob store for loading VFS snapshots. Defaults to createBlobStore(). */
	blobStore?: BlobStore;
}

export class Rehydrator {
	private graphClient: GraphClient;
	private blobStore: BlobStore;

	/**
	 * Create a Rehydrator with injectable dependencies.
	 * @param deps - Optional dependencies. Defaults are used when not provided.
	 */
	constructor(deps?: RehydratorDeps);
	/** @deprecated Use RehydratorDeps object instead */
	constructor(falkor: FalkorClient);
	constructor(depsOrFalkor?: RehydratorDeps | FalkorClient) {
		if (depsOrFalkor === undefined) {
			// No args: use defaults
			this.graphClient = createFalkorClient();
			this.blobStore = createBlobStore();
		} else if ("query" in depsOrFalkor && typeof depsOrFalkor.query === "function") {
			// Legacy constructor: FalkorClient directly
			this.graphClient = depsOrFalkor as GraphClient;
			this.blobStore = createBlobStore();
		} else {
			// New deps object constructor
			const deps = depsOrFalkor as RehydratorDeps;
			this.graphClient = deps.graphClient ?? createFalkorClient();
			this.blobStore = deps.blobStore ?? createBlobStore();
		}
	}

	async rehydrate(sessionId: string, targetTime: number = Date.now()): Promise<VirtualFileSystem> {
		const vfs = new VirtualFileSystem();
		const patchManager = new PatchManager(vfs);

		// 1. Find latest Snapshot before targetTime for this session
		// Include bitemporal validation to ensure we only get valid, non-deleted snapshots
		const snapshotQuery = `
			MATCH (s:Snapshot)-[:SNAPSHOT_OF]->(sess:Session {id: $sessionId})
			WHERE s.snapshot_at <= $targetTime
			  AND s.vt_start <= $targetTime AND s.vt_end > $targetTime
			  AND s.tt_end = 253402300799000
			RETURN s.vfs_state_blob_ref, s.snapshot_at
			ORDER BY s.snapshot_at DESC
			LIMIT 1
		`;
		const snapshots = await this.graphClient.query(snapshotQuery, { sessionId, targetTime });
		let lastSnapshotTime = 0;

		if (snapshots && Array.isArray(snapshots) && snapshots.length > 0) {
			const snap = snapshots[0];
			const blobRef = snap[0] as string;
			lastSnapshotTime = snap[1] as number;

			// Load Blob
			const blobContent = await this.blobStore.load(blobRef);
			try {
				await vfs.loadSnapshot(Buffer.from(blobContent));
			} catch (_snapshotError) {
				// If gzip fails, try loading as JSON directly
				try {
					const parsed = JSON.parse(blobContent);
					if (parsed.root) {
						vfs.root = parsed.root;
					}
				} catch (jsonErr) {
					// Both gzip and JSON parsing failed - throw RehydrationError
					const cause = jsonErr instanceof Error ? jsonErr : undefined;
					throw new RehydrationError(
						`Failed to load VFS snapshot for session ${sessionId}: neither gzip nor JSON parsing succeeded`,
						sessionId,
						cause,
						"VFSSnapshot",
					);
				}
			}
		}

		// 2. Apply Diffs from Snapshot Time to Target Time
		// Filter by session: DiffHunks linked to session through the thought chain
		// Session -[:TRIGGERS]-> Thought -[:NEXT*]-> Thought -[:YIELDS]-> ToolCall -[:YIELDS]-> DiffHunk
		// OR via direct PART_OF relationship if exists
		const diffQuery = `
			MATCH (sess:Session {id: $sessionId})-[:TRIGGERS]->(t:Thought)
			OPTIONAL MATCH (t)-[:NEXT*0..]->(linked:Thought)
			WITH COALESCE(linked, t) as thought
			OPTIONAL MATCH (thought)-[:YIELDS]->(tc:ToolCall)-[:YIELDS]->(d:DiffHunk)
			WHERE d IS NOT NULL
				AND d.vt_start > $lastSnapshotTime
				AND d.vt_start <= $targetTime
			RETURN DISTINCT d.file_path as file_path, d.patch_content as patch_content, d.vt_start
			ORDER BY d.vt_start ASC
		`;

		const diffs = await this.graphClient.query<{ file_path: string; patch_content: string }>(
			diffQuery,
			{
				sessionId,
				lastSnapshotTime,
				targetTime,
			},
		);

		// Apply patches in order, tracking failures
		const patchFailures: Array<{ filePath: string; error: Error }> = [];
		if (diffs && Array.isArray(diffs)) {
			for (const diff of diffs) {
				if (diff.file_path && diff.patch_content) {
					try {
						patchManager.applyUnifiedDiff(diff.file_path, diff.patch_content);
					} catch (e) {
						// Track patch failure but continue - patches may be outdated or conflicts
						const error = e instanceof Error ? e : new Error(String(e));
						patchFailures.push({ filePath: diff.file_path, error });
						console.warn(
							`[Rehydrator] Failed to apply patch to ${diff.file_path}: ${error.message}`,
						);
					}
				}
			}
		}

		// If all patches failed and we had patches to apply, something is likely wrong
		if (patchFailures.length > 0 && diffs && patchFailures.length === diffs.length) {
			throw new RehydrationError(
				`All ${patchFailures.length} patches failed to apply for session ${sessionId}`,
				sessionId,
				patchFailures[0]?.error,
				"DiffPatches",
			);
		}

		return vfs;
	}
}

/**
 * Factory function for creating Rehydrator instances.
 * Supports dependency injection for testability.
 *
 * @example
 * // Production usage (uses defaults)
 * const rehydrator = createRehydrator();
 *
 * @example
 * // Test usage (inject mocks)
 * const rehydrator = createRehydrator({
 *   graphClient: mockGraphClient,
 *   blobStore: mockBlobStore,
 * });
 */
export function createRehydrator(deps?: RehydratorDeps): Rehydrator {
	return new Rehydrator(deps);
}
