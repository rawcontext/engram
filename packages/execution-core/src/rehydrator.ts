import { createBlobStore, type FalkorClient } from "@engram/storage";
import { PatchManager, VirtualFileSystem } from "@engram/vfs";

export class Rehydrator {
	private blobStore = createBlobStore();

	constructor(private falkor: FalkorClient) {}

	async rehydrate(sessionId: string, targetTime: number = Date.now()): Promise<VirtualFileSystem> {
		const vfs = new VirtualFileSystem();
		const _patchManager = new PatchManager(vfs);

		// 1. Find latest Snapshot before targetTime
		// MATCH (s:Snapshot)-[:SNAPSHOT_OF]->(:Session {id: $id})
		// WHERE s.snapshot_at <= $t
		// RETURN s ORDER BY s.snapshot_at DESC LIMIT 1
		const snapshotQuery = `
      MATCH (s:Snapshot)-[:SNAPSHOT_OF]->(sess:Session {id: $sessionId})
      WHERE s.snapshot_at <= $targetTime
      RETURN s.vfs_state_blob_ref, s.snapshot_at
      ORDER BY s.snapshot_at DESC
      LIMIT 1
    `;
		const snapshots = await this.falkor.query(snapshotQuery, { sessionId, targetTime });
		let _lastSnapshotTime = 0;

		if (snapshots && Array.isArray(snapshots) && snapshots.length > 0) {
			const snap = snapshots[0]; // Format depends on RedisGraph output structure
			// Assuming [ { "s.vfs_state_blob_ref": "...", ... } ] or similar mapped object
			// TODO: Handle RedisGraph raw response parsing
			const blobRef = snap[0] as string;
			_lastSnapshotTime = snap[1] as number;

			// Load Blob
			const blobContent = await this.blobStore.read(blobRef);
			await vfs.loadSnapshot(Buffer.from(blobContent)); // Assuming blob read returns string, convert to buffer?
			// Actually blobStore.read returns string. loadSnapshot expects Buffer (gzip).
			// Need to fix types or logic. Assuming blobStore handles binary as base64 or similar?
			// For 'fs' store, readFile encoding 'utf-8'.
			// We should probably store as base64 string in blob store if text-only, or buffer.
			// Let's assume re-hydrating from JSON string (uncompressed) for V1 simplicity if blob store saves text.
			// vfs.root = JSON.parse(blobContent);
		}

		// 2. Apply Diffs from Snapshot Time to Target Time
		// MATCH (d:DiffHunk)-[:MODIFIES]->(c:CodeArtifact) ... linked to session?
		// Diffs are usually linked to Thoughts or ToolCalls which are linked to Session.
		// (s:Session)-[:TRIGGERS]->(t:Thought)-[:NEXT*]->...-[:YIELDS]->(tc:ToolCall)-[:YIELDS]->(d:DiffHunk)?
		// Or (d:DiffHunk) related to session time.
		// Querying all diffs in time range is easiest if they have timestamps.
		const _diffQuery = `
       MATCH (d:DiffHunk)
       WHERE d.vt_start > $lastSnapshotTime AND d.vt_start <= $targetTime
       RETURN d.file_path, d.patch_content
       ORDER BY d.vt_start ASC
    `;

		// This query is global! Need to filter by Session.
		// ... logic to filter by session ...

		// Apply patches
		// ...

		return vfs;
	}
}
