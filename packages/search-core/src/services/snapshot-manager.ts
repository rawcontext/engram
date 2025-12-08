import { QdrantClient } from "@qdrant/js-client-rest";

type RecoveryPriority = "replica" | "snapshot" | "no_sync";

export interface RecoverOptions {
	/** URL or local path to the snapshot file */
	location: string;
	/**
	 * Recovery priority:
	 * - replica: Default. Replicas recover from other replicas first
	 * - snapshot: Force recovery from snapshot only
	 * - no_sync: Skip sync with other replicas (fastest)
	 */
	priority?: RecoveryPriority;
}

export class SnapshotManager {
	private client: QdrantClient;
	private collectionName = "engram_memory";
	private baseUrl: string;

	constructor(url: string = "http://localhost:6333") {
		this.client = new QdrantClient({ url });
		this.baseUrl = url;
	}

	/**
	 * Creates a snapshot of the memory collection.
	 * @returns The snapshot description (name, creation time, size).
	 */
	async createSnapshot() {
		const result = await this.client.createSnapshot(this.collectionName);
		return result;
	}

	/**
	 * Lists all available snapshots for the memory collection.
	 */
	async listSnapshots() {
		const result = await this.client.listSnapshots(this.collectionName);
		return result;
	}

	/**
	 * Gets the download URL for a specific snapshot.
	 * @param snapshotName - The name of the snapshot to download
	 * @returns The URL to download the snapshot
	 */
	getSnapshotUrl(snapshotName: string): string {
		return `${this.baseUrl}/collections/${this.collectionName}/snapshots/${snapshotName}`;
	}

	/**
	 * Recovers the collection from a snapshot.
	 * This will recreate the collection from the snapshot, replacing any existing data.
	 *
	 * WARNING: This is a destructive operation. Existing collection data will be overwritten.
	 *
	 * @param options - Recovery options including snapshot location and priority
	 * @returns Recovery result
	 */
	async recoverSnapshot(options: RecoverOptions) {
		const { location, priority = "snapshot" } = options;

		// Use recoverSnapshot API to restore from URL or local path
		const result = await this.client.recoverSnapshot(this.collectionName, {
			location,
			priority,
		});

		return result;
	}

	/**
	 * Recovers the collection from the most recent snapshot.
	 * Convenience method that finds the latest snapshot and recovers from it.
	 *
	 * @param priority - Recovery priority (default: "snapshot")
	 * @returns Recovery result or null if no snapshots exist
	 */
	async recoverFromLatest(priority: RecoveryPriority = "snapshot") {
		const snapshots = await this.listSnapshots();

		if (!snapshots || snapshots.length === 0) {
			return null;
		}

		// Sort by creation time descending and get the latest
		const sorted = [...snapshots].sort((a, b) => {
			const timeA = typeof a.creation_time === "string" ? Date.parse(a.creation_time) : 0;
			const timeB = typeof b.creation_time === "string" ? Date.parse(b.creation_time) : 0;
			return timeB - timeA;
		});

		const latestSnapshot = sorted[0];
		const location = this.getSnapshotUrl(latestSnapshot.name);

		return this.recoverSnapshot({ location, priority });
	}

	/**
	 * Deletes a specific snapshot.
	 * @param snapshotName - The name of the snapshot to delete
	 */
	async deleteSnapshot(snapshotName: string) {
		const result = await this.client.deleteSnapshot(this.collectionName, snapshotName);
		return result;
	}
}
