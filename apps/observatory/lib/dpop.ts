/**
 * DPoP (Demonstrating Proof of Possession) Validation Library
 *
 * Implements RFC 9449 OAuth 2.0 Demonstrating Proof of Possession (DPoP)
 * for binding access tokens to client proof-of-possession keys.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9449
 * @see https://datatracker.ietf.org/doc/rfc9700/ (OAuth Security BCP)
 */

import * as jose from "jose";

// =============================================================================
// Types
// =============================================================================

export interface DPoPProof {
	jti: string; // Unique JWT ID (replay prevention)
	htm: string; // HTTP method (POST, GET, etc.)
	htu: string; // HTTP URI (token endpoint URL)
	iat: number; // Issued at timestamp
	ath?: string; // Access token hash (for resource requests)
}

export interface DPoPValidationResult {
	valid: boolean;
	jwkThumbprint?: string;
	error?: string;
	proof?: DPoPProof;
}

export interface DPoPValidationOptions {
	/**
	 * Maximum age of the proof in seconds (default: 300 = 5 minutes).
	 * Recommended by RFC 9449 to prevent replay attacks.
	 */
	maxAge?: number;

	/**
	 * Allowed signature algorithms (default: ["ES256"]).
	 * ES256 (P-256 ECDSA) is required by RFC 9449 for strong security.
	 */
	allowedAlgorithms?: string[];

	/**
	 * Access token hash to verify (for resource server requests).
	 * When provided, validates the `ath` claim matches.
	 */
	accessTokenHash?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_AGE = 300; // 5 minutes
const DEFAULT_ALGORITHMS = ["ES256"]; // RFC 9449 requires ES256
const DPOP_TYPE = "dpop+jwt"; // Required typ header value

// =============================================================================
// JWK Thumbprint Calculation (RFC 7638)
// =============================================================================

/**
 * Calculate JWK thumbprint using SHA-256 (RFC 7638).
 *
 * The thumbprint is computed over the required JWK members in lexicographic order:
 * - For EC keys: crv, kty, x, y
 * - For RSA keys: e, kty, n
 * - For oct keys: k, kty
 *
 * @param jwk - JSON Web Key
 * @returns Base64url-encoded SHA-256 thumbprint
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7638
 */
export async function calculateJwkThumbprint(jwk: jose.JWK): Promise<string> {
	return await jose.calculateJwkThumbprint(jwk);
}

// =============================================================================
// DPoP Proof Validation (RFC 9449)
// =============================================================================

/**
 * Validate a DPoP proof JWT per RFC 9449 §4.3.
 *
 * Validation steps:
 * 1. Verify JWT signature using embedded JWK in header
 * 2. Verify `typ` header is "dpop+jwt"
 * 3. Verify `alg` is ES256 (or allowed algorithm)
 * 4. Verify `htm` matches request HTTP method
 * 5. Verify `htu` matches request URI
 * 6. Verify `iat` is within acceptable time window (default 5 min)
 * 7. Verify `ath` matches access token hash (if provided)
 * 8. Calculate JWK thumbprint for token binding
 *
 * @param dpopHeader - DPoP header value from HTTP request
 * @param expectedMethod - Expected HTTP method (e.g., "POST", "GET")
 * @param expectedUri - Expected HTTP URI (e.g., "https://server.example.com/token")
 * @param options - Validation options
 * @returns Validation result with JWK thumbprint if valid
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9449#section-4.3
 */
export async function validateDPoPProof(
	dpopHeader: string,
	expectedMethod: string,
	expectedUri: string,
	options: DPoPValidationOptions = {},
): Promise<DPoPValidationResult> {
	const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
	const allowedAlgorithms = options.allowedAlgorithms ?? DEFAULT_ALGORITHMS;

	try {
		// Step 1-3: Verify JWT signature using embedded JWK, typ, and alg
		// EmbeddedJWK extracts the public key from the 'jwk' header parameter
		const { payload, protectedHeader } = await jose.jwtVerify(dpopHeader, jose.EmbeddedJWK, {
			typ: DPOP_TYPE,
			algorithms: allowedAlgorithms,
		});

		// Verify typ header (jose.jwtVerify checks this, but explicit check for clarity)
		if (protectedHeader.typ !== DPOP_TYPE) {
			return {
				valid: false,
				error: `Invalid typ header: expected '${DPOP_TYPE}', got '${protectedHeader.typ}'`,
			};
		}

		// Verify alg is in allowed list
		if (!allowedAlgorithms.includes(protectedHeader.alg as string)) {
			return {
				valid: false,
				error: `Algorithm '${protectedHeader.alg}' not allowed. Expected one of: ${allowedAlgorithms.join(", ")}`,
			};
		}

		// Extract and validate payload claims
		const proof = payload as unknown as DPoPProof;

		// Step 4: Verify htm (HTTP method)
		if (proof.htm !== expectedMethod) {
			return {
				valid: false,
				error: `HTTP method mismatch: expected '${expectedMethod}', got '${proof.htm}'`,
			};
		}

		// Step 5: Verify htu (HTTP URI)
		if (proof.htu !== expectedUri) {
			return {
				valid: false,
				error: `HTTP URI mismatch: expected '${expectedUri}', got '${proof.htu}'`,
			};
		}

		// Step 6: Verify iat (issued at time)
		const now = Math.floor(Date.now() / 1000);
		const age = now - proof.iat;

		if (age < 0) {
			return {
				valid: false,
				error: `Proof issued in the future: iat=${proof.iat}, now=${now}`,
			};
		}

		if (age > maxAge) {
			return {
				valid: false,
				error: `Proof too old: age=${age}s, maxAge=${maxAge}s`,
			};
		}

		// Step 7: Verify ath (access token hash) if provided
		if (options.accessTokenHash) {
			if (!proof.ath) {
				return {
					valid: false,
					error: "Access token hash (ath) required but not present in proof",
				};
			}

			if (proof.ath !== options.accessTokenHash) {
				return {
					valid: false,
					error: "Access token hash (ath) mismatch",
				};
			}
		}

		// Verify jti is present (replay prevention)
		if (!proof.jti || typeof proof.jti !== "string") {
			return {
				valid: false,
				error: "Missing or invalid jti (JWT ID) claim",
			};
		}

		// Step 8: Calculate JWK thumbprint for token binding
		// The JWK is embedded in the 'jwk' header parameter
		const jwk = protectedHeader.jwk;
		if (!jwk) {
			return {
				valid: false,
				error: "Missing jwk header parameter",
			};
		}

		const jwkThumbprint = await calculateJwkThumbprint(jwk);

		return {
			valid: true,
			jwkThumbprint,
			proof,
		};
	} catch (error) {
		// Handle jose library errors (signature verification, format errors, etc.)
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			error: `JWT verification failed: ${errorMessage}`,
		};
	}
}

// =============================================================================
// Access Token Hash Calculation
// =============================================================================

/**
 * Calculate access token hash for DPoP `ath` claim (RFC 9449 §4.2).
 *
 * The `ath` claim is used when presenting a DPoP proof with an access token
 * to a resource server. It is the base64url-encoded SHA-256 hash of the
 * ASCII encoding of the access token value.
 *
 * @param accessToken - The access token value
 * @returns Base64url-encoded SHA-256 hash
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9449#section-4.2
 */
export async function calculateAccessTokenHash(accessToken: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(accessToken);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = new Uint8Array(hashBuffer);

	// Convert to base64url
	return jose.base64url.encode(hashArray);
}
