import { join } from "node:path";
import type { Logger } from "@engram/logger";
import type { PostgresClient } from "@engram/storage";

/**
 * Run database migrations
 */
export async function runMigrations(db: PostgresClient, logger: Logger): Promise<void> {
	logger.info("Running database migrations");

	try {
		// Read and execute schema
		const schemaPath = join(import.meta.dir, "schema.sql");
		const schema = await Bun.file(schemaPath).text();

		await db.query(schema);

		logger.info("Database migrations completed successfully");
	} catch (error) {
		logger.error({ error }, "Failed to run database migrations");
		throw error;
	}
}
