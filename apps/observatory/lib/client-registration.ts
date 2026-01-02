/**
 * OAuth Dynamic Client Registration Library (RFC 7591)
 *
 * Implements Dynamic Client Registration for MCP OAuth 2.1.
 * Clients can self-register to obtain client credentials.
 *
 * @see https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/authorization/
 * @see https://www.rfc-editor.org/rfc/rfc7591.html
 */

import type {
	ClientRegistrationError,
	ClientRegistrationRequest,
	ClientRegistrationResponse,
	OAuthClientRecord,
} from "@engram/common/types";
import { Pool } from "pg";

// =============================================================================
// Database Client
// =============================================================================

const pool = new Pool({
	connectionString: process.env.AUTH_DATABASE_URL,
});

// =============================================================================
// Constants
// =============================================================================

/** Allowed grant types for MCP clients */
const ALLOWED_GRANT_TYPES = [
	"authorization_code",
	"refresh_token",
	"urn:ietf:params:oauth:grant-type:device_code",
];

/** Allowed response types */
const ALLOWED_RESPONSE_TYPES = ["code"];

/** Allowed authentication methods */
const ALLOWED_AUTH_METHODS = ["none", "client_secret_basic", "client_secret_post"];

/** Default MCP scopes */
const DEFAULT_SCOPE = "mcp:tools mcp:resources mcp:prompts";

/** Allowed MCP scopes */
const ALLOWED_SCOPES = ["mcp:tools", "mcp:resources", "mcp:prompts"];

// =============================================================================
// Generation Functions
// =============================================================================

/**
 * Generate a unique client ID.
 * Format: engram_{random_hex}
 */
export function generateClientId(): string {
	const randomArray = new Uint8Array(12);
	crypto.getRandomValues(randomArray);
	const hex = Array.from(randomArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `engram_${hex}`;
}

/**
 * Generate a client secret for confidential clients.
 * Format: engram_secret_{random_hex}
 */
export function generateClientSecret(): string {
	const randomArray = new Uint8Array(24);
	crypto.getRandomValues(randomArray);
	const hex = Array.from(randomArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `engram_secret_${hex}`;
}

/**
 * Hash a client secret using SHA-256.
 */
export function hashClientSecret(secret: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(secret);
	return hasher.digest("hex");
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate redirect URIs.
 * - Must be valid URLs or localhost with custom scheme
 * - HTTPS required for non-localhost
 * - No fragments allowed
 */
export function validateRedirectUris(uris: string[]): {
	valid: boolean;
	error?: string;
} {
	if (!Array.isArray(uris) || uris.length === 0) {
		return { valid: false, error: "At least one redirect_uri is required" };
	}

	for (const uri of uris) {
		try {
			const parsed = new URL(uri);

			// No fragments allowed
			if (parsed.hash) {
				return { valid: false, error: `Fragment not allowed in redirect_uri: ${uri}` };
			}

			// Check for localhost or loopback
			const isLocalhost =
				parsed.hostname === "localhost" ||
				parsed.hostname === "127.0.0.1" ||
				parsed.hostname === "::1" ||
				parsed.hostname.endsWith(".localhost");

			// Allow custom schemes for native apps
			const isCustomScheme = !["http:", "https:"].includes(parsed.protocol);

			if (isCustomScheme) {
				// Custom schemes are allowed for native apps
				continue;
			}

			// HTTPS required for non-localhost
			if (!isLocalhost && parsed.protocol !== "https:") {
				return { valid: false, error: `HTTPS required for non-localhost redirect_uri: ${uri}` };
			}
		} catch {
			return { valid: false, error: `Invalid redirect_uri: ${uri}` };
		}
	}

	return { valid: true };
}

/**
 * Validate and normalize grant types.
 */
export function validateGrantTypes(types?: string[]): {
	valid: boolean;
	normalized: string[];
	error?: string;
} {
	const requested = types || ["authorization_code"];

	for (const type of requested) {
		if (!ALLOWED_GRANT_TYPES.includes(type)) {
			return {
				valid: false,
				normalized: [],
				error: `Unsupported grant_type: ${type}`,
			};
		}
	}

	// Ensure refresh_token is included if authorization_code is
	const normalized = [...new Set(requested)];
	if (normalized.includes("authorization_code") && !normalized.includes("refresh_token")) {
		normalized.push("refresh_token");
	}

	return { valid: true, normalized };
}

/**
 * Validate and normalize response types.
 */
export function validateResponseTypes(types?: string[]): {
	valid: boolean;
	normalized: string[];
	error?: string;
} {
	const requested = types || ["code"];

	for (const type of requested) {
		if (!ALLOWED_RESPONSE_TYPES.includes(type)) {
			return {
				valid: false,
				normalized: [],
				error: `Unsupported response_type: ${type}`,
			};
		}
	}

	return { valid: true, normalized: [...new Set(requested)] };
}

/**
 * Validate token endpoint auth method.
 */
export function validateAuthMethod(method?: string): {
	valid: boolean;
	normalized: string;
	error?: string;
} {
	const requested = method || "none";

	if (!ALLOWED_AUTH_METHODS.includes(requested)) {
		return {
			valid: false,
			normalized: "none",
			error: `Unsupported token_endpoint_auth_method: ${requested}`,
		};
	}

	return { valid: true, normalized: requested };
}

/**
 * Validate and normalize scopes.
 */
export function validateScopes(scope?: string): {
	valid: boolean;
	normalized: string;
	error?: string;
} {
	if (!scope) {
		return { valid: true, normalized: DEFAULT_SCOPE };
	}

	const requested = scope.split(" ").filter(Boolean);

	for (const s of requested) {
		if (!ALLOWED_SCOPES.includes(s)) {
			return {
				valid: false,
				normalized: "",
				error: `Unsupported scope: ${s}. Allowed: ${ALLOWED_SCOPES.join(", ")}`,
			};
		}
	}

	return { valid: true, normalized: requested.join(" ") };
}

// =============================================================================
// Client Registration
// =============================================================================

/**
 * Register a new OAuth client.
 */
export async function registerClient(
	request: ClientRegistrationRequest,
): Promise<ClientRegistrationResponse | ClientRegistrationError> {
	// Validate redirect URIs
	const uriValidation = validateRedirectUris(request.redirect_uris);
	if (!uriValidation.valid) {
		return {
			error: "invalid_redirect_uri",
			error_description: uriValidation.error,
		};
	}

	// Validate grant types
	const grantValidation = validateGrantTypes(request.grant_types);
	if (!grantValidation.valid) {
		return {
			error: "invalid_client_metadata",
			error_description: grantValidation.error,
		};
	}

	// Validate response types
	const responseValidation = validateResponseTypes(request.response_types);
	if (!responseValidation.valid) {
		return {
			error: "invalid_client_metadata",
			error_description: responseValidation.error,
		};
	}

	// Validate auth method
	const authValidation = validateAuthMethod(request.token_endpoint_auth_method);
	if (!authValidation.valid) {
		return {
			error: "invalid_client_metadata",
			error_description: authValidation.error,
		};
	}

	// Validate scopes
	const scopeValidation = validateScopes(request.scope);
	if (!scopeValidation.valid) {
		return {
			error: "invalid_client_metadata",
			error_description: scopeValidation.error,
		};
	}

	// Generate credentials
	const clientId = generateClientId();
	const isConfidential = authValidation.normalized !== "none";
	const clientSecret = isConfidential ? generateClientSecret() : undefined;
	const clientSecretHash = clientSecret ? hashClientSecret(clientSecret) : null;

	// Default client name if not provided
	const clientName = request.client_name || `MCP Client ${clientId.slice(-8)}`;

	// Insert into database
	const now = new Date();
	await pool.query(
		`INSERT INTO oauth_clients (
			client_id, client_secret_hash, client_id_issued_at, client_secret_expires_at,
			client_name, redirect_uris, grant_types, response_types,
			token_endpoint_auth_method, scope, contacts, logo_uri,
			client_uri, policy_uri, tos_uri, software_id, software_version
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
		[
			clientId,
			clientSecretHash,
			now,
			null, // Client secrets don't expire by default
			clientName,
			request.redirect_uris,
			grantValidation.normalized,
			responseValidation.normalized,
			authValidation.normalized,
			scopeValidation.normalized,
			request.contacts || null,
			request.logo_uri || null,
			request.client_uri || null,
			request.policy_uri || null,
			request.tos_uri || null,
			request.software_id || null,
			request.software_version || null,
		],
	);

	// Build response
	const response: ClientRegistrationResponse = {
		client_id: clientId,
		client_id_issued_at: Math.floor(now.getTime() / 1000),
		client_secret_expires_at: 0, // Never expires
		redirect_uris: request.redirect_uris,
		client_name: clientName,
		token_endpoint_auth_method: authValidation.normalized,
		grant_types: grantValidation.normalized,
		response_types: responseValidation.normalized,
		scope: scopeValidation.normalized,
	};

	// Only include secret for confidential clients
	if (clientSecret) {
		response.client_secret = clientSecret;
	}

	// Echo back optional metadata
	if (request.contacts) response.contacts = request.contacts;
	if (request.logo_uri) response.logo_uri = request.logo_uri;
	if (request.client_uri) response.client_uri = request.client_uri;
	if (request.policy_uri) response.policy_uri = request.policy_uri;
	if (request.tos_uri) response.tos_uri = request.tos_uri;
	if (request.software_id) response.software_id = request.software_id;
	if (request.software_version) response.software_version = request.software_version;

	return response;
}

// =============================================================================
// Client Lookup
// =============================================================================

/**
 * Find a client by client_id.
 */
export async function findClientById(clientId: string): Promise<OAuthClientRecord | null> {
	const result = await pool.query<OAuthClientRecord>(
		`SELECT * FROM oauth_clients WHERE client_id = $1`,
		[clientId],
	);

	return result.rows[0] || null;
}

/**
 * Validate client credentials.
 */
export async function validateClientCredentials(
	clientId: string,
	clientSecret?: string,
): Promise<{ valid: boolean; client?: OAuthClientRecord; error?: string }> {
	const client = await findClientById(clientId);

	if (!client) {
		return { valid: false, error: "Client not found" };
	}

	// Public clients (no secret required)
	if (client.token_endpoint_auth_method === "none") {
		return { valid: true, client };
	}

	// Confidential clients require secret
	if (!clientSecret) {
		return { valid: false, error: "Client secret required" };
	}

	// Verify secret
	const secretHash = hashClientSecret(clientSecret);
	if (secretHash !== client.client_secret_hash) {
		return { valid: false, error: "Invalid client secret" };
	}

	// Check if secret has expired
	if (client.client_secret_expires_at && new Date(client.client_secret_expires_at) < new Date()) {
		return { valid: false, error: "Client secret has expired" };
	}

	return { valid: true, client };
}

/**
 * Validate a redirect URI for a client.
 */
export async function validateClientRedirectUri(
	clientId: string,
	redirectUri: string,
): Promise<boolean> {
	const client = await findClientById(clientId);

	if (!client) {
		return false;
	}

	return client.redirect_uris.includes(redirectUri);
}
