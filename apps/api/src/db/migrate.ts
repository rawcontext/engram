import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "@engram/logger";
import type { PostgresClient } from "@engram/storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Run database migrations
 */
export async function runMigrations(db: PostgresClient, logger: Logger): Promise<void> {
	logger.info("Running database migrations");

	try {
		// Read and execute schema
		const schemaPath = join(__dirname, "schema.sql");
		const schema = await readFile(schemaPath, "utf-8");

		await db.query(schema);

		logger.info("Database migrations completed successfully");
	} catch (error) {
		logger.error({ error }, "Failed to run database migrations");
		throw error;
	}
}
