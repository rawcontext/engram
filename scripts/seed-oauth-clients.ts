#!/usr/bin/env bun
/**
 * Seed OAuth Service Clients
 *
 * Registers OAuth service clients for M2M authentication.
 * Run this script to create client credentials for internal services.
 *
 * Usage:
 *   DATABASE_URL=postgres://... bun run scripts/seed-oauth-clients.ts
 *
 * @see apps/api/src/db/init.sql for oauth_clients schema
 * @see apps/observatory/lib/client-registration.ts for client patterns
 */

import { Pool } from "pg";
import {
	generateClientSecret,
	hashClientSecret,
} from "../apps/observatory/lib/client-registration";

// =============================================================================
// Service Client Definitions
// =============================================================================

interface ServiceClient {
	id: string;
	name: string;
	scopes: string[];
}

const SERVICE_CLIENTS: ServiceClient[] = [
	{
		id: "engram-api",
		name: "Engram API Service",
		scopes: ["memory:read", "memory:write", "query:read"],
	},
	{
		id: "engram-tuner",
		name: "Engram Tuner Service",
		scopes: ["tuner:read", "tuner:write"],
	},
	{
		id: "engram-search",
		name: "Engram Search Service",
		scopes: ["memory:read", "query:read"],
	},
	{
		id: "engram-console",
		name: "Engram Infrastructure Console",
		scopes: ["*"],
	},
	{
		id: "engram-ingestion",
		name: "Engram Ingestion Service",
		scopes: ["ingest:write", "memory:write"],
	},
	{
		id: "engram-memory",
		name: "Engram Memory Service",
		scopes: ["memory:write", "query:write"],
	},
];

// =============================================================================
// Seed Function
// =============================================================================

async function seedClients() {
	const connectionString = process.env.DATABASE_URL || process.env.AUTH_DATABASE_URL;

	if (!connectionString) {
		console.error("Error: DATABASE_URL or AUTH_DATABASE_URL environment variable is required");
		process.exit(1);
	}

	const pool = new Pool({ connectionString });

	try {
		console.log("Seeding OAuth service clients...\n");

		const secrets: Record<string, string> = {};

		for (const client of SERVICE_CLIENTS) {
			const secret = generateClientSecret();
			const hash = hashClientSecret(secret);

			await pool.query(
				`INSERT INTO oauth_clients (
					client_id, client_secret_hash, client_name,
					grant_types, token_endpoint_auth_method, scope,
					redirect_uris, response_types
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT (client_id)
				DO UPDATE SET
					client_secret_hash = EXCLUDED.client_secret_hash,
					client_name = EXCLUDED.client_name,
					scope = EXCLUDED.scope,
					updated_at = NOW()`,
				[
					client.id,
					hash,
					client.name,
					["client_credentials"],
					"client_secret_basic",
					client.scopes.join(" "),
					[], // No redirect URIs for M2M
					[], // No response types for M2M
				],
			);

			secrets[client.id] = secret;
			console.log(`✓ ${client.id}`);
			console.log(`  Name: ${client.name}`);
			console.log(`  Scopes: ${client.scopes.join(", ")}`);
			console.log(`  Secret: ${secret}\n`);
		}

		console.log("=".repeat(80));
		console.log("IMPORTANT: Copy these secrets to your .env files!");
		console.log("=".repeat(80));
		console.log();

		for (const [clientId, secret] of Object.entries(secrets)) {
			const envVar = `${clientId.toUpperCase().replace(/-/g, "_")}_CLIENT_SECRET`;
			console.log(`${envVar}=${secret}`);
		}

		console.log();
		console.log("Client registration complete!");
	} catch (error) {
		console.error("Error seeding clients:", error);
		process.exit(1);
	} finally {
		await pool.end();
	}
}

// =============================================================================
// Main
// =============================================================================

seedClients().catch((error) => {
	console.error("Unhandled error:", error);
	process.exit(1);
});
