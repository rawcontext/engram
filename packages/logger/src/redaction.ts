/**
 * Pino Redaction Configuration
 *
 * Paths to redact sensitive data from logs.
 * Uses Pino's built-in redaction which is more performant than manual scrubbing.
 */

export const DEFAULT_REDACT_PATHS = [
	// Request headers
	"req.headers.authorization",
	"req.headers.cookie",
	"req.headers['x-api-key']",

	// Request body sensitive fields
	"req.body.password",
	"req.body.token",
	"req.body.refreshToken",
	"req.body.refresh_token",
	"req.body.accessToken",
	"req.body.access_token",
	"req.body.apiKey",
	"req.body.api_key",
	"req.body.secret",
	"req.body.credential",
	"req.body.credentials",

	// Auth objects
	"auth.*",
	"identity.token",
	"identity.refreshToken",
	"secrets.*",

	// User PII
	"*.email",
	"*.phone",
	"*.ssn",
	"*.creditCard",
	"*.cardNumber",
	"user.password",

	// Response sensitive fields
	"res.headers['set-cookie']",
] as const;

export type RedactPath = (typeof DEFAULT_REDACT_PATHS)[number];

/**
 * Merge custom redaction paths with defaults
 */
export function mergeRedactPaths(customPaths?: readonly string[]): readonly string[] {
	if (!customPaths?.length) {
		return DEFAULT_REDACT_PATHS;
	}
	// Combine default and custom paths, removing duplicates
	const combined = new Set([...DEFAULT_REDACT_PATHS, ...customPaths]);
	return Array.from(combined);
}
