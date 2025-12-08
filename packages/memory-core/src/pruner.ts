import type { FalkorClient } from "@engram/storage";
import { now } from "./utils/time";

export class GraphPruner {
	constructor(private client: FalkorClient) {}

	/**
	 * Prune old transaction history.
	 * Removes nodes where transaction time ended before the threshold.
	 *
	 * @param retentionMs - Milliseconds to keep history (default: 30 days)
	 */
	async pruneHistory(retentionMs = 30 * 24 * 60 * 60 * 1000): Promise<number> {
		const threshold = now() - retentionMs;

		// MATCH (n) WHERE n.tt_end < $threshold DELETE n
		// Note: In FalkorDB/RedisGraph, bulk delete might be slow.
		// We should limit it or do it in batches.
		// For V1, a simple query is sufficient.

		const query = `
      MATCH (n)
      WHERE n.tt_end < ${threshold}
      DELETE n
      RETURN count(n) as deleted_count
    `;

		const result = await this.client.query(query);

		// Parse result (assuming standard RedisGraph response structure)
		// [[deleted_count]]
		const firstRow = result?.[0];
		const deletedCount = (firstRow?.deleted_count as number) ?? (firstRow?.[0] as number) ?? 0;
		return deletedCount;
	}
}
