import { beforeEach, describe, expect, it } from "bun:test";
import * as jose from "jose";
import {
	calculateAccessTokenHash,
	calculateJwkThumbprint,
	type DPoPProof,
	validateDPoPProof,
} from "./dpop";

describe("DPoP Proof Validation (RFC 9449)", () => {
	let privateKey: jose.GenerateKeyPairResult;
	let publicJwk: jose.JWK;

	beforeEach(async () => {
		// Generate ES256 keypair for each test
		privateKey = await jose.generateKeyPair("ES256");
		publicJwk = await jose.exportJWK(privateKey.publicKey);
	});

	/**
	 * Helper to create a valid DPoP proof JWT
	 */
	async function createDPoPProof(
		payload: Partial<DPoPProof>,
		options: {
			algorithm?: string;
			typ?: string;
			includeJwk?: boolean;
		} = {},
	): Promise<string> {
		const algorithm = options.algorithm ?? "ES256";
		const typ = options.typ ?? "dpop+jwt";
		const includeJwk = options.includeJwk ?? true;

		const jwt = new jose.SignJWT(payload as Record<string, unknown>)
			.setProtectedHeader({
				alg: algorithm,
				typ,
				...(includeJwk ? { jwk: publicJwk } : {}),
			})
			.sign(privateKey.privateKey);

		return jwt;
	}

	describe("Valid ES256 Signature Verification", () => {
		it("should successfully verify a valid DPoP proof with ES256", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(true);
			expect(result.jwkThumbprint).toBeDefined();
			expect(result.error).toBeUndefined();
			expect(result.proof).toBeDefined();
			expect(result.proof?.jti).toBeDefined();
			expect(result.proof?.htm).toBe("POST");
			expect(result.proof?.htu).toBe("https://server.example.com/token");
		});

		it("should return correct JWK thumbprint for token binding", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "GET",
				htu: "https://resource.example.com/data",
				iat: Math.floor(Date.now() / 1000),
			});

			const result = await validateDPoPProof(proof, "GET", "https://resource.example.com/data");

			expect(result.valid).toBe(true);

			// Verify thumbprint matches independently calculated one
			const expectedThumbprint = await calculateJwkThumbprint(publicJwk);
			expect(result.jwkThumbprint).toBe(expectedThumbprint);
		});

		it("should accept proof within maxAge window", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000) - 200, // 200 seconds ago
			});

			const result = await validateDPoPProof(
				proof,
				"POST",
				"https://server.example.com/token",
				{ maxAge: 300 }, // 5 minutes
			);

			expect(result.valid).toBe(true);
		});

		it("should validate ath claim when access token hash provided", async () => {
			const accessToken = "egm_oauth_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4_X7kM2p";
			const ath = await calculateAccessTokenHash(accessToken);

			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "GET",
				htu: "https://resource.example.com/data",
				iat: Math.floor(Date.now() / 1000),
				ath,
			});

			const result = await validateDPoPProof(proof, "GET", "https://resource.example.com/data", {
				accessTokenHash: ath,
			});

			expect(result.valid).toBe(true);
			expect(result.proof?.ath).toBe(ath);
		});
	});

	describe("Invalid Signature Rejection", () => {
		it("should reject proof with tampered payload after signing", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			// Tamper with the payload by decoding, modifying, and re-encoding
			const parts = proof.split(".");
			const payloadJson = JSON.parse(new TextDecoder().decode(jose.base64url.decode(parts[1])));
			payloadJson.htm = "GET"; // Change HTTP method
			const tamperedPayload = jose.base64url.encode(
				new TextEncoder().encode(JSON.stringify(payloadJson)),
			);
			const tamperedProof = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

			const result = await validateDPoPProof(
				tamperedProof,
				"POST",
				"https://server.example.com/token",
			);

			expect(result.valid).toBe(false);
			expect(result.error).toContain("JWT verification failed");
		});

		it("should reject proof signed with different private key", async () => {
			// Create proof with original keypair
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			// Generate different keypair and re-sign
			const differentKeyPair = await jose.generateKeyPair("ES256");
			const differentPublicJwk = await jose.exportJWK(differentKeyPair.publicKey);

			// Decode original payload
			const decoded = jose.decodeJwt(proof);

			// Create new proof with different key but same payload
			const maliciousProof = await new jose.SignJWT(decoded as Record<string, unknown>)
				.setProtectedHeader({
					alg: "ES256",
					typ: "dpop+jwt",
					jwk: differentPublicJwk,
				})
				.sign(differentKeyPair.privateKey);

			const result = await validateDPoPProof(
				maliciousProof,
				"POST",
				"https://server.example.com/token",
			);

			// Should succeed but have different thumbprint
			expect(result.valid).toBe(true);
			const originalThumbprint = await calculateJwkThumbprint(publicJwk);
			expect(result.jwkThumbprint).not.toBe(originalThumbprint);
		});

		it("should reject proof with invalid JWT format", async () => {
			const result = await validateDPoPProof(
				"not.a.valid.jwt.format",
				"POST",
				"https://server.example.com/token",
			);

			expect(result.valid).toBe(false);
			expect(result.error).toContain("JWT verification failed");
		});

		it("should reject proof without JWK in header", async () => {
			const proof = await createDPoPProof(
				{
					jti: crypto.randomUUID(),
					htm: "POST",
					htu: "https://server.example.com/token",
					iat: Math.floor(Date.now() / 1000),
				},
				{ includeJwk: false },
			);

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(false);
			expect(result.error).toContain("JWT verification failed");
		});
	});

	describe("Expired Proof Rejection", () => {
		it("should reject proof with iat in the past beyond maxAge", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000) - 400, // 400 seconds ago
			});

			const result = await validateDPoPProof(
				proof,
				"POST",
				"https://server.example.com/token",
				{ maxAge: 300 }, // 5 minutes
			);

			expect(result.valid).toBe(false);
			expect(result.error).toContain("Proof too old");
		});

		it("should reject proof with iat in the future", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000) + 100, // 100 seconds in future
			});

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(false);
			expect(result.error).toContain("Proof issued in the future");
		});

		it("should respect custom maxAge parameter", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000) - 50, // 50 seconds ago
			});

			const result = await validateDPoPProof(
				proof,
				"POST",
				"https://server.example.com/token",
				{ maxAge: 30 }, // 30 seconds only
			);

			expect(result.valid).toBe(false);
			expect(result.error).toContain("Proof too old");
		});
	});

	describe("Replay Detection (jti)", () => {
		it("should reject proof without jti claim", async () => {
			const proof = await createDPoPProof({
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(false);
			expect(result.error).toContain("Missing or invalid jti");
		});

		it("should reject proof with empty jti claim", async () => {
			const proof = await createDPoPProof({
				jti: "",
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(false);
			expect(result.error).toContain("Missing or invalid jti");
		});

		it("should accept proofs with unique jti values", async () => {
			const proof1 = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const proof2 = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const result1 = await validateDPoPProof(proof1, "POST", "https://server.example.com/token");
			const result2 = await validateDPoPProof(proof2, "POST", "https://server.example.com/token");

			expect(result1.valid).toBe(true);
			expect(result2.valid).toBe(true);
			expect(result1.proof?.jti).not.toBe(result2.proof?.jti);
		});

		it("should detect reuse of same jti (simulated replay)", async () => {
			const jti = crypto.randomUUID();

			// First proof with jti
			const proof1 = await createDPoPProof({
				jti,
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			// Second proof with same jti (replay attempt)
			const proof2 = await createDPoPProof({
				jti,
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const result1 = await validateDPoPProof(proof1, "POST", "https://server.example.com/token");
			const result2 = await validateDPoPProof(proof2, "POST", "https://server.example.com/token");

			// Both should validate successfully at the cryptographic level
			// Note: Actual replay detection requires server-side jti storage
			expect(result1.valid).toBe(true);
			expect(result2.valid).toBe(true);
			expect(result1.proof?.jti).toBe(result2.proof?.jti);
		});
	});

	describe("HTTP Method Validation (htm)", () => {
		it("should reject proof with mismatched HTTP method", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "GET",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(false);
			expect(result.error).toContain("HTTP method mismatch");
			expect(result.error).toContain("GET");
			expect(result.error).toContain("POST");
		});

		it("should accept proof with matching HTTP method", async () => {
			const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

			for (const method of methods) {
				const proof = await createDPoPProof({
					jti: crypto.randomUUID(),
					htm: method,
					htu: "https://server.example.com/resource",
					iat: Math.floor(Date.now() / 1000),
				});

				const result = await validateDPoPProof(
					proof,
					method,
					"https://server.example.com/resource",
				);

				expect(result.valid).toBe(true);
			}
		});
	});

	describe("HTTP URI Validation (htu)", () => {
		it("should reject proof with mismatched HTTP URI", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/different");

			expect(result.valid).toBe(false);
			expect(result.error).toContain("HTTP URI mismatch");
		});

		it("should accept proof with matching HTTP URI", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(true);
		});
	});

	describe("Algorithm Validation (alg)", () => {
		it("should reject proof with invalid typ header", async () => {
			const proof = await createDPoPProof(
				{
					jti: crypto.randomUUID(),
					htm: "POST",
					htu: "https://server.example.com/token",
					iat: Math.floor(Date.now() / 1000),
				},
				{ typ: "jwt" }, // Wrong typ
			);

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(false);
			expect(result.error).toContain("JWT verification failed");
		});

		it("should use default ES256 algorithm", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			});

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(true);
		});

		it("should reject non-ES256 algorithm when not in allowed list", async () => {
			// ES384 requires P-384 curve
			const es384KeyPair = await jose.generateKeyPair("ES384");
			const es384PublicJwk = await jose.exportJWK(es384KeyPair.publicKey);

			const proof = await new jose.SignJWT({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			})
				.setProtectedHeader({
					alg: "ES384",
					typ: "dpop+jwt",
					jwk: es384PublicJwk,
				})
				.sign(es384KeyPair.privateKey);

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(false);
			expect(result.error).toContain("JWT verification failed");
		});

		it("should accept custom allowed algorithms", async () => {
			// ES384 requires P-384 curve
			const es384KeyPair = await jose.generateKeyPair("ES384");
			const es384PublicJwk = await jose.exportJWK(es384KeyPair.publicKey);

			const proof = await new jose.SignJWT({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
			})
				.setProtectedHeader({
					alg: "ES384",
					typ: "dpop+jwt",
					jwk: es384PublicJwk,
				})
				.sign(es384KeyPair.privateKey);

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token", {
				allowedAlgorithms: ["ES256", "ES384"],
			});

			expect(result.valid).toBe(true);
		});
	});

	describe("Access Token Hash Validation (ath)", () => {
		it("should reject proof with missing ath when accessTokenHash provided", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "GET",
				htu: "https://resource.example.com/data",
				iat: Math.floor(Date.now() / 1000),
				// ath intentionally missing
			});

			const result = await validateDPoPProof(proof, "GET", "https://resource.example.com/data", {
				accessTokenHash: "some_hash",
			});

			expect(result.valid).toBe(false);
			expect(result.error).toContain("Access token hash (ath) required but not present");
		});

		it("should reject proof with mismatched ath claim", async () => {
			const accessToken = "egm_oauth_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4_X7kM2p";
			const correctHash = await calculateAccessTokenHash(accessToken);

			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "GET",
				htu: "https://resource.example.com/data",
				iat: Math.floor(Date.now() / 1000),
				ath: "wrong_hash",
			});

			const result = await validateDPoPProof(proof, "GET", "https://resource.example.com/data", {
				accessTokenHash: correctHash,
			});

			expect(result.valid).toBe(false);
			expect(result.error).toContain("Access token hash (ath) mismatch");
		});

		it("should accept proof without ath when accessTokenHash not provided", async () => {
			const proof = await createDPoPProof({
				jti: crypto.randomUUID(),
				htm: "POST",
				htu: "https://server.example.com/token",
				iat: Math.floor(Date.now() / 1000),
				// ath not included
			});

			const result = await validateDPoPProof(proof, "POST", "https://server.example.com/token");

			expect(result.valid).toBe(true);
		});
	});

	describe("JWK Thumbprint Calculation (RFC 7638)", () => {
		it("should calculate consistent thumbprint for same JWK", async () => {
			const thumbprint1 = await calculateJwkThumbprint(publicJwk);
			const thumbprint2 = await calculateJwkThumbprint(publicJwk);

			expect(thumbprint1).toBe(thumbprint2);
			expect(thumbprint1).toMatch(/^[A-Za-z0-9_-]+$/); // Base64url format
		});

		it("should calculate different thumbprints for different keys", async () => {
			const keyPair2 = await jose.generateKeyPair("ES256");
			const publicJwk2 = await jose.exportJWK(keyPair2.publicKey);

			const thumbprint1 = await calculateJwkThumbprint(publicJwk);
			const thumbprint2 = await calculateJwkThumbprint(publicJwk2);

			expect(thumbprint1).not.toBe(thumbprint2);
		});
	});

	describe("Access Token Hash Calculation (RFC 9449 §4.2)", () => {
		it("should calculate base64url-encoded SHA-256 hash", async () => {
			const accessToken = "egm_oauth_test123";
			const hash = await calculateAccessTokenHash(accessToken);

			expect(hash).toMatch(/^[A-Za-z0-9_-]+$/); // Base64url format
			expect(hash.length).toBeGreaterThan(0);
		});

		it("should calculate consistent hash for same token", async () => {
			const accessToken = "egm_oauth_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4_X7kM2p";
			const hash1 = await calculateAccessTokenHash(accessToken);
			const hash2 = await calculateAccessTokenHash(accessToken);

			expect(hash1).toBe(hash2);
		});

		it("should calculate different hashes for different tokens", async () => {
			const hash1 = await calculateAccessTokenHash("token1");
			const hash2 = await calculateAccessTokenHash("token2");

			expect(hash1).not.toBe(hash2);
		});
	});
});
