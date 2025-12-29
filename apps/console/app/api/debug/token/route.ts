/**
 * Debug endpoint to check API token configuration
 * Returns token pattern info without revealing the actual token
 */

import { NextResponse } from "next/server";

const DEV_TOKEN_PATTERN = /^engram_dev_[a-zA-Z0-9_]+$/;
const OAUTH_TOKEN_PATTERN = /^engram_oauth_[a-zA-Z0-9]{32}$/;

function getApiToken(): string {
	const key = process.env.ENGRAM_API_KEY;
	const token = process.env.ENGRAM_API_TOKEN;

	if (key && key.trim()) return key.trim();
	if (token && token.trim()) return token.trim();

	return "engram_dev_console";
}

export async function GET() {
	const token = getApiToken();
	const prefix = token.slice(0, Math.min(20, token.length));
	const length = token.length;
	const matchesDev = DEV_TOKEN_PATTERN.test(token);
	const matchesOAuth = OAUTH_TOKEN_PATTERN.test(token);
	const source =
		process.env.ENGRAM_API_KEY && process.env.ENGRAM_API_KEY.trim()
			? "ENGRAM_API_KEY"
			: process.env.ENGRAM_API_TOKEN && process.env.ENGRAM_API_TOKEN.trim()
				? "ENGRAM_API_TOKEN"
				: "fallback";

	return NextResponse.json({
		prefix: `${prefix}...`,
		length,
		matchesDev,
		matchesOAuth,
		valid: matchesDev || matchesOAuth,
		source,
		apiUrl: process.env.ENGRAM_API_URL || "http://localhost:6174",
	});
}
