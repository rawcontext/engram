import { createBlobStore, type FalkorClient } from "@engram/storage";
import { PatchManager, VirtualFileSystem } from "@engram/vfs";

export class Rehydrator {
	private blobStore = createBlobStore();

	constructor(private falkor: FalkorClient) {}

	async rehydrate(sessionId: string, targetTime: number = Date.now()): Promise<VirtualFileSystem> {
		const vfs = new VirtualFileSystem();
		const patchManager = new PatchManager(vfs);

		// 1. Find latest Snapshot before targetTime for this session
		const snapshotQuery = `
			MATCH (s:Snapshot)-[:SNAPSHOT_OF]->(sess:Session {id: $sessionId})
			WHERE s.snapshot_at <= $targetTime
			RETURN s.vfs_state_blob_ref, s.snapshot_at
			ORDER BY s.snapshot_at DESC
			LIMIT 1
		`;
		const snapshots = await this.falkor.query(snapshotQuery, { sessionId, targetTime });
		let lastSnapshotTime = 0;

		if (snapshots && Array.isArray(snapshots) && snapshots.length > 0) {
			const snap = snapshots[0];
			const blobRef = snap[0] as string;
			lastSnapshotTime = snap[1] as number;

			// Load Blob
			const blobContent = await this.blobStore.read(blobRef);
			try {
				await vfs.loadSnapshot(Buffer.from(blobContent));
			} catch (_e) {
				// If gzip fails, try loading as JSON directly
				try {
					const parsed = JSON.parse(blobContent);
					if (parsed.root) {
						vfs.root = parsed.root;
					}
				} catch (_jsonErr) {
					// Continue with empty VFS if loading fails
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

		const diffs = await this.falkor.query<{ file_path: string; patch_content: string }>(diffQuery, {
			sessionId,
			lastSnapshotTime,
			targetTime,
		});

		// Apply patches in order
		if (diffs && Array.isArray(diffs)) {
			for (const diff of diffs) {
				if (diff.file_path && diff.patch_content) {
					try {
						patchManager.applyUnifiedDiff(diff.file_path, diff.patch_content);
					} catch (_e) {
						// Log but continue on patch failures
					}
				}
			}
		}

		return vfs;
	}
}
