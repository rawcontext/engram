import { randomBytes } from "node:crypto";
import { PostgresClient } from "@engram/storage";
import { ulid } from "ulid";
import { ApiKeyRepository } from "../src/db/api-keys";

/**
 * Generate a random API key
 * Format: engram_(live|test)_<32 alphanumeric chars>
 */
function generateApiKey(keyType: "live" | "test"): string {
	const prefix = keyType === "live" ? "engram_live_" : "engram_test_";
	// Use hex encoding (only 0-9a-f) to match the API key pattern regex
	const randomPart = randomBytes(16).toString("hex");
	return `${prefix}${randomPart}`;
}

/**
 * Create a new API key
 */
async function main() {
	const args = process.argv.slice(2);
	const keyType = (args[0] === "live" ? "live" : "test") as "live" | "test";
	const name = args[1] ?? "Default API Key";
	const description = args[2];

	// Connect to database
	const postgresUrl =
		process.env.POSTGRES_URL ?? "postgresql://postgres:postgres@localhost:5432/engram";
	const db = new PostgresClient({ url: postgresUrl });
	await db.connect();

	// Generate key
	const apiKey = generateApiKey(keyType);
	const id = ulid();

	// Create repository
	const repo = new ApiKeyRepository(db);

	// Insert key
	const created = await repo.create({
		id,
		key: apiKey,
		keyType,
		name,
		description,
		scopes: ["memory:read", "memory:write", "query:read"],
		rateLimitRpm: 60,
	});

	console.log("\n✓ API Key created successfully!\n");
	console.log("ID:", created.id);
	console.log("Type:", created.keyType);
	console.log("Name:", created.name);
	console.log("Scopes:", created.scopes.join(", "));
	console.log("Rate limit:", `${created.rateLimitRpm} RPM`);
	console.log("\nAPI Key (save this, it won't be shown again):");
	console.log(`\n  ${apiKey}\n`);
	console.log("Usage:");
	console.log(`  curl -H "Authorization: Bearer ${apiKey}" http://localhost:8080/v1/health\n`);

	await db.disconnect();
}

main().catch((error) => {
	console.error("Error creating API key:", error);
	process.exit(1);
});
