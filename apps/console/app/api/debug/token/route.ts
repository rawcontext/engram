/**
 * Debug endpoint to check API token configuration
 * Returns token pattern info without revealing the actual token
 */

import { NextResponse } from "next/server";

// OAuth 2.1 token patterns (RFC 6749, RFC 9449)
// Format: egm_oauth_{random32}_{crc6} for user tokens
const USER_TOKEN_PATTERN = /^egm_oauth_[a-f0-9]{32}_[a-zA-Z0-9]{6}$/;
// Format: egm_client_{random32}_{crc6} for client credentials
const CLIENT_TOKEN_PATTERN = /^egm_client_[a-f0-9]{32}_[a-zA-Z0-9]{6}$/;

function getApiToken(): string {
	const clientToken = process.env.ENGRAM_CLIENT_TOKEN;
	const oauthToken = process.env.ENGRAM_API_TOKEN;

	if (clientToken && clientToken.trim()) return clientToken.trim();
	if (oauthToken && oauthToken.trim()) return oauthToken.trim();

	return "";
}

export async function GET() {
	const token = getApiToken();
	const prefix = token ? token.slice(0, Math.min(20, token.length)) : "(none)";
	const length = token.length;
	const matchesUserToken = USER_TOKEN_PATTERN.test(token);
	const matchesClientToken = CLIENT_TOKEN_PATTERN.test(token);
	const source =
		process.env.ENGRAM_CLIENT_TOKEN && process.env.ENGRAM_CLIENT_TOKEN.trim()
			? "ENGRAM_CLIENT_TOKEN"
			: process.env.ENGRAM_API_TOKEN && process.env.ENGRAM_API_TOKEN.trim()
				? "ENGRAM_API_TOKEN"
				: "none";

	return NextResponse.json({
		prefix: `${prefix}...`,
		length,
		matchesUserToken,
		matchesClientToken,
		valid: matchesUserToken || matchesClientToken,
		source,
		apiUrl: process.env.ENGRAM_API_URL || "http://localhost:6174",
	});
}
