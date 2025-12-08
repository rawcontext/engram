import { describe, expect, it, mock } from "bun:test";
import { SnapshotManager } from "./snapshot-manager";

// Mock QdrantClient
mock.module("@qdrant/js-client-rest", () => {
	return {
		QdrantClient: class {
			async createSnapshot(_collection: string) {
				return { name: "test-snapshot.snapshot", creation_time: "now" };
			}
			async listSnapshots(_collection: string) {
				return [
					{ name: "snapshot-2024-01-01.snapshot", creation_time: "2024-01-01T00:00:00Z" },
					{ name: "snapshot-2024-01-02.snapshot", creation_time: "2024-01-02T00:00:00Z" },
				];
			}
			async recoverSnapshot(_collection: string, _options: unknown) {
				return true;
			}
			async deleteSnapshot(_collection: string, _snapshotName: string) {
				return true;
			}
		},
	};
});

describe("SnapshotManager", () => {
	it("should create a snapshot", async () => {
		const manager = new SnapshotManager();
		const result = await manager.createSnapshot();
		expect(result).toEqual({ name: "test-snapshot.snapshot", creation_time: "now" });
	});

	it("should list snapshots", async () => {
		const manager = new SnapshotManager();
		const result = await manager.listSnapshots();
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("snapshot-2024-01-01.snapshot");
	});

	it("should generate correct snapshot URL", () => {
		const manager = new SnapshotManager("http://localhost:6333");
		const url = manager.getSnapshotUrl("test-snapshot.snapshot");
		expect(url).toBe(
			"http://localhost:6333/collections/engram_memory/snapshots/test-snapshot.snapshot",
		);
	});

	it("should recover from a snapshot", async () => {
		const manager = new SnapshotManager();
		const result = await manager.recoverSnapshot({
			location: "http://localhost:6333/collections/engram_memory/snapshots/test.snapshot",
			priority: "snapshot",
		});
		expect(result).toBe(true);
	});

	it("should recover from latest snapshot", async () => {
		const manager = new SnapshotManager();
		const result = await manager.recoverFromLatest();
		// Should pick the most recent snapshot (2024-01-02)
		expect(result).toBe(true);
	});

	it("should delete a snapshot", async () => {
		const manager = new SnapshotManager();
		const result = await manager.deleteSnapshot("test-snapshot.snapshot");
		expect(result).toBe(true);
	});
});
