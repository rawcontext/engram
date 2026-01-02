import { createNodeLogger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";

const logger = createNodeLogger({
	service: "graph",
	base: { component: "edge-temporality-migration" },
});

/**
 * All edge types that need bitemporal fields.
 * Derived from packages/graph/src/models/edges.ts EdgeTypes.
 */
const EDGE_TYPES = [
	// Session hierarchy
	"HAS_TURN",
	"NEXT",

	// Turn hierarchy
	"CONTAINS",
	"INVOKES",

	// Reasoning → ToolCall → FileTouch lineage
	"TRIGGERS",
	"TOUCHES",

	// Tool relationships
	"YIELDS",

	// Code relationships
	"MODIFIES",
	"SNAPSHOT_OF",

	// Versioning
	"REPLACES",
	"SAME_AS",

	// MCP Self-Instrumentation
	"SELF_INVOKES",

	// Entity relationships
	"MENTIONS",
	"RELATED_TO",
	"DEPENDS_ON",
	"IMPLEMENTS",
	"PART_OF",
] as const;

/**
 * Migration result for a single edge type.
 */
export interface EdgeMigrationResult {
	edgeType: string;
	migratedCount: number;
	skippedCount: number;
}

/**
 * Full migration result.
 */
export interface MigrationResult {
	totalMigrated: number;
	totalSkipped: number;
	byEdgeType: EdgeMigrationResult[];
}

/**
 * Migrate existing edges to have bitemporal fields (vt_start, vt_end, tt_start, tt_end).
 *
 * This migration is idempotent:
 * - Only edges with vt_start IS NULL are migrated
 * - Safe to run multiple times
 *
 * The migration sets all bitemporal fields to current timestamp with MAX_DATE as end times,
 * treating all existing edges as currently valid from "now".
 *
 * @param client - FalkorDB client instance
 * @returns Migration result with counts per edge type
 */
export async function migrateEdgesToBitemporal(client: GraphClient): Promise<MigrationResult> {
	const now = Date.now();
	const maxDate = MAX_DATE;
	const results: EdgeMigrationResult[] = [];

	logger.info({ edgeTypes: EDGE_TYPES.length }, "Starting edge temporality migration");

	for (const edgeType of EDGE_TYPES) {
		try {
			// First, count edges that need migration (vt_start IS NULL)
			const countResult = await client.query<{ cnt: number }>(
				`MATCH ()-[e:${edgeType}]->() WHERE e.vt_start IS NULL RETURN count(e) as cnt`,
			);
			const needsMigration = countResult[0]?.cnt ?? 0;

			if (needsMigration === 0) {
				logger.debug({ edgeType }, "No edges need migration, skipping");
				results.push({
					edgeType,
					migratedCount: 0,
					skippedCount: 0,
				});
				continue;
			}

			// Count already-migrated edges (vt_start IS NOT NULL)
			const skippedResult = await client.query<{ cnt: number }>(
				`MATCH ()-[e:${edgeType}]->() WHERE e.vt_start IS NOT NULL RETURN count(e) as cnt`,
			);
			const skippedCount = skippedResult[0]?.cnt ?? 0;

			// Migrate edges that don't have bitemporal fields
			logger.info({ edgeType, count: needsMigration }, "Migrating edges");

			await client.query(
				`
				MATCH ()-[e:${edgeType}]->()
				WHERE e.vt_start IS NULL
				SET e.vt_start = $now,
					e.vt_end = $maxDate,
					e.tt_start = $now,
					e.tt_end = $maxDate
				`,
				{ now, maxDate },
			);

			logger.info({ edgeType, migratedCount: needsMigration, skippedCount }, "Edge type migration complete");

			results.push({
				edgeType,
				migratedCount: needsMigration,
				skippedCount,
			});
		} catch (err) {
			logger.error({ err, edgeType }, "Failed to migrate edge type");
			throw err;
		}
	}

	const totalMigrated = results.reduce((sum, r) => sum + r.migratedCount, 0);
	const totalSkipped = results.reduce((sum, r) => sum + r.skippedCount, 0);

	logger.info({ totalMigrated, totalSkipped }, "Edge temporality migration complete");

	return {
		totalMigrated,
		totalSkipped,
		byEdgeType: results,
	};
}

/**
 * Verify that all edges have bitemporal fields.
 *
 * @param client - FalkorDB client instance
 * @returns Count of edges still missing bitemporal fields (should be 0 after migration)
 */
export async function verifyEdgeTemporality(client: GraphClient): Promise<number> {
	let totalMissing = 0;

	for (const edgeType of EDGE_TYPES) {
		const result = await client.query<{ cnt: number }>(
			`MATCH ()-[e:${edgeType}]->() WHERE e.vt_start IS NULL RETURN count(e) as cnt`,
		);
		const missing = result[0]?.cnt ?? 0;
		if (missing > 0) {
			logger.warn({ edgeType, count: missing }, "Edges still missing bitemporal fields");
			totalMissing += missing;
		}
	}

	if (totalMissing === 0) {
		logger.info("Verification passed: all edges have bitemporal fields");
	} else {
		logger.warn({ totalMissing }, "Verification failed: some edges missing bitemporal fields");
	}

	return totalMissing;
}
