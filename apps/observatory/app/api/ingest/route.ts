import { RawStreamEventSchema } from "@engram/events";
import { createNatsClient } from "@engram/storage";
import { apiError, apiSuccess } from "@lib/api-response";
import { withTelemetry } from "@lib/telemetry";
import { validate } from "@lib/validate";
import { Pool } from "pg";

// Initialize NATS client
const nats = createNatsClient("observatory");

// Database pool for token validation
const pool = new Pool({
	connectionString: process.env.AUTH_DATABASE_URL,
});

// Zod Schema for Documentation (re-exporting or referencing)
export const _IngestBody = RawStreamEventSchema;

/**
 * Hash a token for database lookup (same as device-auth.ts)
 */
function hashToken(token: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(token);
	return hasher.digest("hex");
}

/**
 * Validate a Bearer token from the Authorization header.
 * Returns the user ID if valid, null otherwise.
 */
async function validateBearerToken(req: Request): Promise<{ userId: string } | null> {
	const authHeader = req.headers.get("authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return null;
	}

	const token = authHeader.slice(7);
	const tokenHash = hashToken(token);

	const result = await pool.query<{
		user_id: string;
		access_token_expires_at: Date;
		revoked_at: Date | null;
	}>(
		`SELECT user_id, access_token_expires_at, revoked_at
		 FROM oauth_tokens
		 WHERE access_token_hash = $1`,
		[tokenHash],
	);

	const record = result.rows[0];
	if (!record) {
		return null;
	}

	// Check if revoked
	if (record.revoked_at) {
		return null;
	}

	// Check if expired
	if (new Date(record.access_token_expires_at) < new Date()) {
		return null;
	}

	return { userId: record.user_id };
}

/**
 * Higher-order function to protect API routes with Bearer token OR session auth.
 * Tries Bearer token first (for hooks/CLI), falls back to session (for web UI).
 */
const withAuth = (handler: (req: Request) => Promise<Response>) => async (req: Request) => {
	// Try Bearer token first (for hooks, CLI, external callers)
	const tokenInfo = await validateBearerToken(req);
	if (tokenInfo) {
		return handler(req);
	}

	// Fall back to session auth (for web UI if needed in future)
	const { auth } = await import("@lib/auth");
	const { headers } = await import("next/headers");
	const session = await auth.api.getSession({ headers: await headers() });
	if (session) {
		return handler(req);
	}

	return apiError("Invalid or expired token", "UNAUTHORIZED", 401);
};

/**
 * Ingest a raw event stream
 * @body IngestBody
 * @response 202:object:Event accepted
 * @response 400:object:Validation error
 * @response 401:object:Unauthorized
 */
export const POST = withTelemetry(
	withAuth(async (req: Request) => {
		return validate(RawStreamEventSchema)(req, async (event) => {
			console.log("Ingesting event:", event.event_id);

			try {
				await nats.sendEvent("raw_events", event.event_id, event);
				return apiSuccess({ status: "accepted", event_id: event.event_id }, 202);
			} catch (e: unknown) {
				console.error("Failed to publish to NATS", e);
				const message = e instanceof Error ? e.message : String(e);
				return apiError(`Ingestion failed: ${message}`, "NATS_ERROR", 500);
			}
		});
	}),
);
