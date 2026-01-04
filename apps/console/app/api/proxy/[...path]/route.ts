/**
 * Engram API Proxy
 *
 * Validates the user session and forwards requests to the Engram API
 * with a service token obtained via OAuth client credentials flow with DPoP.
 */

import * as jose from "jose";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Get the Engram API URL from environment
const ENGRAM_API_URL = process.env.ENGRAM_API_URL || "http://localhost:6174";
const ENGRAM_AUTH_URL = process.env.ENGRAM_AUTH_URL || "http://localhost:6178";
const ENGRAM_CLIENT_ID = process.env.ENGRAM_CLIENT_ID || "engram-console";
const ENGRAM_CLIENT_SECRET = process.env.ENGRAM_CLIENT_SECRET || "";

// Cache for the OAuth token and DPoP keys
let cachedToken: { token: string; expiresAt: number } | null = null;
let dpopKeyPair: { privateKey: CryptoKey; publicKey: CryptoKey; jwk: jose.JWK } | null = null;

/**
 * Initialize DPoP key pair (generated once per process)
 */
async function getDPoPKeyPair() {
	if (!dpopKeyPair) {
		const { privateKey, publicKey } = await jose.generateKeyPair("ES256");
		const jwk = await jose.exportJWK(publicKey);
		dpopKeyPair = { privateKey, publicKey, jwk };
	}
	return dpopKeyPair;
}

/**
 * Create a DPoP proof JWT
 */
async function createDPoPProof(method: string, url: string): Promise<string> {
	const keys = await getDPoPKeyPair();

	const proof = await new jose.SignJWT({
		htm: method,
		htu: url,
		iat: Math.floor(Date.now() / 1000),
		jti: crypto.randomUUID(),
	})
		.setProtectedHeader({
			typ: "dpop+jwt",
			alg: "ES256",
			jwk: keys.jwk,
		})
		.sign(keys.privateKey);

	return proof;
}

/**
 * Get an OAuth access token using client credentials flow with DPoP
 */
async function getAccessToken(): Promise<string> {
	// Check for pre-configured token first
	const preConfiguredToken = process.env.ENGRAM_CLIENT_TOKEN?.trim();
	if (preConfiguredToken) {
		return preConfiguredToken;
	}

	// Check cached token (with 5 minute buffer before expiry)
	if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
		return cachedToken.token;
	}

	// No client secret configured - can't get token
	if (!ENGRAM_CLIENT_SECRET) {
		console.warn("[Console] No ENGRAM_CLIENT_SECRET configured - API calls will fail");
		return "";
	}

	try {
		const tokenUrl = `${ENGRAM_AUTH_URL}/api/auth/token`;

		// Create DPoP proof for token request
		const dpopProof = await createDPoPProof("POST", tokenUrl);

		const response = await fetch(tokenUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				DPoP: dpopProof,
			},
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: ENGRAM_CLIENT_ID,
				client_secret: ENGRAM_CLIENT_SECRET,
				scope: "memory:read memory:write query:read",
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			console.error(`[Console] Failed to get OAuth token: ${response.status} - ${error}`);
			return "";
		}

		const data = await response.json();
		const expiresIn = data.expires_in || 3600; // Default 1 hour

		cachedToken = {
			token: data.access_token,
			expiresAt: Date.now() + expiresIn * 1000,
		};

		console.log(`[Console] Obtained OAuth token, expires in ${expiresIn}s`);
		return data.access_token;
	} catch (error) {
		console.error("[Console] Error fetching OAuth token:", error);
		return "";
	}
}

interface ProxyParams {
	params: Promise<{ path: string[] }>;
}

async function proxyRequest(request: NextRequest, { params }: ProxyParams) {
	// Validate session
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return NextResponse.json(
			{
				success: false,
				error: {
					code: "UNAUTHORIZED",
					message: "Not authenticated",
				},
			},
			{ status: 401 },
		);
	}

	const { path } = await params;
	const apiPath = `/v1/${path.join("/")}`;
	const url = new URL(apiPath, ENGRAM_API_URL);

	// Copy query parameters
	const searchParams = request.nextUrl.searchParams;
	searchParams.forEach((value, key) => {
		url.searchParams.set(key, value);
	});

	// Get access token
	const accessToken = await getAccessToken();

	// Prepare headers
	const proxyHeaders: HeadersInit = {
		"Content-Type": "application/json",
	};

	// Add Authorization if we have a token
	// Note: Using Bearer scheme - the API validates tokens directly, not via DPoP
	if (accessToken) {
		proxyHeaders.Authorization = `Bearer ${accessToken}`;
	}

	// Forward the request
	const fetchOptions: RequestInit = {
		method: request.method,
		headers: proxyHeaders,
	};

	// Include body for non-GET requests
	if (request.method !== "GET" && request.method !== "HEAD") {
		try {
			const body = await request.text();
			if (body) {
				fetchOptions.body = body;
			}
		} catch {
			// No body to forward
		}
	}

	try {
		const response = await fetch(url.toString(), fetchOptions);
		const data = await response.json();

		// Log token prefix for debugging auth issues (never log full token)
		if (response.status === 401) {
			const tokenPrefix = accessToken.slice(0, 20);
			console.error(
				`[Console API Proxy] 401 from API - token prefix: ${tokenPrefix}..., url: ${url.pathname}`,
			);
			// Invalidate cached token on 401
			cachedToken = null;
		}

		return NextResponse.json(data, {
			status: response.status,
			headers: {
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		console.error("[Console API Proxy] Error:", error);
		return NextResponse.json(
			{
				success: false,
				error: {
					code: "PROXY_ERROR",
					message: "Failed to connect to Engram API",
				},
			},
			{ status: 502 },
		);
	}
}

export async function GET(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}

export async function POST(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}

export async function PUT(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}

export async function PATCH(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}

export async function DELETE(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}
