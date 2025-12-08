import type { BlobStore, FalkorClient } from "@engram/storage";
import { now } from "./utils/time";

interface PruneResult {
	archived: number;
	deleted: number;
	archiveUri?: string;
	batches: number;
}

interface PruneOptions {
	/** Milliseconds to keep history (default: 30 days) */
	retentionMs?: number;
	/** Number of nodes to delete per batch (default: 1000) */
	batchSize?: number;
	/** Maximum batches to process (default: no limit) */
	maxBatches?: number;
}

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class GraphPruner {
	constructor(
		private client: FalkorClient,
		private archiveStore?: BlobStore,
	) {}

	/**
	 * Prune old transaction history.
	 * Optionally archives nodes to blob storage before deletion.
	 * Removes nodes where transaction time ended before the threshold.
	 * Uses batched deletion to avoid Redis timeouts on large graphs.
	 *
	 * @param options - Pruning options
	 * @returns PruneResult with counts, archive URI, and batch info
	 */
	async pruneHistory(options: PruneOptions = {}): Promise<PruneResult> {
		const {
			retentionMs = DEFAULT_RETENTION_MS,
			batchSize = DEFAULT_BATCH_SIZE,
			maxBatches,
		} = options;

		const threshold = now() - retentionMs;

		// 1. Archive nodes before deletion (if archive store is configured)
		let archiveUri: string | undefined;
		let archivedCount = 0;

		if (this.archiveStore) {
			const archiveResult = await this.archiveNodes(threshold);
			archivedCount = archiveResult.count;
			archiveUri = archiveResult.uri;
		}

		// 2. Delete old nodes in batches to avoid Redis timeouts
		let totalDeleted = 0;
		let batchesProcessed = 0;
		let hasMore = true;

		while (hasMore) {
			// Check if we've hit max batches limit
			if (maxBatches !== undefined && batchesProcessed >= maxBatches) {
				break;
			}

			// Fetch a batch of node IDs to delete
			const fetchQuery = `
				MATCH (n)
				WHERE n.tt_end < ${threshold}
				RETURN id(n) as nodeId
				LIMIT ${batchSize}
			`;

			const nodeRows = await this.client.query<{ nodeId: number }>(fetchQuery);

			if (!nodeRows || nodeRows.length === 0) {
				hasMore = false;
				break;
			}

			// Delete this batch by node IDs
			const nodeIds = nodeRows.map((row) => row.nodeId);
			const deleteQuery = `
				MATCH (n)
				WHERE id(n) IN [${nodeIds.join(",")}]
				DELETE n
				RETURN count(n) as deleted_count
			`;

			const result = await this.client.query(deleteQuery);
			const firstRow = result?.[0];
			const batchDeleted = (firstRow?.deleted_count as number) ?? (firstRow?.[0] as number) ?? 0;

			totalDeleted += batchDeleted;
			batchesProcessed++;

			// If we got fewer than batch size, we're done
			if (nodeRows.length < batchSize) {
				hasMore = false;
			}
		}

		return {
			archived: archivedCount,
			deleted: totalDeleted,
			archiveUri,
			batches: batchesProcessed,
		};
	}

	/**
	 * Archive nodes to JSONL format before deletion.
	 * Exports all nodes that will be pruned to blob storage.
	 */
	private async archiveNodes(threshold: number): Promise<{ count: number; uri?: string }> {
		// Query all nodes that will be deleted
		const fetchQuery = `
			MATCH (n)
			WHERE n.tt_end < ${threshold}
			RETURN labels(n) as labels, properties(n) as props, id(n) as nodeId
		`;

		const rows = await this.client.query<{
			labels: string[];
			props: Record<string, unknown>;
			nodeId: number;
		}>(fetchQuery);

		if (!rows || rows.length === 0) {
			return { count: 0 };
		}

		// Convert to JSONL format
		const lines: string[] = [];
		for (const row of rows) {
			const archiveRecord = {
				_archived_at: now(),
				_threshold: threshold,
				_node_id: row.nodeId,
				labels: row.labels,
				...row.props,
			};
			lines.push(JSON.stringify(archiveRecord));
		}

		const jsonlContent = lines.join("\n");

		// Save to blob storage
		const uri = await this.archiveStore?.save(jsonlContent);

		return {
			count: rows.length,
			uri,
		};
	}
}
