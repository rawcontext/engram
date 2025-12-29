#!/usr/bin/env bun
/**
 * Generate and seed an OAuth token for OpenTofu state backend
 *
 * This creates a long-lived service token with state:write scope for CI/CD.
 *
 * Usage:
 *   # Local development
 *   bun run scripts/seed-tofu-token.ts
 *
 *   # Production (SSH to server first)
 *   ssh engram@statient.com
 *   cd /opt/engram
 *   docker compose -f docker-compose.prod.yml exec api bun run scripts/seed-tofu-token.ts
 *
 * After running, update the TF_HTTP_PASSWORD secret in GitHub:
 *   gh secret set TF_HTTP_PASSWORD --body "<token from output>"
 */

import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const DATABASE_URL =
	process.env.AUTH_DATABASE_URL || "postgresql://postgres:postgres@localhost:6183/engram";

async function main() {
	console.log("🔑 Generating OpenTofu state backend token...\n");

	const sql = postgres(DATABASE_URL);

	try {
		// Generate tokens
		const accessToken = `engram_tofu_${randomBytes(20).toString("hex")}`;
		const refreshToken = `engram_refresh_${randomBytes(20).toString("hex")}`;

		const accessTokenHash = createHash("sha256").update(accessToken).digest("hex");
		const refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");
		const accessTokenPrefix = `${accessToken.slice(0, 20)}...`;

		// Ensure service user exists
		await sql`
      INSERT INTO "user" (
        id, name, email, "emailVerified", role, "createdAt", "updatedAt"
      ) VALUES (
        'tofu-service-user',
        'OpenTofu Service',
        'tofu@service.internal',
        true,
        'service',
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        "updatedAt" = NOW()
    `;

		// Revoke any existing tofu tokens
		await sql`
      UPDATE oauth_tokens
      SET revoked_at = NOW(), revoked_reason = 'Replaced by new token'
      WHERE user_id = 'tofu-service-user'
        AND revoked_at IS NULL
    `;

		// Insert new token (10 year expiry for CI/CD service use)
		await sql`
      INSERT INTO oauth_tokens (
        id,
        access_token_hash,
        refresh_token_hash,
        access_token_prefix,
        user_id,
        scopes,
        rate_limit_rpm,
        access_token_expires_at,
        refresh_token_expires_at,
        created_at,
        updated_at,
        client_id
      ) VALUES (
        gen_random_uuid(),
        ${accessTokenHash},
        ${refreshTokenHash},
        ${accessTokenPrefix},
        'tofu-service-user',
        ARRAY['state:write'],
        1000,
        NOW() + INTERVAL '10 years',
        NOW() + INTERVAL '10 years',
        NOW(),
        NOW(),
        'tofu-ci'
      )
    `;

		console.log("✅ Token created successfully!\n");
		console.log("━".repeat(60));
		console.log("ACCESS TOKEN (use this for TF_HTTP_PASSWORD):");
		console.log("━".repeat(60));
		console.log(`\n${accessToken}\n`);
		console.log("━".repeat(60));
		console.log("\n📋 Next steps:");
		console.log("1. Copy the access token above");
		console.log("2. Update GitHub secret:");
		console.log(`   gh secret set TF_HTTP_PASSWORD --body "${accessToken}"`);
		console.log("3. Update local .env:");
		console.log(`   TF_HTTP_PASSWORD=${accessToken}`);
		console.log("4. Re-run the failed deploy workflow\n");
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	} finally {
		await sql.end();
	}
}

main();
