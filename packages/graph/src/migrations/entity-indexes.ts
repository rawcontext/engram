import { createNodeLogger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";

const logger = createNodeLogger({
	service: "graph",
	base: { component: "entity-indexes-migration" },
});

/**
 * Create FalkorDB indexes for Entity nodes and relationships.
 *
 * Indexes:
 * - Entity.name (exact match + full-text search)
 * - Entity.type (exact match for filtering by entity type)
 * - Entity.embedding (vector index for semantic similarity search, 384 dimensions, cosine)
 * - MENTIONS edge temporal indexes (for time-travel queries)
 * - RELATED_TO edge temporal indexes (for time-travel queries)
 *
 * All indexes are idempotent using CREATE INDEX IF NOT EXISTS.
 *
 * @param client - FalkorDB client instance
 */
export async function createEntityIndexes(client: GraphClient): Promise<void> {
	logger.info("Creating Entity node indexes");

	try {
		// 1. Exact match index on Entity.name for fast lookups
		logger.info("Creating exact match index on Entity.name");
		await client.query("CREATE INDEX IF NOT EXISTS FOR (e:Entity) ON (e.name)");

		// 2. Exact match index on Entity.type for filtering
		logger.info("Creating exact match index on Entity.type");
		await client.query("CREATE INDEX IF NOT EXISTS FOR (e:Entity) ON (e.type)");

		// 3. Full-text index on Entity.name for fuzzy search
		// FalkorDB uses procedure calls for full-text indexes
		logger.info("Creating full-text index on Entity.name");
		try {
			await client.query("CALL db.idx.fulltext.createNodeIndex('Entity', 'name')");
			logger.info("Full-text index on Entity.name created");
		} catch (err) {
			// Full-text index may already exist - FalkorDB doesn't support IF NOT EXISTS for procedure calls
			const errMsg = err instanceof Error ? err.message : String(err);
			if (errMsg.includes("already exists") || errMsg.includes("Index already defined")) {
				logger.info("Full-text index on Entity.name already exists, skipping");
			} else {
				throw err;
			}
		}

		// 4. Vector index on Entity.embedding for semantic similarity search
		// 384 dimensions (all-MiniLM-L6-v2 embeddings), cosine similarity
		logger.info("Creating vector index on Entity.embedding (384 dimensions, cosine similarity)");
		await client.query(
			"CREATE VECTOR INDEX IF NOT EXISTS FOR (e:Entity) ON (e.embedding) OPTIONS {dimension: 384, similarityFunction: 'cosine'}",
		);

		// 5. Temporal indexes for MENTIONS edges (Memory -[MENTIONS]-> Entity)
		logger.info("Creating temporal indexes on MENTIONS edges");
		await client.query("CREATE INDEX IF NOT EXISTS FOR ()-[m:MENTIONS]-() ON (m.vt_start)");
		await client.query("CREATE INDEX IF NOT EXISTS FOR ()-[m:MENTIONS]-() ON (m.vt_end)");
		await client.query("CREATE INDEX IF NOT EXISTS FOR ()-[m:MENTIONS]-() ON (m.tt_start)");
		await client.query("CREATE INDEX IF NOT EXISTS FOR ()-[m:MENTIONS]-() ON (m.tt_end)");

		// 6. Temporal indexes for RELATED_TO edges (Entity -[RELATED_TO]-> Entity)
		logger.info("Creating temporal indexes on RELATED_TO edges");
		await client.query("CREATE INDEX IF NOT EXISTS FOR ()-[r:RELATED_TO]-() ON (r.vt_start)");
		await client.query("CREATE INDEX IF NOT EXISTS FOR ()-[r:RELATED_TO]-() ON (r.vt_end)");
		await client.query("CREATE INDEX IF NOT EXISTS FOR ()-[r:RELATED_TO]-() ON (r.tt_start)");
		await client.query("CREATE INDEX IF NOT EXISTS FOR ()-[r:RELATED_TO]-() ON (r.tt_end)");

		logger.info("Entity indexes created successfully");
	} catch (err) {
		logger.error({ err }, "Failed to create Entity indexes");
		throw err;
	}
}
