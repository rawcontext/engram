/**
 * OAuth 2.1 Client Credentials with DPoP for Console
 *
 * Implements RFC 6749 §4.4 Client Credentials Grant with RFC 9449 DPoP
 * for machine-to-machine authentication with the Engram API.
 *
 * @see https://tools.ietf.org/html/rfc6749#section-4.4
 * @see https://datatracker.ietf.org/doc/html/rfc9449
 */

import * as jose from "jose";

// =============================================================================
// Types
// =============================================================================

interface TokenResponse {
	access_token: string;
	token_type: "DPoP";
	expires_in: number;
	scope: string;
}

interface TokenError {
	error: string;
	error_description: string;
}

interface OAuthConfig {
	clientId: string;
	clientSecret: string;
	authServerUrl: string;
	scopes: string[];
}

// =============================================================================
// DPoP Key Management
// =============================================================================

let dpopKeyPair: jose.GenerateKeyPairResult | null = null;
let dpopJwkThumbprint: string | null = null;

/**
 * Generate or retrieve the DPoP key pair.
 * The key pair is ephemeral and persists for the lifetime of the process.
 */
async function getDPoPKeyPair(): Promise<jose.GenerateKeyPairResult> {
	if (!dpopKeyPair) {
		// Generate ES256 (P-256 ECDSA) key pair per RFC 9449
		dpopKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
	}
	return dpopKeyPair;
}

/**
 * Calculate JWK thumbprint for the public key.
 * Used for token binding in DPoP flow.
 */
async function getDPoPJwkThumbprint(): Promise<string> {
	if (!dpopJwkThumbprint) {
		const keyPair = await getDPoPKeyPair();
		const publicJwk = await jose.exportJWK(keyPair.publicKey);
		dpopJwkThumbprint = await jose.calculateJwkThumbprint(publicJwk);
	}
	return dpopJwkThumbprint;
}

// =============================================================================
// DPoP Proof Generation
// =============================================================================

/**
 * Generate a DPoP proof JWT per RFC 9449 §4.2.
 *
 * The proof is a signed JWT with:
 * - Header: typ="dpop+jwt", alg="ES256", jwk=<public key>
 * - Payload: jti=<unique ID>, htm=<HTTP method>, htu=<HTTP URI>, iat=<timestamp>
 *
 * @param httpMethod - HTTP method (e.g., "POST")
 * @param httpUri - Full HTTP URI (e.g., "https://observatory.engram.rawcontext.com/api/auth/token")
 * @returns Signed DPoP proof JWT
 */
async function generateDPoPProof(httpMethod: string, httpUri: string): Promise<string> {
	const keyPair = await getDPoPKeyPair();
	const publicJwk = await jose.exportJWK(keyPair.publicKey);

	// Generate unique JWT ID for replay prevention
	const jti = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(16)));

	// Build DPoP proof JWT
	const proof = await new jose.SignJWT({
		jti,
		htm: httpMethod,
		htu: httpUri,
		iat: Math.floor(Date.now() / 1000),
	})
		.setProtectedHeader({
			typ: "dpop+jwt",
			alg: "ES256",
			jwk: publicJwk,
		})
		.sign(keyPair.privateKey);

	return proof;
}

// =============================================================================
// Token Cache
// =============================================================================

interface CachedToken {
	accessToken: string;
	expiresAt: number;
	scope: string;
}

let cachedToken: CachedToken | null = null;

/**
 * Check if cached token is still valid.
 * Returns true if token exists and won't expire in the next 5 minutes.
 */
function isCachedTokenValid(): boolean {
	if (!cachedToken) return false;

	const now = Date.now();
	const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
	return cachedToken.expiresAt > now + bufferMs;
}

// =============================================================================
// Client Credentials Flow
// =============================================================================

/**
 * Request a new client credentials access token with DPoP binding.
 *
 * @param config - OAuth configuration
 * @returns Token response or throws error
 */
async function requestClientToken(config: OAuthConfig): Promise<TokenResponse> {
	const tokenEndpoint = `${config.authServerUrl}/api/auth/token`;

	// Generate DPoP proof for the token request
	const dpopProof = await generateDPoPProof("POST", tokenEndpoint);

	// Get JWK thumbprint for token binding (required for DPoP flow)
	// Note: The thumbprint is included in the DPoP proof JWT, not sent separately
	await getDPoPJwkThumbprint();

	// Build form-urlencoded body
	const body = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: config.clientId,
		client_secret: config.clientSecret,
		scope: config.scopes.join(" "),
	});

	// Make token request with DPoP header
	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			DPoP: dpopProof,
		},
		body: body.toString(),
	});

	if (!response.ok) {
		const error: TokenError = await response.json();
		throw new Error(`OAuth token request failed: ${error.error} - ${error.error_description}`);
	}

	const tokenData: TokenResponse = await response.json();

	// Verify token type is DPoP
	if (tokenData.token_type !== "DPoP") {
		throw new Error(`Expected DPoP token type, got: ${tokenData.token_type}`);
	}

	// Cache the token with expiration time
	cachedToken = {
		accessToken: tokenData.access_token,
		expiresAt: Date.now() + tokenData.expires_in * 1000,
		scope: tokenData.scope,
	};

	console.log(
		`[OAuth] Client token acquired. Expires in ${tokenData.expires_in}s. Scopes: ${tokenData.scope}`,
	);

	return tokenData;
}

/**
 * Get a valid client credentials access token.
 * Returns cached token if valid, otherwise requests a new one.
 *
 * @param config - OAuth configuration
 * @returns Access token string
 */
async function getClientToken(config: OAuthConfig): Promise<string> {
	// Return cached token if still valid
	if (isCachedTokenValid() && cachedToken) {
		console.log("[OAuth] Using cached client token");
		return cachedToken.accessToken;
	}

	// Request new token
	console.log("[OAuth] Requesting new client token...");
	const tokenResponse = await requestClientToken(config);
	return tokenResponse.access_token;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Load OAuth configuration from environment variables.
 */
function loadOAuthConfig(): OAuthConfig | null {
	const clientId = process.env.ENGRAM_CLIENT_ID;
	const clientSecret = process.env.ENGRAM_CLIENT_SECRET;
	const authServerUrl = process.env.ENGRAM_AUTH_SERVER_URL;

	if (!clientId || !clientSecret || !authServerUrl) {
		console.warn("[OAuth] Missing configuration - client authentication disabled");
		console.warn(
			"[OAuth] Required: ENGRAM_CLIENT_ID, ENGRAM_CLIENT_SECRET, ENGRAM_AUTH_SERVER_URL",
		);
		return null;
	}

	return {
		clientId,
		clientSecret,
		authServerUrl,
		scopes: ["*"], // Console has full access
	};
}

// =============================================================================
// Exports
// =============================================================================

export { getClientToken, loadOAuthConfig, generateDPoPProof, getDPoPJwkThumbprint };
export type { OAuthConfig, TokenResponse };
